/**
 * The bridge's answers to the Plant Protocol (docs/PLANT-PROTOCOL.md), from the files in its
 * folder (see files.ts). Request in, response out, with no network of its own: server.ts puts
 * it on a socket, and the tests call it directly. Reads also take in what the hooks have
 * written since (deliveries and answers), so a GET can change threads.json.
 *
 * Tier 1 (the living plant) is answered in full: one company, "The Plant", whose agents are the
 * agents/*.json files. Tier 2 (directives) is answered with threads the bridge keeps in
 * threads.json: a directive or a message from the owner is also written to the agent's inbox,
 * where its hook picks it up on the agent's next turn, and the agent's answer comes back
 * through replies/. Approvals are always empty. The chat tab, questions and files are routes
 * the bridge does not have, so the plant hides them.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { withoutFooter } from '../live/directives';
import { NPX, OWNER_TEXT_MAX, type Wiring } from './words';
import { AGENT_STATUSES, type AgentRecord, FORMAT, WAITING_STALE_MS, type InboxMessage, type ReplyFile, ensureDir, keyHash, stampName, uuidFrom, writeAtomic } from './files';

/** The one company the bridge serves. */
export const BRIDGE_COMPANY_ID = uuidFrom('company');
export const BRIDGE_COMPANY_NAME = 'The Plant';
/** The owner, as the plant's chat tells their messages from an agent's. */
export const BRIDGE_OWNER_ID = uuidFrom('owner');

/** A running agent not heard from in this long has stopped without saying so: it reads idle. */
export const RUNNING_STALE_MS = 10 * 60_000;
/** An agent not heard from in this long leaves the roster. */
export const GONE_MS = 7 * 86_400_000;
/** Said when a message is for a comrade who has left the roster. */
const LEFT = 'Nobody has worked in that folder for a week, so nobody would read this. Start a session there and they come back.';
/** Largest agent or reply file read; anything bigger is skipped. Room for TEXT_MAX of any script. */
export const FILE_MAX = 256 * 1024;
/** Longest agent key taken: longer ones are not an agent the hooks could have written. */
const KEY_MAX = 1000;
/** Longest name, reason, title and message kept. */
const NAME_MAX = 60, REASON_MAX = 300, TITLE_MAX = 200, TEXT_MAX = 20_000;
export { OWNER_TEXT_MAX } from './words';
const TOO_LONG = `That is longer than the plant can hand an agent in one go. Keep it under ${OWNER_TEXT_MAX.toLocaleString('en-GB')} characters, or send it in parts.`;
const UNSAVED = 'The plant could not save that on this computer, so it was not sent. Check there is room on the disk, then send it again.';

/** A delivery younger than this is left alone: the hook may still put it back if its turn fails. */
const DELIVERY_SETTLE_MS = 5_000;
/** Most threads kept; the oldest go first, with their messages. */
const THREADS_KEPT = 500;
/** Most activity records kept, newest first. */
const ACTIVITY_KEEP = 200;

/** A response: a status and a JSON body. */
export interface Answer {
	status: number;
	body: unknown;
}

interface Issue {
	id: string;
	companyId: string;
	identifier: string;
	title: string;
	description: string | null;
	status: string;
	assigneeAgentId: string;
	createdByUserId: string;
	createdByAgentId: null;
	createdAt: string;
	updatedAt: string;
}

interface Comment {
	id: string;
	issueId: string;
	body: string;
	createdAt: string;
	authorAgentId: string | null;
	authorUserId: string | null;
	authorType: 'agent' | 'user';
	clientRequestId?: string;
}

interface Activity {
	id: string;
	companyId: string;
	actorType: 'agent' | 'user' | 'system';
	actorId: string;
	action: string;
	entityType: string;
	entityId: string;
	agentId: string | null;
	details: Record<string, unknown>;
	createdAt: string;
}

/** What threads.json holds. */
interface Book {
	v: 1;
	seq: number;
	issues: Issue[];
	comments: Comment[];
	activity: Activity[];
	/** Agent ids seen at least once, so a newcomer is announced once. */
	seen: string[];
}

