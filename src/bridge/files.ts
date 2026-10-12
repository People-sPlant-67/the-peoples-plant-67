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
 *   prefs.json               the plant page's own choices (the founding form, the layout, the sound)
 *   bridge.lock              which bridge serves this folder: its process, port, address name and
 *                            key (all new at each start); one at a time
 *   start                    the newest start's address name, kept after it stops (see stillHeld)
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
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
	// A ~ the shell left alone (quoted, or after an =) means the home folder, never a folder named ~.
	const home = asked === '~' || asked?.startsWith('~/') ? join(homedir(), asked.slice(1)) : asked;
	return resolve(home || fromEnv || defaultDir());
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
 *   checked); deep: check the contents as well (at start, not on every hook run); looseTop: the
 *   folder itself may be open to others (the caller is about to close it).
 * @returns null when safe, else what is wrong and where.
 */
export function folderProblem(dir: string, o: { home?: string; allowMissing?: boolean; deep?: boolean; looseTop?: boolean } = {}): FolderProblem | null {
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
		const bad = closed(dir, o.looseTop ? { uid: st.uid, mode: st.mode & ~0o022 } : st, true);
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
				let e;
				// A hook may finish writing (and rename away) a file between the listing and this look.
				try { e = lstatSync(q); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; throw err; }
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
 * A new web address name for this start: the plant opens at http://<name>.localhost:<port>.
 * New at every start, like the key. A page another program served at an old address while the
 * plant was stopped (a service worker, a cached script) belongs to that old address, and can
 * never stand between the owner and this start. The browser keeps storage per address, so the
 * page keeps its choices in the plant's folder instead (prefs.json).
 *
 * @returns Name, such as p67-0123456789abcdef.
 */
export function newAddressName(): string {
	return `p67-${randomBytes(8).toString('hex')}`;
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
 * What answers on a port: the bridge holding a given key (it proved it), another bridge,
 * something that does not answer in time, something else, or nothing at all.
 */
export type There = 'here' | 'bridge' | 'silent' | 'other' | null;

/** The lock a bridge keeps in its folder while it runs: its process, its port, and this start's address name and key. */
export interface Lock { pid: number; port: number; name: string; key: string }

/**
 * The lock in a folder, if one is there and readable.
 *
 * @param dir The plant's folder.
 * @returns Lock, or null.
 */
export function readLock(dir: string): Lock | null {
	try {
		const o = JSON.parse(readFileSync(join(dir, 'bridge.lock'), 'utf8')) as Partial<Lock>;
		if (Number.isInteger(o.pid) && Number.isInteger(o.port) && typeof o.key === 'string' && typeof o.name === 'string' && /^p67-[0-9a-f]{16}$/.test(o.name)) return o as Lock;
	} catch { /* None, or not ours to read. */ }
	return null;
}

/**
 * Whether a process is still running.
 *
 * @param pid Process id.
 * @returns True unless the system says there is no such process.
 */
export function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

/**
 * What to tell the owner when this folder's plant is running but does not answer: busy, or
 * paused with Ctrl+Z (the terminal then says "Stopped"). Never "delete the lock": a second
 * plant on the folder would overwrite the first's threads.
 *
 * @param held Its lock.
 * @returns Sentences.
 */
export function frozenWords(held: Lock): string {
	// A paused process keeps a plain kill waiting until it runs again: the second command wakes it.
	return `The plant for this folder is still running as process ${held.pid} on port ${held.port}, but it does not answer. It may be busy, or paused with Ctrl+Z. If you paused it, type fg in its terminal, then press Ctrl+C. If it stays stuck, stop it with: kill ${held.pid}; kill -CONT ${held.pid}`;
}

/**
 * Take the folder for this bridge, or say which bridge has it. Two bridges on one folder would
 * each keep their own copy of the threads and overwrite the other's. Called once the bridge is
 * listening on both addresses, which is what makes the rules below safe: a bridge named in a
 * lock always answers on its port. The caller releases the lock on exit (releaseFolder).
 *
 * A lock is left behind (and taken over) when its process has gone, when it names this start's
 * own port (this start holds it, so no other bridge can), or when what answers on its port is
 * not the bridge that wrote it. A bridge that proves the lock's key is pointed at. Something on
 * its port that does not answer is most likely that bridge, paused: the owner is told so.
 *
 * The lock is written whole under another name and then linked into place, which fails if a
 * lock is there: two starts at once cannot both take it, and nobody reads half a lock.
 *
 * @param dir The plant's folder.
 * @param mine This bridge's port, address name and key.
 * @param holder What answers on a lock's port, asked to prove that lock's key.
 * @returns null when taken; else the lock of the bridge that has it, or sentences for the owner.
 */
export async function lockFolder(dir: string, mine: { port: number; name: string; key: string }, holder: (port: number, key: string) => Promise<There>): Promise<null | { held: Lock } | { problem: string }> {
	const path = join(dir, 'bridge.lock');
	const text = JSON.stringify({ pid: process.pid, ...mine });
	for (let tries = 0; tries < 4; tries++) {
		const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
		writeFileSync(tmp, text, { mode: 0o600 });
		let linked = false;
		try {
			linkSync(tmp, path);
			linked = true;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error(`The plant could not take ${path}: ${(err as Error).message}. Pick a folder on a disk of this computer, for example ~/.plant-67.`);
		} finally {
			rmSync(tmp, { force: true });
		}
		if (linked) {
			// The newest start, kept even after it stops: a plant paused before it can never take the
			// folder back (see stillHeld). A start that cannot say so gives the folder back.
			try {
				writeAtomic(join(dir, 'start'), mine.name);
			} catch (err) {
				if (readLock(dir)?.key === mine.key) rmSync(path, { force: true });
				throw new Error(`The plant could not write ${join(dir, 'start')}: ${(err as Error).message}. Check there is room on the disk, then start again.`);
			}
			return null;
		}
		let seen = '';
		try { seen = readFileSync(path, 'utf8'); } catch { continue; }
		const held = readLock(dir);
		if (held && held.pid !== process.pid && held.port !== mine.port && alive(held.pid)) {
			const who = await holder(held.port, held.key);
			if (who === 'here') return { held };
			if (who === 'silent') return { problem: frozenWords(held) };
		}
		// Left behind. Moved aside first, then checked: if what was moved is not the lock judged left
		// behind (another start took the folder meanwhile), it is put back. This narrows the race
		// between starts taking over one old lock; the running bridge's own check closes it
		// (stillHeld).
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
 * The running bridge's own check, before every signed request and every few seconds: the folder
 * is still this start's. It is not once a later start has taken it, even if that start has
 * stopped since (the file "start" holds the newest start's address name, and is never removed). A lock deleted
 * by hand, with no start since, is put back.
 *
 * @param dir The plant's folder.
 * @param mine This bridge's port, address name and key.
 * @returns True while the folder is this start's.
 */
export function stillHeld(dir: string, mine: { port: number; name: string; key: string }): boolean {
	const startPath = join(dir, 'start');
	let newest: string | null = null;
	try { newest = readFileSync(startPath, 'utf8'); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return false; }
	const held = readLock(dir);
	// The record of the newest start gone by hand, while the lock is still this start's: put back.
	if (newest === null) {
		if (held?.key !== mine.key) return false;
		try { writeAtomic(startPath, mine.name); } catch { /* Tried again at the next check. */ }
		return true;
	}
	if (newest !== mine.name) return false;
	if (held) return held.key === mine.key;
	const path = join(dir, 'bridge.lock');
	const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
	try {
		writeFileSync(tmp, JSON.stringify({ pid: process.pid, ...mine }), { mode: 0o600 });
		linkSync(tmp, path);
	} catch {
		return readLock(dir)?.key === mine.key;
	} finally {
		rmSync(tmp, { force: true });
	}
	// Another start may have come and gone between the two looks: then this one gives way.
	let still = '';
	try { still = readFileSync(startPath, 'utf8'); } catch { /* Gone: not this start's to keep. */ }
	if (still === mine.name) return true;
	if (readLock(dir)?.key === mine.key) rmSync(path, { force: true });
	return false;
}

/**
 * Give the folder back, if this start holds it.
 *
 * @param dir The plant's folder.
 * @param key This start's key.
 */
export function releaseFolder(dir: string, key: string): void {
	const held = readLock(dir);
	if (held?.pid === process.pid && held.key === key) rmSync(join(dir, 'bridge.lock'), { force: true });
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
	let realHome = home;
	try { realHome = realpathSync(home); } catch { /* No home folder. */ }
	if (dir === realHome) throw new Error('That is your home folder itself. Keep the plant\'s files in a folder of their own inside it, for example ~/.plant-67.');
	// The folder's own mode is set by the plant (closeFolder), so a folder of the owner's made
	// under a loose umask is closed rather than refused. It is closed before its contents are
	// checked (nobody else can add to it during the check), and put back as it was if the plant
	// refuses it.
	let bad = folderProblem(dir, { home, allowMissing: true, looseTop: true });
	if (!bad && existsSync(dir)) {
		const was = statSync(dir).mode & 0o7777;
		if (was & 0o022) closeFolder(dir);
		bad = folderProblem(dir, { home, deep: true });
		if (bad && was & 0o022) { try { chmodSync(dir, was); } catch { /* Left closed. */ } }
	}
	if (!bad) return dir;
	const inside = bad.at === dir || bad.at.startsWith(`${dir}/`);
	throw new Error({
		project: `${asked} is inside the project at ${bad.at}. An agent working there could change what the plant runs. Keep the plant's files outside every project, for example in ~/.plant-67.`,
		missing: `${asked} could not be read, so the plant will not use it.`,
		'not-folder': `${bad.at} should be a folder, and it is not, so the plant will not use it.`,
		link: `${bad.at} is a link, so the plant will not use it. Give the plant a real folder.`,
		owner: inside ? `${bad.at} belongs to another user, so the plant will not use it. Pick a folder of your own.` : `${asked} is in a folder other users can change (${bad.at}), so the plant will not keep its files there. Use a folder inside your home, for example ~/.plant-67.`,
		open: inside ? `Other users can write to ${bad.at}, so the plant will not use it. Run: chmod -R go-w "${dir}"` : `${asked} is in a folder other users can change (${bad.at}), so the plant will not keep its files there. Use a folder inside your home, for example ~/.plant-67.`,
		group: inside ? `Your group can write to ${bad.at}, so the plant will not use it. Run: chmod -R g-w "${dir}"` : `Your group can write to ${bad.at}, so the plant will not keep its files below it. Run: chmod g-w "${bad.at}"`,
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
