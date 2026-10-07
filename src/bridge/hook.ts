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
 * One comrade is one project folder per harness. A session keeps the folder it started in,
 * even after a `cd` (Claude Code names the project in CLAUDE_PROJECT_DIR; otherwise the first
 * folder the session reported is pinned in sessions/). Sessions in the same folder share the
 * comrade: the record keeps each session's own state, and the comrade shows the most pressing
 * of them (waiting, then working, then error, then idle).
 *
 * Messages are handed over with a prompt (UserPromptSubmit), never at SessionStart, which also
 * fires on a compaction or a resume in the middle of work. The threads handed to a turn live
 * in a file of their own, awaiting/<agent>/<session>.json, touched only by the events that run
 * in step with the agent: the turn's answer (Stop) goes back to them, and the next prompt
 * starts afresh, so an interrupted turn files nothing. Tool events run in the background and
 * may land late: they never touch that list, never take the waiting flag away before the tool
 * has run, and never overwrite a session's state written after they began. Each event changes
 * only its own session in the record, read again just before writing, so two sessions in one
 * folder never undo each other. A message claimed for a turn that then fails to be written goes
 * back to the inbox.
 */
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { utimesSync } from 'node:fs';
import { homedir } from 'node:os';
import { CONTEXT_MAX } from './words';
import { type AgentRecord, type BridgeStatus, FORMAT, HOOK_EVENTS, type InboxMessage, type ReplyFile, WAITING_STALE_MS, ensureDir, keyHash, ownFolder, plantDir, stampName, writeAtomic } from './files';

/** Harnesses this script speaks for: their key prefix and the title the comrade wears. */
export const HARNESSES = { claude: { prefix: 'claude', title: 'Claude Code' }, codex: { prefix: 'codex', title: 'Codex' } } as const;
export type Harness = keyof typeof HARNESSES;

/** Tool events closer together than this for a session already working are not written again. */
export const BEAT_MS = 5_000;
/** A session not heard from in this long is forgotten. */
export const SESSION_STALE_MS = 10 * 60_000;
/** An ended session is kept this long, so a late background event cannot bring it back. */
const ENDED_KEEP_MS = 60_000;
export { CONTEXT_MAX } from './words';
/** Longest answer sent back. */
const REPLY_MAX = 20_000;

/** Events the harness runs in the background: they may land after a later event. */
const BACKGROUND = new Set<string>([...HOOK_EVENTS.claude.background, ...HOOK_EVENTS.codex.background]);

/** One session's part of the record. */
interface SessionState {
	status: BridgeStatus;
	reason: string | null;
	at: number;
	/** The session has ended: kept a moment so a late event cannot bring it back, never shown. */
	ended?: boolean;
}

/** The record this script writes: the adapter fields, plus its sessions. */
export interface HookRecord extends AgentRecord {
	sessions: Record<string, SessionState>;
}

/**
 * The threads handed to a session's turn. Replied once the turn's answer has gone back; a Stop
 * hook that keeps the turn going (stop_hook_active) sends its later answer too.
 */
export interface Awaiting {
	ids: string[];
	replied: boolean;
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
	/** SessionStart's cause: startup, resume, clear, compact, fork. */
	source?: string;
	/** Stop: the turn was kept going by a Stop hook, so this is a later answer in the same turn. */
	stopHookActive?: boolean;
}

/** What handling an event did, for the caller to print and write. */
export interface Outcome {
	/** The record to write, or null to leave the file as it is. */
	record: HookRecord | null;
	/** Context for the agent (SessionStart, UserPromptSubmit), or null. */
	context: string | null;
	/** An answer to send back, or null. */
	reply: { issueIds: string[]; text: string } | null;
	/** The session's awaited threads to write (empty ids: remove the file); null leaves them. */
	awaiting: Awaiting | null;
}

