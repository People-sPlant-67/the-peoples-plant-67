/**
 * The hook script, plant-hook.mjs: Claude Code and Codex run it on their lifecycle events with
 * the event as JSON on stdin. It writes the agent's file in the bridge's folder, hands over any
 * messages waiting in the agent's inbox (as context for the next turn), and sends the agent's
 * answer back once the turn ends.
 *
 *   node plant-hook.mjs claude [--dir path]          Claude Code hooks
 *   node plant-hook.mjs codex [--dir path]           Codex hooks
 *   node plant-hook.mjs codex-notify [--dir] <json>  Codex's older `notify` program
 *
 * It must never get in the agent's way: whatever goes wrong, it exits 0 within a few seconds and
 * prints nothing but the context it was asked for.
 *
 * One comrade is one project folder per harness. Sessions in the same folder share the comrade:
 * the record keeps each session's own state, and the comrade shows the most pressing of them
 * (waiting, then working, then error, then idle).
 *
 * The threads handed to a session and not yet answered live in a file of their own,
 * awaiting/<agent>/<session>.json, touched only by the events that run in step with the agent
 * (SessionStart, UserPromptSubmit, Stop and the like). Tool events run in the background and
 * may land late; keeping them away from that list means a late one can never bring back a
 * thread already answered, or lose one just handed over.
 */
import { closeSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type AgentRecord, type BridgeStatus, FORMAT, type InboxMessage, type ReplyFile, ensureDir, keyHash, plantDir, stampName, writeAtomic } from './files';

/** Harnesses this script speaks for: their key prefix and the title the comrade wears. */
export const HARNESSES = { claude: { prefix: 'claude', title: 'Claude Code' }, codex: { prefix: 'codex', title: 'Codex' } } as const;
export type Harness = keyof typeof HARNESSES;

/** Tool events closer together than this for a session already working are not written again. */
export const BEAT_MS = 5_000;
/** A session not heard from in this long is forgotten (unless it waits on the owner). */
export const SESSION_STALE_MS = 10 * 60_000;
/** Longest answer sent back. */
const REPLY_MAX = 20_000;

/** One session's part of the record. */
interface SessionState {
	status: BridgeStatus;
	reason: string | null;
	at: number;
}

/** The record this script writes: the adapter fields, plus its sessions. */
export interface HookRecord extends AgentRecord {
	sessions: Record<string, SessionState>;
}

/** What an event asks of the record. */
export interface EventInput {
	event: string;
	sessionId: string;
	cwd: string;
	/** Notification's kind (Claude Code). */
	notificationType?: string;
	message?: string;
	toolName?: string;
	errorType?: string;
	lastMessage?: string | null;
	transcriptPath?: string;
}

/** What handling an event did, for the caller to print and write. */
export interface Outcome {
	/** The record to write, or null to leave the file as it is. */
	record: HookRecord | null;
	/** Context for the agent (SessionStart, UserPromptSubmit), or null. */
	context: string | null;
	/** An answer to send back, or null. */
	reply: { issueIds: string[]; text: string } | null;
	/** The session's threads awaiting an answer, to write; null leaves them as they are. */
	awaiting: string[] | null;
	/** Inbox files to move to delivered/ once the record is written. */
	take: string[];
}

/** Error words per StopFailure error_type. */
const FAILURES: Record<string, string> = {
	rate_limit: 'Hit the rate limit and stopped.',
	overloaded: 'The model was overloaded, so the turn stopped.',
	authentication_failed: 'The sign-in to the model failed.',
};

const RANK: Record<BridgeStatus, number> = { waiting: 4, running: 3, error: 2, paused: 1, idle: 0 };

/**
 * The record's top line from its sessions: the most pressing session speaks for the comrade.
 *
 * @param r Record.
 * @param now Epoch ms.
 */
export function settle(r: HookRecord, now: number): void {
	for (const [id, s] of Object.entries(r.sessions)) {
		if (now - s.at > SESSION_STALE_MS && s.status !== 'waiting') delete r.sessions[id];
	}
	const top = Object.values(r.sessions).sort((a, b) => RANK[b.status] - RANK[a.status] || b.at - a.at)[0];
	r.status = top?.status ?? 'idle';
	r.reason = top?.reason ?? null;
	r.updatedAt = new Date(now).toISOString();
}