/** One agent as the plant draws it, with the key its files are named by. */
interface Live {
	key: string;
	state: {
		id: string; name: string; title: string; role: null; status: string; pauseReason: string | null; errorReason: string | null;
		lastHeartbeatAt: string | null; reportsTo: null; urlKey: null;
	};
	updatedAt: number;
	/** The agent can be handed messages (its adapter takes the inbox). */
	hears: boolean;
}

export interface BridgeOptions {
	/** The bridge's folder. */
	dir: string;
	now?: () => number;
	/** Problems worth a line in the terminal (a file that could not be read, say). */
	log?: (line: string) => void;
	/** How to wire each harness to this bridge, and anything wrong with the wiring, for the plant's page. */
	wiring?: () => Wiring;
}

export interface Bridge {
	/**
	 * Answer one request.
	 *
	 * @param method HTTP method.
	 * @param url Path and query.
	 * @param body Parsed JSON body, or undefined.
	 * @returns Answer.
	 */
	handle(method: string, url: string, body?: unknown): Answer;
	/** Take in answers and deliveries the hooks have written. Called on every roster read too. */
	ingest(): void;
}

/**
 * Text cut to one tidy line of at most max characters, or null.
 *
 * @param v Value.
 * @param max Longest.
 * @returns Text or null.
 */
function line(v: unknown, max: number): string | null {
	if (typeof v !== 'string') return null;
	const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
	return t || null;
}

/**
 * JSON files in a folder, oldest name first, or none when the folder is missing.
 *
 * @param dir Folder.
 * @returns File names.
 */