/** Error words per StopFailure error_type. */
const FAILURES: Record<string, string> = {
	rate_limit: 'The model hit its rate limit, so the turn stopped.',
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
		if (now - s.at > (s.ended ? ENDED_KEEP_MS : s.status === 'waiting' ? WAITING_STALE_MS : SESSION_STALE_MS)) delete r.sessions[id];
	}
	const top = Object.values(r.sessions).filter((s) => !s.ended).sort((a, b) => RANK[b.status] - RANK[a.status] || b.at - a.at)[0];
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
			sessions[id] = { status: RANK[v.status] === undefined ? 'idle' : v.status, reason: typeof v.reason === 'string' ? v.reason : null, at: v.at, ...(v.ended === true ? { ended: true } : {}) };
		}
	}
	return { v: FORMAT, key, name, harness: title, status: 'idle', reason: null, updatedAt: '', heartbeatAt: typeof o.heartbeatAt === 'string' ? o.heartbeatAt : null, sessions };
}

/**
 * Words for the agent: the owner's messages, and where its answer goes.
 *
 * @param messages Messages taken from the inbox.
 * @param more True when more wait for the next turn.
 * @returns Context text.
 */
export function contextFor(messages: InboxMessage[], more = false): string {
	const parts = messages.map((m) => `${m.identifier} "${m.title}" (${m.kind === 'directive' ? 'a new directive' : 'a message in that thread'}):\n${m.text}`);
	return [
		`Your owner sent ${messages.length === 1 ? 'a message' : `${messages.length} messages`} through The People's Plant #67, the dashboard that shows their agents at work. ${messages.length === 1 ? 'It is' : 'They are'} from the user, as if typed here.`,
		...parts,
		...(more ? ['More messages are waiting. They come with the next prompt.'] : []),
		'Your final message this turn goes back to them in the plant as your reply.',
	].join('\n\n');
}

/**
 * The messages to hand over this turn: oldest first, up to CONTEXT_MAX characters, and always at
 * least one (cut short if it alone is too long).
 *
 * @param inbox Waiting messages, oldest first.
 * @returns The ones to take.
 */
export function pick<T extends { m: InboxMessage }>(inbox: T[]): T[] {
	const out: T[] = [];
	let used = 0;
	for (const x of inbox) {
		const n = x.m.text.length + x.m.title.length + 80;
		if (out.length && used + n > CONTEXT_MAX) break;
		used += n;
		out.push(x.m.text.length > CONTEXT_MAX ? { ...x, m: { ...x.m, text: `${x.m.text.slice(0, CONTEXT_MAX - 200)}\n[Cut short here. The whole message is in the plant.]` } } : x);
	}
	return out;
}

/**
 * Handle one event. Pure apart from what it is given: the caller reads the files, claims the
 * inbox messages, and writes what comes back.
 *
 * @param prev The record on disk (already read).
 * @param e The event.
 * @param taken Inbox messages this event has claimed for the agent.
 * @param now Epoch ms.
 * @param awaiting This session's awaited threads, or null.
 * @param more True when messages are left in the inbox for the next turn.
 * @returns What to write and print.
 */