/**
 * Read the record already on disk, or a fresh one.
 *
 * @param raw Parsed file, or null.
 * @param key Agent key.
 * @param name Comrade's name.
 * @param title Harness title.
 * @returns Record.
 */
export function recordFrom(raw: unknown, key: string, name: string, title: string): HookRecord {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<HookRecord>;
	const sessions: Record<string, SessionState> = {};
	if (o.sessions && typeof o.sessions === 'object') {
		for (const [id, v] of Object.entries(o.sessions)) {
			if (!v || typeof v !== 'object' || typeof v.at !== 'number') continue;
			sessions[id] = { status: RANK[v.status] === undefined ? 'idle' : v.status, reason: typeof v.reason === 'string' ? v.reason : null, at: v.at };
		}
	}
	return { v: FORMAT, key, name, harness: title, status: 'idle', reason: null, updatedAt: '', heartbeatAt: typeof o.heartbeatAt === 'string' ? o.heartbeatAt : null, sessions };
}

/**
 * Words for the agent: the owner's messages, and where its answer goes.
 *
 * @param messages Messages taken from the inbox.
 * @returns Context text.
 */
export function contextFor(messages: InboxMessage[]): string {
	const parts = messages.map((m) => `${m.identifier} "${m.title}" (${m.kind === 'directive' ? 'a new directive' : 'a message in that thread'}):\n${m.text}`);
	return [
		`Your owner sent ${messages.length === 1 ? 'a message' : `${messages.length} messages`} through The People's Plant #67, the dashboard that shows their agents at work. It is from the user, as if typed here.`,
		...parts,
		'Your final message this turn goes back to them in the plant as your reply.',
	].join('\n\n');
}

/**
 * Handle one event. Pure apart from what it is given: the caller reads the files and writes
 * what comes back.
 *
 * @param prev The record on disk (already read).
 * @param e The event.
 * @param inbox Messages waiting for this agent, with their file names.
 * @param now Epoch ms.
 * @param awaiting This session's threads awaiting an answer.
 * @returns What to write and print.
 */
export function handleEvent(prev: HookRecord, e: EventInput, inbox: { file: string; m: InboxMessage }[], now: number, awaiting: string[] = []): Outcome {
	const r: HookRecord = { ...prev, sessions: { ...prev.sessions } };
	const had = r.sessions[e.sessionId];
	const s: SessionState = had ? { ...had } : { status: 'idle', reason: null, at: now };
	const out: Outcome = { record: r, context: null, reply: null, awaiting: null, take: [] };
	const beat = (): void => { r.heartbeatAt = new Date(now).toISOString(); };
	const deliver = (): void => {
		if (!inbox.length) return;
		out.take = inbox.map((x) => x.file);
		out.context = contextFor(inbox.map((x) => x.m));
		out.awaiting = [...new Set([...awaiting, ...inbox.map((x) => x.m.issueId)])];
	};
	switch (e.event) {
		case 'SessionStart':
			s.status = 'idle'; s.reason = null;
			deliver();
			break;
		case 'UserPromptSubmit':
			s.status = 'running'; s.reason = null;
			beat();
			deliver();
			break;
		case 'PreToolUse':
		case 'PostToolUse':
			// A busy session writes at most every BEAT_MS: tools can fire many times a second.
			if (had?.status === 'running' && now - had.at < BEAT_MS) return { ...out, record: null };
			s.status = 'running'; s.reason = null;
			beat();
			break;
		case 'Notification':
			if (e.notificationType === 'permission_prompt') { s.status = 'waiting'; s.reason = e.message ?? 'Waiting for your OK.'; }
			else if (e.notificationType === 'idle_prompt') { s.status = 'idle'; s.reason = null; }
			else return { ...out, record: null };
			break;
		case 'PermissionRequest':
			s.status = 'waiting';
			s.reason = e.toolName ? `Asks to use ${e.toolName}.` : 'Waiting for your OK.';
			break;
		case 'Stop':
		case 'Interrupt':
		case 'agent-turn-complete':
			s.status = 'idle'; s.reason = null;
			if (e.event === 'agent-turn-complete') beat();
			if (awaiting.length && e.lastMessage && e.lastMessage.trim()) {
				out.reply = { issueIds: awaiting, text: e.lastMessage.trim().slice(0, REPLY_MAX) };
				out.awaiting = [];
			}
			break;
		case 'StopFailure':
			s.status = 'error';
			s.reason = (e.errorType && FAILURES[e.errorType]) ?? `The turn stopped with an error${e.errorType ? ` (${e.errorType})` : ''}.`;
			break;
		case 'SessionEnd':
			delete r.sessions[e.sessionId];
			settle(r, now);
			// Anything still unanswered will not be: the session is gone.
			return { ...out, awaiting: awaiting.length ? [] : null };
		default:
			return { ...out, record: null };
	}
	s.at = now;
	r.sessions[e.sessionId] = s;
	settle(r, now);
	return out;
}

