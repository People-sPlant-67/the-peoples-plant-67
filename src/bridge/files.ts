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
 *   address                  the plant's own web address name (<name>.localhost); made once
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
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
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


/**
 * Where the hook script lives: always in the home folder's plant folder (see the header).
 *
 * @returns Absolute path to plant-hook.mjs.
 */
export function hookScriptPath(): string {
	return join(defaultDir(), 'hooks', 'plant-hook.mjs');
}

/** What is wrong with a plant folder, and where. */
export interface FolderProblem {
	at: string;
	why: 'missing' | 'not-folder' | 'link' | 'owner' | 'group' | 'open' | 'project';
}

/**
 * The one check of a plant folder, for the bridge at start and the hook script on every run.
 * Whatever can write the folder can put words in an agent's prompt, so:
 *
 * - it is a real folder of this user's (not a link), nobody else can write it, and neither can
 *   anyone change any folder above it: each belongs to this user or the system and is closed to
 *   others. A shared folder such as /tmp fails, sticky or not: what is made there can vanish and
 *   be made again by someone else. Nothing in the chain can then be swapped out, so the answer
 *   holds for as long as the plant uses the folder;
 * - it is outside any project an agent works in (a git work tree below the home folder, or
 *   anywhere outside it; a home folder that is itself a dotfiles repository is fine);
 * - with deep, everything inside it (three levels down) is this user's too, and no link: a
 *   folder that was once open may still hold something someone else put there.
 *
 * @param dir The plant's folder, as a real path.
 * @param o home: the home folder; allowMissing: a folder not made yet passes (its parents are
 *   checked); deep: check the contents as well (at start, not on every hook run).
 * @returns null when safe, else what is wrong and where.
 */
export function folderProblem(dir: string, o: { home?: string; allowMissing?: boolean; deep?: boolean } = {}): FolderProblem | null {
	const uid = typeof process.getuid === 'function' ? process.getuid() : null;
	let home = o.home ?? homedir();
	try { home = realpathSync(home); } catch { /* No home folder: nothing to stop at. */ }
	for (let p = dir; p !== home; p = dirname(p)) {
		if (existsSync(join(p, '.git'))) return { at: p, why: 'project' };
		if (dirname(p) === p) break;
	}
	const closed = (p: string, st: { uid: number; mode: number }, mine: boolean): FolderProblem | null => {
		if (uid === null) return null;
		if (st.uid !== uid && (mine || st.uid !== 0)) return { at: p, why: 'owner' };
		if (st.mode & 0o002) return { at: p, why: 'open' };
		if (st.mode & 0o020) return { at: p, why: 'group' };
		return null;
	};
	let st;
	try { st = lstatSync(dir); } catch { st = null; }
	if (st) {
		if (st.isSymbolicLink()) return { at: dir, why: 'link' };
		if (!st.isDirectory()) return { at: dir, why: 'not-folder' };
		try { if (realpathSync(dir) !== dir) return { at: dir, why: 'link' }; } catch { return { at: dir, why: 'missing' }; }
		const bad = closed(dir, st, true);
		if (bad) return bad;
	} else if (!o.allowMissing) {
		return { at: dir, why: 'missing' };
	}
	for (let p = dirname(dir); ; p = dirname(p)) {
		// Folders not made yet are made by the plant, for this user only.
		if (existsSync(p)) {
			const bad = closed(p, statSync(p), false);
			if (bad) return bad;
		}
		if (dirname(p) === p) break;
	}
	if (st && o.deep) {
		const inside = (p: string, depth: number): FolderProblem | null => {
			let names: string[] = [];
			try { names = readdirSync(p); } catch { return null; }
			for (const n of names) {
				const q = join(p, n);
				const e = lstatSync(q);
				if (e.isSymbolicLink()) return { at: q, why: 'link' };
				const bad = closed(q, e, true);
				if (bad) return bad;
				if (e.isDirectory() && depth < 3) { const deeper = inside(q, depth + 1); if (deeper) return deeper; }
			}
			return null;
		};
		return inside(dir, 1);
	}
	return null;
}

/**
 * The check the hook script makes on every run: the plant's folder is there and safe (see
 * folderProblem). The hook never makes the folder itself, so a folder that vanished cannot be
 * put back by someone else and used.
 *
 * @param dir The plant's folder.
 * @returns True when it is safe to use.
 */
export function ownFolder(dir: string): boolean {
	try { return folderProblem(dir) === null; } catch { return false; }
}

/**
 * The plant's own web address name, made once per folder and kept where only its owner can read
 * it: the plant opens at http://<name>.localhost:<port>. A page another program served on
 * 127.0.0.1 while the plant was stopped (a service worker, say) belongs to another address, and
 * can never stand between the owner and this plant. Kept, so the founding form's choices, which
 * the browser stores per address, last from one start to the next.
 *
 * @param dir The plant's folder.
 * @returns Name, such as p67-0123456789abcdef.
 */
export function addressName(dir: string): string {
	const path = join(dir, 'address');
	try {
		const n = readFileSync(path, 'utf8').trim();
		if (/^p67-[0-9a-f]{16}$/.test(n)) return n;
	} catch { /* Made below. */ }
	const n = `p67-${randomBytes(8).toString('hex')}`;
	writeAtomic(path, n);
	return n;
}

