/**
 * The bridge's folder (~/.plant-67 by default) and the files that pass through it. Shared by
 * the server, the hook script and any adapter written in TypeScript. ADAPTERS.md describes the
 * public formats (agents, inbox, delivered, replies) for adapters in other languages.
 *
 *   agents/<anything>.json   one per agent, written by its adapter (the hook script), read by the server
 *   inbox/<agent>/<n>.json   a message from the owner, written by the server, taken by the hook
 *   delivered/<agent>/...    the hook moves a message here once the agent has it; the server clears it
 *   replies/<n>.json         an agent's answer, written by the hook, taken in by the server
 *   threads.json             the directives and their messages; the server alone writes it
 *   key                      the secret the plant's page must show the server; made new by each start
 *   bridge.lock              which bridge serves this folder (process and port); one at a time
 *   sessions/, awaiting/     the hook script's own notes; private to it
 *
 * The hook script itself always lives in ~/.plant-67/hooks/, inside the home folder, whatever
 * folder the plant uses: a folder elsewhere (under /tmp, say) can vanish and be made again by
 * someone else, and the harness would then run their script.
 *
 * Every write goes to a temporary file first and is renamed into place, so a reader never sees
 * half a file, and two sessions writing at once each leave a whole one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/** File format version, in every file the bridge or a hook writes. */
export const FORMAT = 1;

/** A comrade waiting on the owner reads idle after this long without a word (it crashed at the prompt). */
export const WAITING_STALE_MS = 24 * 3_600_000;

/**
 * The hook events each harness reports to the plant. Those that start and end a turn or a
 * session run in step with the agent: the prompt hands messages over (its output is the
 * context), and the ends must finish in order (the answer is sent before the session is
 * forgotten). Tool events and notifications, which can come many times a turn, run in the
 * background, so the agent never waits on the plant for them, and the hook script treats them
 * as possibly late.
 */
export const HOOK_EVENTS = {
	claude: { sync: ['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd'], background: ['PreToolUse', 'PostToolUse', 'Notification'] },
	codex: { sync: ['SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'], background: ['PreToolUse', 'PostToolUse', 'PermissionRequest'] },
} as const;

/** The statuses an adapter may write. Anything else reads as idle. */
export const AGENT_STATUSES = ['running', 'idle', 'waiting', 'error', 'paused'] as const;
export type BridgeStatus = (typeof AGENT_STATUSES)[number];

/** One agent, as its adapter writes it to agents/<anything>.json. */
export interface AgentRecord {
	v: 1;
	/** Stable and unique per agent, e.g. "claude:/work/shop". The plant's id is made from it. */
	key: string;
	/** Shown as the comrade's name (a project folder's name, say). */
	name: string;
	/** Shown as the comrade's title: the harness, e.g. "Claude Code". */
	harness: string;
	status: BridgeStatus;
	/** Why: the error for 'error', what it waits for for 'waiting'. */
	reason: string | null;
	/** ISO time of this write. */
	updatedAt: string;
	/** ISO time the agent last did something (a tool, a prompt), or null. */
	heartbeatAt: string | null;
	/** False when the adapter cannot hand the agent messages (Codex's notify program): the bridge then refuses them. */
	hears?: boolean;
}

/** A message from the owner, waiting in inbox/<agent>/ for the agent's next turn. */
export interface InboxMessage {
	v: 1;
	issueId: string;
	/** The thread's short name, e.g. "PLT-3". */
	identifier: string;
	title: string;
	text: string;
	/** A new directive, or a message in a thread that already exists. */
	kind: 'directive' | 'message';
	at: string;
}

/** An agent's answer, written to replies/ for the server to file in the threads it was given. */
export interface ReplyFile {
	v: 1;
	key: string;
	issueIds: string[];
	text: string;
	at: string;
}

/**
 * The bridge's folder: the one asked for, else $PLANT67_DIR, else ~/.plant-67. Always absolute:
 * a hook runs in the agent's project folder, where a relative path would point into the project.
 *
 * @param asked A --dir argument.
 * @param env Environment.
 * @returns Absolute path.
 */
export function plantDir(asked?: string | null, env: NodeJS.ProcessEnv = process.env): string {
	// $PLANT67_DIR counts only as a full path: a hook resolves a relative one inside the project.
	const fromEnv = env.PLANT67_DIR && isAbsolute(env.PLANT67_DIR) ? env.PLANT67_DIR : null;
	return resolve(asked || fromEnv || defaultDir());
}

/**
 * The default folder, ~/.plant-67.
 *
 * @returns Absolute path.
 */
export function defaultDir(): string {
	return join(homedir(), '.plant-67');
}

/** The plant's own subfolders, checked like the folder itself when they exist. */
const SUBFOLDERS = ['agents', 'inbox', 'delivered', 'replies', 'hooks', 'sessions', 'awaiting'];

/**
 * Where the hook script lives: always in the home folder's plant folder (see the header).
 *
 * @returns Absolute path to plant-hook.mjs.
 */