/**
 * The text of the last assistant message in a Claude Code transcript, for versions whose Stop
 * event does not carry it. Reads only the end of the file.
 *
 * @param path Transcript (JSON lines).
 * @returns Text, or null.
 */
export function lastAssistantText(path: string): string | null {
	try {
		const size = statSync(path).size;
		const len = Math.min(size, 512 * 1024);
		const buf = Buffer.alloc(len);
		const fd = openSync(path, 'r');
		try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
		const lines = buf.toString('utf8').split('\n').reverse();
		for (const l of lines) {
			let o: { type?: string; message?: { content?: unknown } };
			try { o = JSON.parse(l); } catch { continue; }
			if (o.type !== 'assistant') continue;
			const c = o.message?.content;
			const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x && x.type === 'text' && typeof x.text === 'string').map((x) => x.text as string).join('\n') : '';
			if (text.trim()) return text;
		}
	} catch { /* No transcript: no answer. */ }
	return null;
}

/**
 * Turn a harness payload into an event.
 *
 * @param o Parsed payload.
 * @param notify True for Codex's notify program (dashed field names).
 * @returns Event, or null when it is not one this script knows.
 */
export function toEvent(o: Record<string, unknown>, notify: boolean): EventInput | null {
	const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
	if (notify) {
		if (o.type !== 'agent-turn-complete') return null;
		return { event: 'agent-turn-complete', sessionId: s(o['thread-id']) ?? 'notify', cwd: s(o.cwd) ?? process.cwd(), lastMessage: s(o['last-assistant-message']) ?? null };
	}
	const event = s(o.hook_event_name);
	if (!event) return null;
	return {
		event,
		sessionId: s(o.session_id) ?? 'session',
		cwd: s(o.cwd) ?? process.cwd(),
		notificationType: s(o.notification_type),
		message: s(o.message),
		toolName: s(o.tool_name),
		errorType: s(o.error_type),
		lastMessage: s(o.last_assistant_message) ?? null,
		transcriptPath: s(o.transcript_path),
	};
}

/**
 * Run for one event: read, handle, write, print.
 *
 * @param harness Which harness called.
 * @param payload Parsed event.
 * @param dir The bridge's folder.
 * @param notify Codex's notify program.
 * @param now Epoch ms.
 * @returns What to print on stdout ('' for nothing).
 */