export function handleEvent(prev: HookRecord, e: EventInput, taken: InboxMessage[], now: number, awaiting: Awaiting | null = null, more = false): Outcome {
	const r: HookRecord = { ...prev, sessions: { ...prev.sessions } };
	const had = r.sessions[e.sessionId];
	const s: SessionState = had ? { ...had } : { status: 'idle', reason: null, at: now };
	const out: Outcome = { record: r, context: null, reply: null, awaiting: null };
	const beat = (): void => { r.heartbeatAt = new Date(now).toISOString(); };
	const ids = taken.map((m) => m.issueId);
	if (taken.length) out.context = contextFor(taken, more);
	switch (e.event) {
		case 'SessionStart':
			// A new session starts idle. A compaction or a resume can come mid-work: it changes nothing.
			if (had && e.source && e.source !== 'startup' && e.source !== 'clear') return { ...out, record: null };
			s.status = 'idle'; s.reason = null;
			break;
		case 'UserPromptSubmit':
			s.status = 'running'; s.reason = null;
			beat();
			// A new turn: this turn's messages, and nothing carried over from one that never reached Stop.
			if (ids.length) out.awaiting = { ids: [...new Set(ids)], replied: false };
			else if (awaiting) out.awaiting = { ids: [], replied: false };
			break;
		case 'PreToolUse':
			// Before the tool runs, a waiting session is still waiting: the OK has not come yet.
			if (had?.status === 'waiting') return { ...out, record: null };
			// falls through
		case 'PostToolUse':
			// A busy session writes at most every BEAT_MS: tools can fire many times a second.
			if (had?.status === 'running' && now - had.at < BEAT_MS) return { ...out, record: null };
			s.status = 'running'; s.reason = null;
			beat();
			break;
		case 'Notification':
			if (e.notificationType === 'permission_prompt') { s.status = 'waiting'; s.reason = e.message ?? null; }
			else if (e.notificationType === 'idle_prompt') { s.status = 'idle'; s.reason = null; }
			else return { ...out, record: null };
			break;
		case 'PermissionRequest':
			s.status = 'waiting';
			s.reason = e.toolName ? `It asks to use ${e.toolName}.` : null;
			break;
		case 'Stop':
		case 'Interrupt':
		case 'agent-turn-complete':
			s.status = 'idle'; s.reason = null;
			if (e.event === 'agent-turn-complete') beat();
			if (e.event === 'Interrupt') { if (awaiting) out.awaiting = { ids: [], replied: false }; break; }
			if (awaiting?.ids.length && e.lastMessage && e.lastMessage.trim() && (!awaiting.replied || e.stopHookActive)) {
				out.reply = { issueIds: awaiting.ids, text: e.lastMessage.trim().slice(0, REPLY_MAX) };
				out.awaiting = { ids: awaiting.ids, replied: true };
			}
			break;
		case 'StopFailure':
			s.status = 'error';
			s.reason = (e.errorType && FAILURES[e.errorType]) ?? `The turn stopped with an error${e.errorType ? ` (${e.errorType})` : ''}.`;
			break;
		case 'SessionEnd':
			r.sessions[e.sessionId] = { status: 'idle', reason: null, at: now, ended: true };
			settle(r, now);
			// Anything still unanswered will not be: the session is gone.
			return { ...out, awaiting: awaiting ? { ids: [], replied: false } : null };
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
			// The turn's own prompt: anything older belongs to an earlier turn.
			if (o.type === 'user') {
				const c = o.message?.content;
				const prompt = typeof c === 'string' || (Array.isArray(c) && c.some((x) => x && x.type === 'text'));
				if (prompt) return null;
				continue;
			}
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
		source: s(o.source),
		stopHookActive: o.stop_hook_active === true,
	};
}

/**
 * Read a small JSON file, or null.
 *
 * @param path File.
 * @returns Parsed value or null.
 */
function readJson(path: string): unknown {
	// Plain files only: a pipe would hold the agent's turn until the harness gave up on the hook.
	try { return lstatSync(path).isFile() ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; }
}

/**
 * The project folder a session belongs to: Claude Code's CLAUDE_PROJECT_DIR when it is set,
 * else the folder pinned when the session was first heard from, else the event's own folder
 * (which is then pinned). A `cd` during the session never makes a second comrade.
 *
 * @param dir The bridge's folder.
 * @param harness Harness.
 * @param e Event.
 * @param env Environment.
 * @returns Absolute project folder.
 */