function jsonFiles(dir: string): string[] {
	try { return readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
}

/** A temporary file older than this was left by a hook stopped mid-write: it is cleared away. */
export const TMP_STALE_MS = 60_000;

/**
 * Clear away what hooks leave behind: temporary files from a write the harness cut short, and
 * the folder pins of sessions that ended without saying so.
 *
 * @param dir Folder.
 * @param age Older than this, in ms, goes.
 * @param ending File names ending so.
 */
function sweep(dir: string, age: number, ending: string): void {
	if (!existsSync(dir)) return;
	let names: string[] = [];
	try { names = readdirSync(dir).filter((n) => n.endsWith(ending)); } catch { return; }
	for (const n of names) {
		try { if (Date.now() - statSync(join(dir, n)).mtimeMs > age) rmSync(join(dir, n), { force: true }); } catch { /* Gone already. */ }
	}
}

/**
 * Read a small JSON file, or null when it is missing, too big, not JSON, or not a plain file
 * (a link, a pipe or a device could stall the bridge or point anywhere).
 *
 * @param path File.
 * @returns Parsed value or null.
 */
function readSmall(path: string): unknown {
	try {
		const st = lstatSync(path);
		if (!st.isFile() || st.size > FILE_MAX) return null;
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * Read one agents/*.json record into what the plant draws, or null when it is not one.
 *
 * @param raw Parsed file.
 * @param now Epoch ms.
 * @returns Live agent, or null (malformed, or gone quiet for GONE_MS).
 */
export function toLive(raw: unknown, now: number): Live | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Partial<AgentRecord>;
	const key = typeof o.key === 'string' && o.key.trim() && o.key.length <= KEY_MAX ? o.key : null;
	const updatedAt = typeof o.updatedAt === 'string' ? Date.parse(o.updatedAt) : NaN;
	if (!key || !Number.isFinite(updatedAt) || now - updatedAt > GONE_MS) return null;
	let status: string = (AGENT_STATUSES as readonly string[]).includes(o.status as string) ? o.status as string : 'idle';
	const quiet = now - updatedAt;
	if ((status === 'running' && quiet > RUNNING_STALE_MS) || (status === 'waiting' && quiet > WAITING_STALE_MS)) status = 'idle';
	const reason = line(o.reason, REASON_MAX);
	const beat = typeof o.heartbeatAt === 'string' && Number.isFinite(Date.parse(o.heartbeatAt)) ? new Date(Date.parse(o.heartbeatAt)).toISOString() : null;
	return {
		key,
		updatedAt,
		hears: o.hears !== false,
		state: {
			id: uuidFrom(`agent:${key}`),
			name: line(o.name, NAME_MAX) ?? 'Nameless comrade',
			title: line(o.harness, NAME_MAX) ?? 'Agent',
			role: null,
			status,
			// For waiting, what the agent waits for ("Claude needs your permission to use Bash").
			pauseReason: status === 'paused' || status === 'waiting' ? reason : null,
			errorReason: status === 'error' ? reason : null,
			lastHeartbeatAt: beat,
			reportsTo: null,
			urlKey: null,
		},
	};
}

/**
 * Build the bridge over a folder. threads.json is read once here and written on every change.
 *
 * @param o Options.
 * @returns Bridge.
 */
export function createBridge(o: BridgeOptions): Bridge {
	const now = o.now ?? Date.now;
	const log = o.log ?? (() => {});
	const dir = ensureDir(o.dir);
	const bookPath = join(dir, 'threads.json');
	const book = loadBook(bookPath, log);
	/** The roster from the last read, by plant id. */
	let roster = new Map<string, Live>();

	/**
	 * Keep the book on disk.
	 *
	 * @returns False when it could not be written (said in the terminal too).
	 */
	const save = (): boolean => {
		// The book stays a size the bridge can rewrite whole on every change: the threads quiet
		// longest go first. One still waiting for or in the hands of an agent stays, unless
		// nothing has happened in it for as long as an agent takes to leave the roster.
		// Worked out on a copy, and kept only once it is on disk: a save that fails drops nothing,
		// so the next one works it out again.
		let dropped = new Set<string>();
		let kept = book;
		if (book.issues.length > THREADS_KEPT) {
			const at = now();
			const live = (i: Issue): boolean => (i.status === 'todo' || i.status === 'in_progress') && at - Date.parse(i.updatedAt) < GONE_MS;
			const quiet = book.issues.filter((i) => !live(i)).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
			dropped = new Set(quiet.slice(0, book.issues.length - THREADS_KEPT).map((i) => i.id));
			kept = { ...book, issues: book.issues.filter((i) => !dropped.has(i.id)), comments: book.comments.filter((c) => !dropped.has(c.issueId)) };
		}
		try { writeAtomic(bookPath, JSON.stringify(kept)); } catch (err) { log(`Could not save threads.json: ${(err as Error).message}`); return false; }
		book.issues = kept.issues;
		book.comments = kept.comments;
		// Once the book is saved, a message for a dropped thread is not handed to an agent: its
		// answer would have nowhere to go.
		if (dropped.size) {
			let boxes: string[] = [];
			try { boxes = readdirSync(join(dir, 'inbox')); } catch { /* No inbox yet. */ }
			for (const box of boxes) {
				for (const n of jsonFiles(join(dir, 'inbox', box))) {
					const m = readSmall(join(dir, 'inbox', box, n)) as Partial<InboxMessage> | null;
					if (m && typeof m.issueId === 'string' && dropped.has(m.issueId)) rmSync(join(dir, 'inbox', box, n), { force: true });
				}
			}
		}
		return true;
	};
	const iso = (): string => new Date(now()).toISOString();
	const note = (a: Omit<Activity, 'id' | 'companyId' | 'createdAt'>): void => {
		book.activity.unshift({ id: randomUUID(), companyId: BRIDGE_COMPANY_ID, createdAt: iso(), ...a });
		book.activity.length = Math.min(book.activity.length, ACTIVITY_KEEP);
	};

	/**
	 * Clear away what hooks and crashed writes leave behind: temporary files anywhere in the
	 * folder, and the pins and awaited lists of sessions not heard from in a week.
	 */
	function tidy(): void {
		const subs = (d: string): string[] => { try { return readdirSync(join(dir, d)).map((n) => join(dir, d, n)); } catch { return []; } };
		for (const d of [join(dir, 'agents'), join(dir, 'replies'), ...subs('inbox'), ...subs('delivered'), ...subs('awaiting')]) sweep(d, TMP_STALE_MS, '.tmp');
		sweep(join(dir, 'sessions'), GONE_MS, '.json');
		for (const d of subs('awaiting')) sweep(d, GONE_MS, '.json');
	}

	/** Read every agent file: the roster. Newcomers are announced in the activity feed once. */
	function readRoster(): Live[] {
		const at = now();
		const byId = new Map<string, Live>();
		tidy();
		for (const name of jsonFiles(join(dir, 'agents'))) {
			const live = toLive(readSmall(join(dir, 'agents', name)), at);
			if (!live) continue;
			// Two files naming the same key: the newer one stands.
			const had = byId.get(live.state.id);
			if (!had || had.updatedAt < live.updatedAt) byId.set(live.state.id, live);
		}
		let changed = false;
		for (const a of byId.values()) {
			if (book.seen.includes(a.state.id)) continue;
			book.seen.push(a.state.id);
			note({ actorType: 'system', actorId: a.state.id, action: 'agent.created', entityType: 'agent', entityId: a.state.id, agentId: null, details: { name: a.state.name } });
			changed = true;
		}
		if (changed) save();
		// One name twice: told apart by the folder above (~/a/app, ~/b/app) where that differs, and
		// by the harness (Claude Code and Codex in one folder) where that does.
		const named = new Map<string, Live[]>();
		for (const a of byId.values()) named.set(a.state.name, [...(named.get(a.state.name) ?? []), a]);
		for (const twins of named.values()) {
			if (twins.length < 2) continue;
			const above = (a: Live): string => { const path = a.key.slice(a.key.indexOf(':') + 1).replace(/\/+$/, ''); return path.startsWith('/') ? basename(dirname(path)) : ''; };
			const byFolder = new Set(twins.map(above)).size > 1;
			const byHarness = new Set(twins.map((a) => a.state.title)).size > 1;
			for (const a of twins) {
				const parts = [...(byFolder && above(a) ? [above(a)] : []), ...(byHarness ? [a.state.title] : [])];
				if (parts.length) a.state = { ...a.state, name: `${a.state.name} (${parts.join(', ')})`.slice(0, NAME_MAX + 40) };
			}
		}
		roster = byId;
		return [...byId.values()].sort((x, y) => x.state.name.localeCompare(y.state.name) || x.state.id.localeCompare(y.state.id));
	}

	/**
	 * Put a message from the owner in an agent's inbox.
	 *
	 * @param issue The thread.
	 * @param text What the owner wrote.
	 * @param kind New directive or a message in the thread.
	 * @returns False when the agent is not on the roster (nothing written).
	 */
	function post(issue: Issue, text: string, kind: InboxMessage['kind']): boolean {
		const who = roster.get(issue.assigneeAgentId);
		if (!who) return false;
		const box = ensureDir(join(dir, 'inbox', keyHash(who.key)));
		const m: InboxMessage = { v: FORMAT, issueId: issue.id, identifier: issue.identifier, title: issue.title, text, kind, at: iso() };
		writeAtomic(join(box, `${stampName(now())}.json`), JSON.stringify(m));
		return true;
	}

	/**
	 * Whether a message for a thread still waits in an agent's inbox.
	 *
	 * @param box The agent's inbox folder name.
	 * @param issueId Thread.
	 * @returns True when one does.
	 */
	function waitingFor(box: string, issueId: string): boolean {
		return jsonFiles(join(dir, 'inbox', box)).some((n) => (readSmall(join(dir, 'inbox', box, n)) as Partial<InboxMessage> | null)?.issueId === issueId);
	}

	/** How many messages wait in inboxes, for the inbox badge. */
	function waiting(): number {
		let n = 0;
		try { for (const d of readdirSync(join(dir, 'inbox'))) n += jsonFiles(join(dir, 'inbox', d)).length; } catch { /* No inbox yet. */ }
		return n;
	}

	function ingest(): void {
		let changed = false;
		// Deliveries: the agent has the message, so its thread is in hand.
		let boxes: string[] = [];
		try { boxes = readdirSync(join(dir, 'delivered')); } catch { /* None yet. */ }
		for (const d of boxes) {
			const folder = join(dir, 'delivered', d);
			for (const name of jsonFiles(folder)) {
				// ctime, not mtime: a rename keeps the time the message was written, and it may have
				// waited in the inbox for hours. The file system's clock, so the real one here.
				try { if (Date.now() - statSync(join(folder, name)).ctimeMs < DELIVERY_SETTLE_MS) continue; } catch { continue; }
				const m = readSmall(join(folder, name)) as Partial<InboxMessage> | null;
				const issue = m && book.issues.find((i) => i.id === m.issueId);
				// Handed over only once nothing newer for the thread still waits in the inbox.
				if (issue && issue.status === 'todo' && !waitingFor(d, issue.id)) { issue.status = 'in_progress'; issue.updatedAt = iso(); changed = true; }
				rmSync(join(folder, name), { force: true });
			}
		}
		// Answers: filed in the threads the agent was given, and only those assigned to it.
		const replies = join(dir, 'replies');
		for (const name of jsonFiles(replies)) {
			const path = join(replies, name);
			const r = readSmall(path) as Partial<ReplyFile> | null;
			rmSync(path, { force: true });
			const text = r && typeof r.text === 'string' ? r.text.trim().slice(0, TEXT_MAX) : '';
			if (!r || typeof r.key !== 'string' || !Array.isArray(r.issueIds) || !text) { log(`Skipped a reply file that is not one: ${name}`); continue; }
			const agentId = uuidFrom(`agent:${r.key}`);
			for (const id of new Set(r.issueIds)) {
				const issue = book.issues.find((i) => i.id === id && i.assigneeAgentId === agentId);
				if (!issue) { log(`An answer came from ${r.key} for a thread the plant no longer keeps, so it was not filed.`); continue; }
				const at = typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) ? new Date(Date.parse(r.at)).toISOString() : iso();
				book.comments.push({ id: randomUUID(), issueId: issue.id, body: text, createdAt: at, authorAgentId: agentId, authorUserId: null, authorType: 'agent' });
				issue.updatedAt = at;
				issue.status = 'answered';
				note({ actorType: 'agent', actorId: agentId, action: 'issue.comment_added', entityType: 'issue', entityId: issue.id, agentId, details: { identifier: issue.identifier, issueTitle: issue.title } });
				changed = true;
			}
		}
		if (changed) save();
	}

	const ok = (body: unknown, status = 200): Answer => ({ status, body });
	/** Said for a comrade whose adapter cannot hand messages over (only Codex's notify program). */
	/**
	 * Why an agent cannot be sent messages: its adapter only reports, and cannot hand it the inbox.
	 * The one adapter that ships like this is Codex's notify program, so its fix is spelled out.
	 *
	 * @param who The agent.
	 * @returns Sentence(s).
	 */
	const deaf = (who: Live): string => who.state.title === 'Codex'
		? `This Codex only tells the plant when a turn ends, so it cannot read messages. Run ${o.wiring ? o.wiring().codex : `${NPX} hooks codex`}, then type /hooks in Codex and trust the plant's hooks.`
		: `${who.state.name} only tells the plant what it is doing, so it cannot read messages.`;
	const no = (status: number, error: string): Answer => ({ status, body: { error } });

	function handle(method: string, url: string, body?: unknown): Answer {
		const u = new URL(url, 'http://bridge');
		const p = u.pathname;
		const q = u.searchParams;
		const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
		const base = `/api/companies/${BRIDGE_COMPANY_ID}`;

		if (method === 'GET') {
			// Routes of the bridge itself (server.ts answers /api/plant-bridge before it gets here).
			if (p === '/api/plant-bridge') return ok({ bridge: true, format: FORMAT });
			if (p === '/api/plant-bridge/wiring') return o.wiring ? ok(o.wiring()) : no(404, 'Route not found');
			if (p === '/api/companies') return ok([{ id: BRIDGE_COMPANY_ID, name: BRIDGE_COMPANY_NAME }]);
			if (p === '/api/auth/get-session') return ok({ session: { id: 'bridge', userId: BRIDGE_OWNER_ID }, user: { id: BRIDGE_OWNER_ID, name: 'The Owner' } });
		}
		const company = p.match(/^\/api\/companies\/([^/]+)(\/.*)$/);
		if (company && company[1] !== BRIDGE_COMPANY_ID) return no(404, 'Company not found');
		if (method === 'GET') {
			if (p === `${base}/agents`) { ingest(); return ok(readRoster().map((a) => a.state)); }
			// Approvals: comrades waiting for the owner's OK in a terminal, the bridge's nearest thing.
			if (p === `${base}/sidebar-badges`) return ok({ inbox: waiting(), approvals: [...roster.values()].filter((a) => a.state.status === 'waiting').length, failedRuns: [...roster.values()].filter((a) => a.state.status === 'error').length, joinRequests: 0 });
			if (p === `${base}/approvals`) return ok([]);
			if (p === `${base}/heartbeat-runs`) return ok([]);
			if (p === `${base}/activity`) return ok(q.get('entityId') ? [] : book.activity.slice(0, Math.min(Number(q.get('limit')) || 50, ACTIVITY_KEEP)));
			if (p === `${base}/issues`) {
				ingest();
				const who = q.get('assigneeAgentId');
				const find = q.get('q')?.toLowerCase();
				const list = book.issues.filter((i) => (!who || i.assigneeAgentId === who) && (!find || i.title.toLowerCase().includes(find)));
				return ok(list.slice(-(Number(q.get('limit')) || 50)).reverse());
			}
			const agent = p.match(/^\/api\/agents\/([^/]+)$/);
			if (agent) {
				const a = roster.get(agent[1]);
				return a ? ok({ ...a.state, budgetMonthlyCents: null, spentMonthlyCents: null, pausedAt: null }) : no(404, 'Agent not found');
			}
		}
		if (method === 'POST' && p === `${base}/issues`) {
			readRoster();
			const title = line(b.title, TITLE_MAX);
			const to = typeof b.assigneeAgentId === 'string' ? b.assigneeAgentId : '';
			if (!title) return no(422, 'A directive needs some words.');
			if (!to) return no(422, 'Say which agent the directive is for, in assigneeAgentId.');
			if (!roster.has(to)) return no(409, LEFT);
			if (!roster.get(to)!.hears) return no(409, deaf(roster.get(to)!));
			const text = (typeof b.description === 'string' ? withoutFooter(b.description) : '').trim().slice(0, TEXT_MAX) || title;
			if (text.length > OWNER_TEXT_MAX) return no(422, TOO_LONG);
			const at = iso();
			const issue: Issue = { id: randomUUID(), companyId: BRIDGE_COMPANY_ID, identifier: `PLT-${book.seq + 1}`, title, description: text, status: 'todo', assigneeAgentId: to, createdByUserId: BRIDGE_OWNER_ID, createdByAgentId: null, createdAt: at, updatedAt: at };
			// Kept first, then handed to the inbox: a directive the page is told was sent is on disk,
			// and one that could not reach the inbox is taken back out.
			book.seq++;
			book.issues.push(issue);
			if (!save()) { book.issues.pop(); book.seq--; return no(500, UNSAVED); }
			try { post(issue, text, 'directive'); } catch { book.issues.pop(); book.seq--; save(); return no(500, UNSAVED); }
			note({ actorType: 'user', actorId: BRIDGE_OWNER_ID, action: 'issue.created', entityType: 'issue', entityId: issue.id, agentId: null, details: { identifier: issue.identifier, title } });
			save();
			return ok(issue, 201);
		}
		if (company?.[2].startsWith('/chats/')) return no(404, 'API route not found');

		const thread = p.match(/^\/api\/issues\/([^/]+)(\/comments|\/read|\/attachments|\/interactions)?$/);
		if (thread) {
			const issue = book.issues.find((i) => i.id === thread[1]);
			if (!issue) return no(404, 'Issue not found');
			const part = thread[2] ?? '';
			if (method === 'GET' && !part) return ok(issue);
			if (method === 'GET' && (part === '/attachments' || part === '/interactions')) return ok([]);
			if (method === 'POST' && part === '/read') return ok({ ok: true });
			if (method === 'GET' && part === '/comments') {
				ingest();
				const all = book.comments.filter((c) => c.issueId === issue.id).sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt));
				const ordered = q.get('order') === 'desc' ? all.reverse() : all;
				return ok(ordered.slice(0, Number(q.get('limit')) || ordered.length));
			}
			if (method === 'POST' && part === '/comments') {
				const text = typeof b.body === 'string' ? b.body.trim().slice(0, TEXT_MAX) : '';
				if (!text) return no(422, 'A message needs some words.');
				if (text.length > OWNER_TEXT_MAX) return no(422, TOO_LONG);
				if (Array.isArray(b.attachmentIds) && b.attachmentIds.length) return no(422, 'The bridge cannot carry files.');
				// A retried send is recorded once.
				const rid = typeof b.clientRequestId === 'string' ? b.clientRequestId : null;
				const again = rid ? book.comments.find((c) => c.clientRequestId === rid && c.issueId === issue.id) : null;
				if (again) return ok(again, 201);
				readRoster();
				if (!roster.has(issue.assigneeAgentId)) return no(409, LEFT);
				if (!roster.get(issue.assigneeAgentId)!.hears) return no(409, deaf(roster.get(issue.assigneeAgentId)!));
				const c: Comment = { id: randomUUID(), issueId: issue.id, body: text, createdAt: iso(), authorAgentId: null, authorUserId: BRIDGE_OWNER_ID, authorType: 'user', ...(rid ? { clientRequestId: rid } : {}) };
				const before = { status: issue.status, updatedAt: issue.updatedAt };
				book.comments.push(c);
				issue.updatedAt = c.createdAt;
				issue.status = 'todo';
				const undo = (): void => { book.comments.pop(); Object.assign(issue, before); };
				if (!save()) { undo(); return no(500, UNSAVED); }
				try { post(issue, text, 'message'); } catch { undo(); save(); return no(500, UNSAVED); }
				return ok(c, 201);
			}
		}
		return no(404, 'Route not found');
	}

	return { handle, ingest };
}