export function hookScriptPath(): string {
	return join(defaultDir(), 'hooks', 'plant-hook.mjs');
}

/**
 * Whether a folder, and every folder above it, is closed to other users: the folder is this
 * user's, and each folder above belongs to this user or the system, with nobody else able to
 * write it. Nothing in the chain can then be swapped out by someone else, so the answer holds
 * for as long as the plant uses the folder. Quick enough for the hook script to ask on every run.
 *
 * @param dir The plant's folder, as a real path.
 * @param trustAbove For tests only: folders at or above this one are not checked.
 * @returns null when safe, else the folder that is not, and why.
 */
export function chainProblem(dir: string, trustAbove?: string): { at: string; why: 'missing' | 'link' | 'owner' | 'open' } | null {
	const uid = typeof process.getuid === 'function' ? process.getuid() : null;
	let st;
	try { st = lstatSync(dir); } catch { return { at: dir, why: 'missing' }; }
	if (!st.isDirectory()) return { at: dir, why: 'link' };
	try { if (realpathSync(dir) !== dir) return { at: dir, why: 'link' }; } catch { return { at: dir, why: 'missing' }; }
	if (uid === null) return null;
	if (st.uid !== uid) return { at: dir, why: 'owner' };
	if (st.mode & 0o022) return { at: dir, why: 'open' };
	for (let p = dirname(dir); ; p = dirname(p)) {
		if (trustAbove && (p === trustAbove || trustAbove.startsWith(`${p}/`) || p === '/')) break;
		const a = statSync(p);
		if (a.uid !== uid && a.uid !== 0) return { at: p, why: 'owner' };
		if (a.mode & 0o022) return { at: p, why: 'open' };
		if (dirname(p) === p) break;
	}
	return null;
}

/**
 * The check the hook script makes on every run: the plant's folder is there, and it and every
 * folder above it are closed to other users (see chainProblem). The hook never makes the folder
 * itself, so a folder that vanished cannot be put back by someone else and used.
 *
 * @param dir The plant's folder.
 * @param trustAbove For tests only: folders at or above this one are not checked.
 * @returns True when it is safe to use.
 */
export function ownFolder(dir: string, trustAbove?: string): boolean {
	try { return chainProblem(dir, trustAbove) === null; } catch { return false; }
}

/**
 * Make a new key for this start and keep it where only the owner can read it. A new key each
 * start means a key seen anywhere (a terminal, a browser's history) stops working at the next.
 *
 * @param dir The plant's folder.
 * @returns Key, 64 hex characters.
 */
export function newKey(dir: string): string {
	const k = randomBytes(32).toString('hex');
	writeAtomic(join(dir, 'key'), k);
	return k;
}

/**
 * Take the folder for this bridge, or say which bridge has it. Two bridges on one folder would
 * each keep their own copy of the threads and overwrite the other's. The caller releases the
 * lock on exit (releaseFolder).
 *
 * @param dir The plant's folder.
 * @param port This bridge's port.
 * @param stillThere Whether the bridge named in an existing lock still answers for this folder.
 *   A process id alone is not proof: after a crash and a restart of the computer, the same id can
 *   belong to any program.
 * @returns null when taken, or the port of the bridge that has it.
 */