export function projectOf(dir: string, harness: Harness, e: EventInput, env: NodeJS.ProcessEnv): string {
	const named = harness === 'claude' ? env.CLAUDE_PROJECT_DIR : undefined;
	// Taken only when it holds the folder the event comes from: it names this session's project.
	if (named && named.startsWith('/') && (e.cwd === named || e.cwd.startsWith(named.endsWith('/') ? named : `${named}/`))) return named;
	// Nothing to pin by without a real session id (Codex's notify program sends none of its own).
	if (e.event === 'agent-turn-complete' || e.sessionId === 'session') return e.cwd;
	const pin = join(dir, 'sessions', `${keyHash(`${harness}:${e.sessionId}`)}.json`);
	const kept = readJson(pin) as { cwd?: unknown } | null;
	if (kept && typeof kept.cwd === 'string') {
		if (e.event === 'SessionEnd') rmSync(pin, { force: true });
		// A session still at work keeps its pin from the bridge's weekly sweep.
		else { try { if (Date.now() - statSync(pin).mtimeMs > 86_400_000) utimesSync(pin, new Date(), new Date()); } catch { /* Kept as it is. */ } }
		return kept.cwd;
	}
	const root = gitRoot(e.cwd);
	// A late background event after SessionEnd must not pin the session again.
	if (e.event !== 'SessionEnd' && !BACKGROUND.has(e.event)) {
		try { writeAtomic(join(ensureDir(join(dir, 'sessions')), basename(pin)), JSON.stringify({ cwd: root, at: Date.now() })); } catch { /* Unpinned: the event's folder stands. */ }
	}
	return root;
}

/**
 * The project a folder belongs to: the top of its git work tree when it is in one (below the
 * home folder, which may itself be a dotfiles repository), else the folder itself. A session
 * started in proj/src is then the comrade "proj".
 *
 * @param cwd Folder.
 * @returns Project folder.
 */
export function gitRoot(cwd: string): string {
	const home = homedir();
	for (let p = cwd; p !== home; p = dirname(p)) {
		if (existsSync(join(p, '.git'))) return p;
		if (dirname(p) === p) break;
	}
	return cwd;
}

/**
 * Run for one event: read, claim, handle, write, print.
 *
 * @param harness Which harness called.
 * @param payload Parsed event.
 * @param dir The bridge's folder.
 * @param notify Codex's notify program.
 * @param now Epoch ms (when the event began).
 * @param env Environment (CLAUDE_PROJECT_DIR).
 * @returns What to print on stdout ('' for nothing).
 */