/**
 * Read threads.json, or start a fresh book when it is missing or unreadable (the old one is
 * kept beside it, so nothing is lost).
 *
 * @param path threads.json.
 * @param log Logger.
 * @returns Book.
 */
function loadBook(path: string, log: (l: string) => void): Book {
	const fresh: Book = { v: FORMAT, seq: 0, issues: [], comments: [], activity: [], seen: [] };
	if (!existsSync(path)) return fresh;
	try {
		const o = JSON.parse(readFileSync(path, 'utf8')) as Partial<Book>;
		if (o && Array.isArray(o.issues) && Array.isArray(o.comments)) {
			// Checked item by item where it enters: one bad entry is dropped, not every request after it.
			const str = (v: unknown): boolean => typeof v === 'string';
			const issues = o.issues.filter((i): i is Issue => !!i && ['id', 'identifier', 'title', 'status', 'assigneeAgentId', 'createdAt', 'updatedAt'].every((k) => str((i as unknown as Record<string, unknown>)[k])));
			const comments = o.comments.filter((c): c is Comment => !!c && ['id', 'issueId', 'body', 'createdAt'].every((k) => str((c as unknown as Record<string, unknown>)[k])) && (c.authorType === 'agent' || c.authorType === 'user'));
			const activity = Array.isArray(o.activity) ? o.activity.filter((x): x is Activity => !!x && str(x.action) && str(x.createdAt)) : [];
			const seen = Array.isArray(o.seen) ? o.seen.filter(str) as string[] : [];
			if (issues.length !== o.issues.length || comments.length !== o.comments.length) keep(path, log, 'had entries the bridge could not read, so it left them out');
			return { v: FORMAT, seq: Math.max(Number(o.seq) || 0, issues.length), issues, comments, activity, seen };
		}
	} catch { /* Kept below. */ }
	keep(path, log, 'could not be read, so the bridge starts a fresh one');
	return fresh;
}

/**
 * Keep a copy of threads.json beside it before the bridge reads past part or all of it.
 *
 * @param path threads.json.
 * @param log Logger.
 * @param what What was wrong, as the end of a sentence.
 */
function keep(path: string, log: (l: string) => void, what: string): void {
	const kept = `${path}.unreadable-${Date.now()}`;
	try { writeAtomic(kept, readFileSync(path, 'utf8')); } catch { /* Nothing more to keep. */ }
	log(`threads.json ${what}. The file as it was is kept as ${kept}.`);
}