export async function lockFolder(dir: string, port: number, stillThere: (port: number) => Promise<boolean>): Promise<number | null> {
	const path = join(dir, 'bridge.lock');
	for (let tries = 0; tries < 3; tries++) {
		try {
			const fd = openSync(path, 'wx', 0o600);
			writeSync(fd, JSON.stringify({ pid: process.pid, port }));
			closeSync(fd);
			return null;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
		}
		let held: { pid?: unknown; port?: unknown } = {};
		try { held = JSON.parse(readFileSync(path, 'utf8')); } catch { /* Unreadable: treated as left behind. */ }
		if (typeof held.port === 'number' && held.pid !== process.pid && await stillThere(held.port)) return held.port;
		// Left behind by a bridge that has gone. Moved aside under a name of our own first, so two
		// starts taking it over at once cannot both remove the other's new lock.
		const aside = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.old`;
		try { renameSync(path, aside); rmSync(aside, { force: true }); } catch { /* Another start moved it: try again. */ }
	}
	throw new Error(`The plant could not take ${path}. If no plant is running, delete that file and start again.`);
}

/**
 * Give the folder back, if this bridge holds it.
 *
 * @param dir The plant's folder.
 */
export function releaseFolder(dir: string): void {
	const path = join(dir, 'bridge.lock');
	try { if (JSON.parse(readFileSync(path, 'utf8')).pid === process.pid) rmSync(path, { force: true }); } catch { /* Gone already. */ }
}

/**
 * Close the plant's folder to everyone but its owner (a folder made before may be readable).
 *
 * @param dir The plant's folder.
 */
export function closeFolder(dir: string): void {
	try { chmodSync(dir, 0o700); } catch { /* Checked already; nothing more to do. */ }
}

/**
 * Check a folder is safe to hold the plant, and give its real path. Whatever can write it can
 * put words in an agent's prompt (the inbox), so:
 *
 * - it is outside any project an agent works in (a git work tree below the home folder, or
 *   anywhere outside it; a home folder that is itself a dotfiles repository is fine);
 * - it and its subfolders belong to this user and nobody else can write them;
 * - every folder above it belongs to this user or the system, and nobody else can change it.
 *   A shared folder such as /tmp fails this: what is made there can vanish and be made again
 *   by someone else;
 * - links are followed now, and the real path is what goes into every command.
 *
 * @param asked Absolute folder (it may not exist yet).
 * @param home The home folder.
 * @param trustAbove For tests only: folders at or above this one are not checked.
 * @returns The real path to use.
 * @throws Error with a sentence for the owner when it is not safe.
 */
export function checkDir(asked: string, home: string = homedir(), trustAbove?: string): string {
	let existing = asked;
	const rest: string[] = [];
	while (!existsSync(existing) && dirname(existing) !== existing) { rest.unshift(basename(existing)); existing = dirname(existing); }
	const dir = join(realpathSync(existing), ...rest);
	let realHome = home;
	try { realHome = realpathSync(home); } catch { /* No home folder: nothing to stop at. */ }
	for (let p = dir; p !== realHome; p = dirname(p)) {
		if (existsSync(join(p, '.git'))) throw new Error(`${dir} is inside the project at ${p}. An agent working there could change what the plant runs. Keep the plant's files outside every project, for example in ~/.plant-67.`);
		if (dirname(p) === p) break;
	}
	const uid = typeof process.getuid === 'function' ? process.getuid() : null;
	if (uid === null) return dir;
	const shared = `${dir} is in a folder other users can change, so the plant will not keep its files there. Use a folder inside your home, for example ~/.plant-67.`;
	for (let p = dirname(dir); ; p = dirname(p)) {
		if (trustAbove && (p === trustAbove || trustAbove.startsWith(`${p}/`))) break;
		// Folders not made yet are made by the plant, for this user only.
		if (!existsSync(p)) { if (dirname(p) === p) break; continue; }
		const st = statSync(p);
		if ((st.uid !== uid && st.uid !== 0) || (st.mode & 0o022)) throw new Error(shared);
		if (dirname(p) === p) break;
	}
	if (!existsSync(dir)) return dir;
	for (const p of [dir, ...SUBFOLDERS.map((s) => join(dir, s)).filter((s) => existsSync(s))]) {
		const st = lstatSync(p);
		if (!st.isDirectory()) throw new Error(`${p} should be a folder, and it is not, so the plant will not use it.`);
		if (st.uid !== uid) throw new Error(`${p} belongs to another user, so the plant will not use it. Pick a folder of your own.`);
		if (st.mode & 0o022) throw new Error(`Other users can write to ${p}, so the plant will not use it. Run: chmod -R go-w "${dir}"`);
	}
	return dir;
}

/**
 * Copy a file whole, replacing whatever is at the destination (a link included) instead of
 * writing through it.
 *
 * @param from Source.
 * @param to Destination.
 */
export function copyAtomic(from: string, to: string): void {
	writeAtomic(to, readFileSync(from, 'utf8'));
}

/**
 * A short, file-name-safe name for an agent key.
 *
 * @param key Agent key.
 * @returns 32 hex characters.
 */
export function keyHash(key: string): string {
	return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

/**
 * A UUID made from a name, the same every time (version 5 layout over SHA-1). The plant only
 * puts UUIDs in request paths, so every id the bridge hands out is one of these.
 *
 * @param name Any string.
 * @returns UUID.
 */
export function uuidFrom(name: string): string {
	const h = createHash('sha1').update(`plant-67:${name}`).digest();
	h[6] = (h[6] & 0x0f) | 0x50;
	h[8] = (h[8] & 0x3f) | 0x80;
	const x = h.subarray(0, 16).toString('hex');
	return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/**
 * A file name that sorts by time and never collides.
 *
 * @param now Epoch ms.
 * @returns Name without extension.
 */
export function stampName(now: number = Date.now()): string {
	return `${String(now).padStart(14, '0')}-${randomBytes(4).toString('hex')}`;
}

/**
 * Write a file whole: to a temporary name beside it, then renamed into place.
 *
 * @param path Destination.
 * @param text Contents.
 */
export function writeAtomic(path: string, text: string): void {
	const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
	try {
		writeFileSync(tmp, text, { mode: 0o600 });
		renameSync(tmp, path);
	} catch (err) {
		rmSync(tmp, { force: true });
		throw err;
	}
}

/**
 * Make a folder (and its parents) readable by this user only.
 *
 * @param path Folder.
 * @returns The path.
 */
export function ensureDir(path: string): string {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	return path;
}