export function run(harness: Harness, payload: Record<string, unknown>, dir: string, notify = false, now = Date.now(), env: NodeJS.ProcessEnv = process.env): string {
	const e = toEvent(payload, notify);
	if (!e) return '';
	// The folder must be there already (the bridge and the installer make it), and it and every
	// folder above it closed to other users. Anything else, such as a folder that vanished and
	// was made again by someone else, is never used, and the hook does nothing at all.
	if (!ownFolder(dir)) return '';
	const h = HARNESSES[harness];
	const project = projectOf(dir, harness, e, env);
	const key = `${h.prefix}:${project}`;
	const hash = keyHash(key);
	const file = join(ensureDir(join(dir, 'agents')), `${hash}.json`);
	const prev = recordFrom(readJson(file), key, basename(project) || project, h.title);

	// Claim this turn's messages first: a message is the agent's only once it is moved out of
	// the inbox, so one another session took a moment ago is never handed over twice.
	const inboxDir = join(dir, 'inbox', hash);
	const delivered = join(dir, 'delivered', hash);
	const claimed: { file: string; m: InboxMessage }[] = [];
	let more = false;
	if (e.event === 'UserPromptSubmit') {
		let names: string[] = [];
		try { names = readdirSync(inboxDir).filter((n) => n.endsWith('.json')).sort(); } catch { /* Empty inbox. */ }
		const waiting: { file: string; m: InboxMessage }[] = [];
		for (const n of names) {
			const m = readJson(join(inboxDir, n)) as InboxMessage | null;
			if (m && typeof m.issueId === 'string' && typeof m.text === 'string' && typeof m.title === 'string') waiting.push({ file: n, m });
		}
		const chosen = pick(waiting);
		more = chosen.length < waiting.length;
		if (chosen.length) {
			ensureDir(delivered);
			for (const x of chosen) { try { renameSync(join(inboxDir, x.file), join(delivered, x.file)); claimed.push(x); } catch { /* Someone else has it. */ } }
		}
	}

	try {
		if (e.event === 'Stop' && !e.lastMessage && e.transcriptPath) e.lastMessage = lastAssistantText(e.transcriptPath);
		const awaitFile = join(dir, 'awaiting', hash, `${keyHash(e.sessionId)}.json`);
		const a = readJson(awaitFile) as Partial<Awaiting> | null;
		const awaiting: Awaiting | null = a && Array.isArray(a.ids) ? { ids: a.ids.filter((x): x is string => typeof x === 'string'), replied: a.replied === true } : null;
		const out = handleEvent(prev, e, claimed.map((x) => x.m), now, awaiting, more);

		// The answer first: once the awaited list says replied, the answer must already be on disk.
		if (out.reply) {
			const reply: ReplyFile = { v: FORMAT, key, issueIds: out.reply.issueIds, text: out.reply.text, at: new Date(now).toISOString() };
			writeAtomic(join(ensureDir(join(dir, 'replies')), `${stampName(now)}.json`), JSON.stringify(reply));
		}
		const writeAwaiting = (): void => {
			if (out.awaiting) {
				if (out.awaiting.ids.length) writeAtomic(join(ensureDir(join(dir, 'awaiting', hash)), basename(awaitFile)), JSON.stringify(out.awaiting));
				else rmSync(awaitFile, { force: true });
			}
		};
		// A Stop marks the turn answered straight after the answer is on disk, so a failure writing
		// the record cannot let a later Stop send it twice. A prompt writes its list last, so a
		// failure before it leaves nothing awaiting messages the agent never saw.
		if (out.reply) writeAwaiting();
		if (out.record) {
			// Only this session changes, on the record as it is now: another session may have
			// written since this one was read. A background event that lands after a later event
			// of its own session (or after the session ended) changes nothing.
			const fresh = recordFrom(readJson(file), key, out.record.name, out.record.harness);
			const mine = out.record.sessions[e.sessionId];
			const late = BACKGROUND.has(e.event) && (fresh.sessions[e.sessionId]?.at ?? -Infinity) > now;
			if (!late) {
				// Only the notify program cannot hand messages over.
				fresh.hears = !notify;
				if (mine) fresh.sessions[e.sessionId] = mine;
				else delete fresh.sessions[e.sessionId];
				if (out.record.heartbeatAt && (!fresh.heartbeatAt || out.record.heartbeatAt > fresh.heartbeatAt)) fresh.heartbeatAt = out.record.heartbeatAt;
				settle(fresh, now);
				writeAtomic(file, JSON.stringify(fresh));
			}
		}
		if (!out.reply) writeAwaiting();
		if (!out.context) return '';
		return JSON.stringify({ hookSpecificOutput: { hookEventName: e.event, additionalContext: out.context } });
	} catch (err) {
		// Anything claimed goes back to the inbox for the next prompt: never lost between the two.
		// The awaited list is written last, so a failure before it leaves the old list in place.
		for (const x of claimed) { try { renameSync(join(delivered, x.file), join(inboxDir, x.file)); } catch { /* The bridge took it already. */ } }
		throw err;
	}
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
 * The script's work: argv in, what to print out, never a throw. hook-entry.ts prints it, adds
 * the time limit and exits.
 *
 * @param argv Arguments after the script name.
 * @returns Text for stdout ('' for nothing).
 */
export async function main(argv: string[]): Promise<string> {
	const now = Date.now();
	try {
		const args = [...argv];
		const at = args.indexOf('--dir');
		const dir = plantDir(at >= 0 ? args.splice(at, 2)[1] : null);
		const which = args.shift();
		const notify = which === 'codex-notify';
		const harness: Harness | null = which === 'claude' ? 'claude' : which === 'codex' || notify ? 'codex' : null;
		if (!harness) return '';
		const text = notify ? args[args.length - 1] ?? '' : await readStdin();
		const payload = JSON.parse(text) as Record<string, unknown>;
		if (!payload || typeof payload !== 'object') return '';
		return run(harness, payload, dir, notify, now);
	} catch {
		// Never fail the agent's turn over the plant.
		return '';
	}
}
