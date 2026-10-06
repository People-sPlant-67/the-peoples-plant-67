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
 *   key                      the secret the plant's page must show the server; the server alone writes it
 *   hooks/, sessions/, awaiting/   the hook script and its own notes; private to it
 *
 * Every write goes to a temporary file first and is renamed into place, so a reader never sees
 * half a file, and two sessions writing at once each leave a whole one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
 * Check a folder is safe to hold the plant, and give its real path. Whatever can write it can
 * put words in an agent's prompt (the inbox) and change the script every hook runs, so:
 *
 * - it is outside any project an agent works in (a git work tree below the home folder, or
 *   anywhere outside it; a home folder that is itself a dotfiles repository is fine);
 * - it and its subfolders belong to this user and nobody else can write them;
 * - every folder above it belongs to this user or the system, and nobody else can change it
 *   (a shared folder with the sticky bit, such as /tmp, is fine);
 * - links are followed now, and the real path is what goes into every command, so a link
 *   cannot be pointed somewhere else later.
 *
 * @param asked Absolute folder (it may not exist yet).
 * @param home The home folder.
 * @returns The real path to use.
 * @throws Error with a sentence for the owner when it is not safe.
 */
export function checkDir(asked: string, home: string = homedir()): string {
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
	for (let p = dirname(dir); ; p = dirname(p)) {
		// Folders not made yet are made by the plant, for this user only.
		if (!existsSync(p)) { if (dirname(p) === p) break; continue; }
		const st = statSync(p);
		const sticky = (st.mode & 0o1000) !== 0;
		if ((st.uid !== uid && st.uid !== 0) || ((st.mode & 0o022) && !sticky)) throw new Error(`Other users can change ${p}, which holds ${dir}, so the plant will not keep its files there. Use a folder inside your home, for example ~/.plant-67.`);
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