export function run(harness: Harness, payload: Record<string, unknown>, dir: string, notify = false, now = Date.now()): string {
	const e = toEvent(payload, notify);
	if (!e) return '';
	const h = HARNESSES[harness];
	const key = `${h.prefix}:${e.cwd}`;
	const hash = keyHash(key);
	const file = join(ensureDir(join(dir, 'agents')), `${hash}.json`);
	let raw: unknown = null;
	try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { /* A new comrade. */ }
	const prev = recordFrom(raw, key, basename(e.cwd) || e.cwd, h.title);
	const inboxDir = join(dir, 'inbox', hash);
	const inbox: { file: string; m: InboxMessage }[] = [];
	if (e.event === 'SessionStart' || e.event === 'UserPromptSubmit') {
		let names: string[] = [];
		try { names = readdirSync(inboxDir).filter((n) => n.endsWith('.json')).sort(); } catch { /* Empty inbox. */ }
		for (const n of names) {
			try {
				const m = JSON.parse(readFileSync(join(inboxDir, n), 'utf8')) as InboxMessage;
				if (typeof m.issueId === 'string' && typeof m.text === 'string') inbox.push({ file: n, m });
			} catch { /* Being written, or not ours: left for next time. */ }
		}
	}
	if ((e.event === 'Stop') && !e.lastMessage && e.transcriptPath) e.lastMessage = lastAssistantText(e.transcriptPath);
	const awaitFile = join(dir, 'awaiting', hash, `${keyHash(e.sessionId)}.json`);
	let awaiting: string[] = [];
	try { const a = JSON.parse(readFileSync(awaitFile, 'utf8')); if (Array.isArray(a)) awaiting = a.filter((x) => typeof x === 'string'); } catch { /* Nothing awaited. */ }
	const out = handleEvent(prev, e, inbox, now, awaiting);
	// A message is the agent's only once it is moved out of the inbox: another session may have
	// taken it a moment ago, and then it is not handed over twice.
	const taken = new Set<string>();
	if (out.take.length) {
		const to = ensureDir(join(dir, 'delivered', hash));
		for (const n of out.take) { try { renameSync(join(inboxDir, n), join(to, n)); taken.add(n); } catch { /* Someone else has it. */ } }
		if (taken.size !== out.take.length) {
			const kept = inbox.filter((x) => taken.has(x.file));
			out.awaiting = [...new Set([...awaiting, ...kept.map((x) => x.m.issueId)])];
			out.context = kept.length ? contextFor(kept.map((x) => x.m)) : null;
		}
	}
	if (out.awaiting !== null) {
		if (out.awaiting.length) writeAtomic(join(ensureDir(join(dir, 'awaiting', hash)), `${keyHash(e.sessionId)}.json`), JSON.stringify(out.awaiting));
		else rmSync(awaitFile, { force: true });
	}
	if (out.record) writeAtomic(file, JSON.stringify(out.record));
	if (out.reply) {
		const reply: ReplyFile = { v: FORMAT, key, issueIds: out.reply.issueIds, text: out.reply.text, at: new Date(now).toISOString() };
		writeAtomic(join(ensureDir(join(dir, 'replies')), `${stampName(now)}.json`), JSON.stringify(reply));
	}
	if (!out.context) return '';
	return JSON.stringify({ hookSpecificOutput: { hookEventName: e.event, additionalContext: out.context } });
}

/**
 * Read stdin to the end, or give up after a moment (a harness that sends nothing).
 *
 * @returns Text.
 */
function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		if (process.stdin.isTTY) { resolve(''); return; }
		let text = '';
		const done = (): void => resolve(text);
		const t = setTimeout(done, 2_000);
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (c) => { text += c; if (text.length > 4 * 1024 * 1024) { clearTimeout(t); done(); } });
		process.stdin.on('end', () => { clearTimeout(t); done(); });
		process.stdin.on('error', () => { clearTimeout(t); done(); });
	});
}

/**
 * The script's work: argv in, context out, never a throw. hook-entry.ts adds the time limit.
 *
 * @param argv Arguments after the script name.
 */
export async function main(argv: string[]): Promise<void> {
	try {
		const args = [...argv];
		const at = args.indexOf('--dir');
		const dir = plantDir(at >= 0 ? args.splice(at, 2)[1] : null);
		const which = args.shift();
		const notify = which === 'codex-notify';
		const harness: Harness | null = which === 'claude' ? 'claude' : which === 'codex' || notify ? 'codex' : null;
		if (!harness) return;
		const text = notify ? args[args.length - 1] ?? '' : await readStdin();
		const payload = JSON.parse(text) as Record<string, unknown>;
		if (!payload || typeof payload !== 'object') return;
		const out = run(harness, payload, dir, notify);
		if (out) process.stdout.write(out);
	} catch {
		// Never fail the agent's turn over the plant.
	}
}