/**
 * A new key for this start. A new key each start means a key seen anywhere (a terminal, a
 * browser's history) stops working at the next.
 *
 * @returns Key, 64 hex characters.
 */
export function newKey(): string {
	return randomBytes(32).toString('hex');
}

/**
 * Keep this start's key where only the owner can read it, once the bridge is listening (a start
 * that failed must not replace the key of the bridge still running).
 *
 * @param dir The plant's folder.
 * @param key Key.
 */
export function keepKey(dir: string, key: string): void {
	writeAtomic(join(dir, 'key'), key);
}

/**
 * The proof that a bridge holds a key: an HMAC of a challenge, so the key itself never leaves.
 *
 * @param key Key.
 * @param challenge Challenge.
 * @returns Proof, hex.
 */
export function proofOf(key: string, challenge: string): string {
	return createHmac('sha256', key).update(`plant-67:${challenge}`).digest('hex');
}

/** What a bridge named in a lock turned out to be. */
export type LockHolder = 'here' | 'gone' | 'silent';

/**
 * Take the folder for this bridge, or say which bridge has it. Two bridges on one folder would
 * each keep their own copy of the threads and overwrite the other's. The caller releases the
 * lock on exit (releaseFolder).
 *
 * @param dir The plant's folder.
 * @param port This bridge's port.
 * @param holder What answers on a port named in an existing lock: 'here' only when it proves it
 *   holds this folder's key (a process id, or a server that merely says so, is no proof).
 * @returns null when taken; else the port of the bridge that has it ('here'), or a sentence
 *   when something there does not answer ('silent'), which the owner must sort out.
 */
export async function lockFolder(dir: string, port: number, holder: (port: number) => Promise<LockHolder>): Promise<null | { port: number } | { problem: string }> {
	const path = join(dir, 'bridge.lock');
	for (let tries = 0; tries < 4; tries++) {
		const mine = JSON.stringify({ pid: process.pid, port, nonce: randomBytes(8).toString('hex') });
		try {
			const fd = openSync(path, 'wx', 0o600);
			writeSync(fd, mine);
			closeSync(fd);
			// Read back: only a lock that still says what this start wrote is ours.
			if (readFileSync(path, 'utf8') === mine) return null;
			continue;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
		}
		let seen = '';
		try { seen = readFileSync(path, 'utf8'); } catch { continue; }
		let held: { port?: unknown } = {};
		try { held = JSON.parse(seen); } catch { /* Unreadable: treated as left behind. */ }
		if (typeof held.port === 'number') {
			const who = await holder(held.port);
			if (who === 'here') return { port: held.port };
			if (who === 'silent') return { problem: `Something on port ${held.port} holds this plant's folder but does not answer. If no plant is running, delete ${path} and start again.` };
		}
		// Left behind by a bridge that has gone. Moved aside first, then checked: if what was moved
		// is not the lock judged stale (another start took over meanwhile), it is put back.
		const aside = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.old`;
		try { renameSync(path, aside); } catch { continue; }
		let moved = '';
		try { moved = readFileSync(aside, 'utf8'); } catch { /* Gone: nothing to put back. */ }
		if (moved !== seen) { try { linkSync(aside, path); } catch { /* Another lock is there now. */ } }
		rmSync(aside, { force: true });
	}
	return { problem: `The plant could not take ${path}. If no plant is running, delete that file and start again.` };
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
 * Check a folder is safe to hold the plant (see folderProblem), and give its real path, which
 * is what goes into every command: links are followed now, so one cannot be pointed elsewhere later.
 *
 * @param asked Absolute folder (it may not exist yet), as the owner gave it.
 * @param home The home folder.
 * @returns The real path to use.
 * @throws Error with a sentence for the owner when it is not safe.
 */
export function checkDir(asked: string, home: string = homedir()): string {
	let existing = asked;
	const rest: string[] = [];
	while (!existsSync(existing) && dirname(existing) !== existing) { rest.unshift(basename(existing)); existing = dirname(existing); }
	const dir = join(realpathSync(existing), ...rest);
	const bad = folderProblem(dir, { home, allowMissing: true, deep: true });
	if (!bad) return dir;
	const inside = bad.at === dir || bad.at.startsWith(`${dir}/`);
	throw new Error({
		project: `${asked} is inside the project at ${bad.at}. An agent working there could change what the plant runs. Keep the plant's files outside every project, for example in ~/.plant-67.`,
		missing: `${asked} could not be read, so the plant will not use it.`,
		'not-folder': `${bad.at} should be a folder, and it is not, so the plant will not use it.`,
		link: `${bad.at} is a link, so the plant will not use it. Give the plant a real folder.`,
		owner: inside ? `${bad.at} belongs to another user, so the plant will not use it. Pick a folder of your own.` : `${asked} is in a folder other users can change (${bad.at}), so the plant will not keep its files there. Use a folder inside your home, for example ~/.plant-67.`,
		open: inside ? `Other users can write to ${bad.at}, so the plant will not use it. Run: chmod -R go-w "${dir}"` : `${asked} is in a folder other users can change (${bad.at}), so the plant will not keep its files there. Use a folder inside your home, for example ~/.plant-67.`,
		group: `Your group can write to ${bad.at}, so the plant will not use it there. Run: chmod g-w "${bad.at}"`,
	}[bad.why]);
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
