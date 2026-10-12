/**
 * The npx command.
 *
 *   npx github:People-sPlant-67/the-peoples-plant-67                 start the plant on localhost:6767
 *   npx github:People-sPlant-67/the-peoples-plant-67 hooks claude    wire Claude Code to it
 *   npx github:People-sPlant-67/the-peoples-plant-67 hooks codex     wire Codex to it
 *
 * Options: --port <n>, --dir <folder> (default ~/.plant-67, or $PLANT67_DIR), --no-open,
 * --remove (with hooks), --notify (with hooks codex: the fallback for a Codex without hooks).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { type Lock, type There, alive, checkDir, closeFolder, copyAtomic, defaultDir, ensureDir, frozenWords, hookScriptPath, lockFolder, newAddressName, newKey, plantDir, readLock, releaseFolder, stillHeld, writeAtomic } from './files';
import { proofOf } from './proof';
import { NPX, commandsFor } from './words';
import { MARK, type Target, install, installNotify, staleNode, wired } from './install';
import { type Listening, type ServeOptions, serve } from './server';

/** The bridge's port unless --port says otherwise. Sixty-seven twice. */
export const DEFAULT_PORT = 6767;


export const HELP = `The People's Plant #67: your agents, drawn as a Soviet factory.

  ${NPX}
      Start the plant on this computer and open it in your browser.

  ${NPX} hooks claude
  ${NPX} hooks codex
      Wire Claude Code or Codex to the plant. Add --remove to unwire it.
      For a Codex without hooks, add --notify to use its notify program instead.

Options
  --port <n>      Listen on another port (default ${DEFAULT_PORT}).
  --dir <folder>  Keep the plant's files somewhere else (default ~/.plant-67, or
                  $PLANT67_DIR when that is a full path).
  --no-open       Do not open the browser.
  --help          Show this help.
`;

export interface Args {
	command: 'serve' | 'hooks' | 'help';
	target: Target | null;
	port: number;
	dir: string | null;
	open: boolean;
	remove: boolean;
	notify: boolean;
}

/**
 * Read the command line.
 *
 * @param argv Arguments after the script.
 * @returns Parsed arguments.
 * @throws Error with a sentence for the owner when they cannot be read.
 */
export function parseArgs(argv: string[]): Args {
	const a: Args = { command: 'serve', target: null, port: DEFAULT_PORT, dir: null, open: true, remove: false, notify: false };
	const rest = [...argv];
	while (rest.length) {
		const x = rest.shift()!;
		if (x === '--help' || x === '-h' || x === 'help') a.command = 'help';
		else if (x === '--no-open') a.open = false;
		else if (x === '--remove') a.remove = true;
		else if (x === '--notify') a.notify = true;
		else if (x === '--port') {
			const n = Number(rest.shift());
			if (!Number.isInteger(n) || n < 1025 || n > 65535) throw new Error('--port needs a number from 1025 to 65535.');
			a.port = n;
		} else if (x === '--dir') {
			const d = rest.shift();
			if (!d) throw new Error('--dir needs a folder.');
			if (d.startsWith('~') && d !== '~' && !d.startsWith('~/')) throw new Error(`Write the folder's full path, for example ${homedir()}/plant. The plant does not read ${d.split('/')[0]}.`);
			a.dir = d;
		} else if (x === 'hooks') {
			a.command = 'hooks';
			const t = rest.shift();
			if (t !== 'claude' && t !== 'codex') throw new Error('Say which harness: hooks claude, or hooks codex.');
			a.target = t;
		} else throw new Error(`The plant does not know "${x}". Try --help.`);
	}
	if (a.command === 'help') return a;
	if (a.notify && a.target !== 'codex') throw new Error('--notify is for hooks codex only.');
	if ((a.remove || a.notify) && a.command !== 'hooks') throw new Error('--remove and --notify go with hooks claude or hooks codex.');
	return a;
}

/**
 * What answers on one address and port.
 *
 * @param host 127.0.0.1 or ::1.
 * @param port Port.
 * @param key The key the bridge looked for must prove it holds, or null.
 * @returns What is there.
 */
function probe(host: string, port: number, key: string | null): Promise<There> {
	const challenge = randomBytes(16).toString('hex');
	return new Promise((resolve) => {
		const req = request({ host, port, path: `/api/plant-bridge?challenge=${challenge}`, headers: { host: `localhost:${port}` }, timeout: 3000 }, (res) => {
			let t = '';
			res.on('data', (c) => { t += c; });
			res.on('end', () => {
				try {
					const o = JSON.parse(t) as { bridge?: unknown; proof?: unknown };
					if (o.bridge !== true) { resolve('other'); return; }
					resolve(key && typeof o.proof === 'string' && o.proof === proofOf(key, challenge) ? 'here' : 'bridge');
				} catch { resolve('other'); }
			});
		});
		req.on('error', () => resolve(null));
		req.on('timeout', () => { req.destroy(); resolve('silent'); });
		req.end();
	});
}

/**
 * What answers on a port, on both addresses the plant's own address can lead to. 'here' only
 * when every address that answers proves it holds the key: a page on [::1] while the bridge is
 * on 127.0.0.1 is someone else's, and must never be sent the key.
 *
 * @param port Port.
 * @param key The key to look for, or null.
 * @returns What is there.
 */
async function bridgeAt(port: number, key: string | null): Promise<There> {
	const answers = (await Promise.all([probe('127.0.0.1', port, key), probe('::1', port, key)])).filter((t) => t !== null);
	if (!answers.length) return null;
	return answers.find((t) => t !== 'here') ?? 'here';
}

/**
 * bridgeAt, given a moment when a bridge answers without proof: a start listens before it takes
 * the folder, so its lock (and the key to check) can be a moment behind.
 *
 * @param port Port.
 * @param dir The plant's folder.
 * @param key The key to look for, or null to use the one in the folder's lock.
 * @returns What is there, and the folder's lock whose key it was asked to prove.
 */
async function settledAt(port: number, dir: string, key: string | null): Promise<{ there: There; lock: Lock | null }> {
	for (let tries = 0; ; tries++) {
		const lock = readLock(dir);
		const asked = key ?? (lock?.port === port ? lock.key : null);
		const there = await bridgeAt(port, asked);
		if (there !== 'bridge' || tries >= 25) return { there, lock: lock && lock.key === asked ? lock : null };
		await new Promise((r) => setTimeout(r, 200));
	}
}

/**
 * A port to suggest instead of a taken one: the next one nothing answers on.
 *
 * @param port The taken port.
 * @returns A free port, or the next one up if none of the next ten is free.
 */
async function freePortAfter(port: number): Promise<number> {
	for (let p = port + 1; p <= Math.min(port + 10, 65535); p++) if ((await bridgeAt(p, null)) === null) return p;
	return port < 65535 ? port + 1 : DEFAULT_PORT + 1;
}

/**
 * Whether this runs inside WSL, where the browser is on the Windows side of a network the
 * plant's checks cannot see.
 *
 * @returns True inside WSL.
 */
function inWsl(): boolean {
	if (process.platform !== 'linux') return false;
	if (process.env.WSL_DISTRO_NAME) return true;
	try { return /microsoft/i.test(readFileSync('/proc/version', 'utf8')); } catch { return false; }
}

/**
 * Open the plant in the default browser. The link carries the key, and a program's arguments
 * can be read by every user on the computer, so the browser is given a small page in the
 * plant's own folder (readable by its owner alone) that forwards to the link. The page is
 * removed a minute later (sooner by a start that ends at once). A failure only means the owner
 * opens the printed link by hand.
 *
 * @param dir The plant's folder.
 * @param url The link, key and all.
 */
function openBrowser(dir: string, url: string): void {
	const page = join(dir, 'open.html');
	try {
		writeAtomic(page, `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${url}"><title>The People's Plant #67</title>`);
	} catch { return; }
	const [cmd, args] = process.platform === 'darwin' ? ['open', [page]] : ['xdg-open', [page]];
	try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* Opened by hand. */ }
	setTimeout(() => rmSync(page, { force: true }), 60_000).unref();
}

/** How long a start that ends at once (the plant was running already) waits for the browser to read the page. */
const OPEN_PAGE_MS = 10_000;

/**
 * Why a folder could not be made, for the owner.
 *
 * @param dir The folder.
 * @param err What went wrong.
 * @returns Sentence.
 */
function cannotMake(dir: string, err: unknown): string {
	const code = (err as NodeJS.ErrnoException).code;
	if (code === 'EACCES' || code === 'EPERM') return `The plant cannot make ${dir}, because you do not have permission there. Pick a folder of your own, for example ~/.plant-67.`;
	if (code === 'ENOTDIR' || code === 'EEXIST') return `The plant cannot make ${dir}, because part of that path is a file, not a folder. Pick another folder, for example ~/.plant-67.`;
	return `The plant cannot make ${dir}: ${(err as Error).message}`;
}

/**
 * Run the command.
 *
 * @param argv Arguments after the script.
 * @param here The folder this script was built into (dist-bridge).
 * @returns Exit code, or -1 while the bridge runs.
 */
export async function main(argv: string[], here: string = dirname(fileURLToPath(import.meta.url))): Promise<number> {
	if (process.platform === 'win32') { console.error('  The plant does not run on Windows yet. Use it inside WSL.'); return 1; }
	let a: Args;
	try { a = parseArgs(argv); } catch (err) { console.error(`  ${(err as Error).message}`); return 2; }
	if (a.command === 'help') { console.log(HELP); return 0; }
	const hookSource = join(here, MARK);
	let dir: string;
	try { dir = checkDir(plantDir(a.dir)); } catch (err) { console.error(`  ${(err as Error).message}`); return 1; }
	// A folder or port other than the default goes into every command printed, so the hooks
	// and the plant always meet in the same place. The hooks themselves always name the folder.
	let home = defaultDir();
	try { home = realpathSync(home); } catch { /* Not made yet: the path as it is. */ }
	const dirArg = dir !== home ? ` --dir "${dir}"` : '';
	const portArg = a.port !== DEFAULT_PORT ? ` --port ${a.port}` : '';
	const commands = commandsFor(dirArg, portArg);

	if (a.command === 'hooks') {
		try {
			checkDir(defaultDir());
			// The hooks never make the plant's folder themselves (a folder someone else made again
			// must not be used), so it is made here, closed to others.
			try { ensureDir(dir); } catch (err) { console.error(`  ${cannotMake(dir, err)}`); return 1; }
			closeFolder(dir);
			const o = { target: a.target!, remove: a.remove, dir, hookSource };
			const lines = a.notify ? installNotify(o) : install(o);
			for (const l of lines) console.log(`  ${l}`);
			if (!a.remove && lines.some((l) => /^(Added|Copied|Removed)/.test(l))) console.log(`  Undo: ${NPX} hooks ${a.target}${a.notify ? ' --notify' : ''}${dirArg} --remove`);
			return 0;
		} catch (err) {
			console.error(`  ${(err as Error).message}`);
			return 1;
		}
	}

	const web = join(here, 'web');
	if (!existsSync(join(web, 'index.html'))) { console.error(`  The plant's pages are missing from ${web}. Reinstall, or run npm run bridge in a clone.`); return 1; }
	try { ensureDir(dir); } catch (err) { console.error(`  ${cannotMake(dir, err)}`); return 1; }
	closeFolder(dir);
	/**
	 * Point the owner at the plant already running for this folder. Only reached once that bridge
	 * has proved it holds the key in this folder's lock, so the key is never handed to anything else.
	 *
	 * @param held Its lock.
	 * @returns Exit code.
	 */
	const alreadyRunning = async (held: Lock): Promise<number> => {
		const there = `http://${held.name}.localhost:${held.port}/#key=${held.key}`;
		console.log(`★ The plant for this folder is already running${held.port !== a.port ? ` on port ${held.port}` : ''}. Open it at ${there}`);
		console.log('  That link carries the plant\'s key until the plant stops. Keep it to yourself.');
		if (a.open) {
			openBrowser(dir, there);
			console.log('  If the plant did not open in your browser, open the link above.');
			// This start ends now: the page that opens the browser goes once the browser has read it.
			await new Promise((r) => setTimeout(r, OPEN_PAGE_MS));
			rmSync(join(dir, 'open.html'), { force: true });
		}
		return 0;
	};
	const key = newKey();
	// The plant's own address, new at every start like the key (see newAddressName). The key goes
	// after the #, which the browser never sends to a server.
	const name = newAddressName();
	const mine = { port: a.port, name, key };
	const stale = (): string[] => staleNode().map((s) => `The ${s.target === 'claude' ? 'Claude Code' : 'Codex'} hooks run a Node that is no longer on this computer (${s.node}), so they fail. Run: ${commands[s.target]}`);
	/** The harnesses whose hooks point at this folder and still work. */
	const wiredHere = (): Target[] => {
		const broken = new Set(staleNode().map((s) => s.target));
		return wired().filter((w) => w.dirs.includes(dir) && !broken.has(w.target)).map((w) => w.target);
	};
	/**
	 * Say what holds the port this start asked for: this folder's plant (pointed at), this
	 * folder's plant paused, another plant, or something else.
	 *
	 * @param first What the first look found there, if one was made.
	 * @returns Exit code.
	 */
	const taken = async (first?: There): Promise<number> => {
		const { there, lock } = first === 'silent' ? { there: first, lock: null } : await settledAt(a.port, dir, null);
		if (there === 'here' && lock) return alreadyRunning(lock);
		const folders = readLock(dir);
		if (there === 'silent' && folders?.port === a.port && alive(folders.pid)) { console.error(`  ${frozenWords(folders)}`); return 1; }
		const elsewhere = commandsFor(dirArg, ` --port ${await freePortAfter(a.port)}`).start;
		console.error(there === 'bridge'
			? `  Another plant is already on port ${a.port}. Stop it with Ctrl+C in its terminal, or start this one on another port: ${elsewhere}`
			: there === 'silent'
				? `  Something on port ${a.port} does not answer. If it is a plant you paused with Ctrl+Z, type fg in its terminal, then press Ctrl+C. Or start this one on another port: ${elsewhere}`
				: `  Something else is using port ${a.port}. Start the plant on another port: ${elsewhere}`);
		return 1;
	};
	// On macOS, something listening on all addresses (0.0.0.0 or ::) does not stop a listen on
	// 127.0.0.1, yet it is using the port: look first.
	const first = await bridgeAt(a.port, null);
	if (first !== null) return taken(first);
	// Listen first, then take the folder: a bridge named in a lock is then always answering.
	let lostSaid = false;
	/** The folder turned out to be another start's: say so once, and stop. */
	const lost = (): void => {
		if (lostSaid) return;
		lostSaid = true;
		const other = readLock(dir);
		console.error(`  Another plant${other ? ` (process ${other.pid}, port ${other.port})` : ''} took this plant's folder. This one is stopping, so the two do not overwrite each other's threads.`);
		setImmediate(() => process.exit(1));
	};
	const opts: ServeOptions = {
		dir, web, port: a.port, key, name,
		log: (l) => console.error(`  ${l}`),
		wiring: () => ({ ...commands, warnings: stale(), wired: wiredHere() }),
		// Checked before every signed request: a plant that was paused while another start took its
		// folder must not answer from its old copy of the threads when it wakes.
		held: () => stillHeld(dir, mine) === null,
		lost,
	};
	let listening: Listening;
	try {
		listening = await serve(opts);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EACCES') {
			console.error(`  The plant cannot use port ${a.port}. Pick one from 1025 to 65535: ${commandsFor(dirArg, ' --port 6768').start}`);
			return 1;
		}
		if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') return taken();
		throw err;
	}
	// One bridge per folder: a second would keep its own copy of the threads and overwrite the first's.
	let held: Awaited<ReturnType<typeof lockFolder>>;
	try {
		held = await lockFolder(dir, mine, async (port, k) => (await settledAt(port, dir, k)).there);
	} catch (err) { await listening.close(); console.error(`  ${(err as Error).message}`); return 1; }
	if (held) {
		await listening.close();
		if ('held' in held) return alreadyRunning(held.held);
		console.error(`  ${held.problem}`);
		return 1;
	}
	// The folder stays this start's, between requests too: a lock deleted by hand is put back,
	// and a start that took the folder anyway stops this one.
	setInterval(() => { if (stillHeld(dir, mine)) lost(); }, 5_000).unref();
	process.once('exit', () => { releaseFolder(dir, key); rmSync(join(dir, 'open.html'), { force: true }); });
	for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => { console.log('\n  The plant has stopped. Its link no longer works.'); process.exit(0); });
	// A page left by a start that ended within its minute is not left lying about.
	rmSync(join(dir, 'open.html'), { force: true });
	const url = `http://${name}.localhost:${a.port}/#key=${key}`;
	// Keep the installed hook script the same version as this bridge, and say so when it changes.
	const installed = hookScriptPath();
	let updated = false;
	if (existsSync(installed)) {
		try {
			if (readFileSync(installed, 'utf8') !== readFileSync(hookSource, 'utf8')) { copyAtomic(hookSource, installed); updated = true; }
		} catch { /* The old one still works. */ }
	}
	let agents = 0;
	try { agents = readdirSync(join(dir, 'agents')).filter((n) => n.endsWith('.json')).length; } catch { /* None yet. */ }
	console.log(`★ The People's Plant #67 is ${a.open ? 'open' : 'running'} at ${url}`);
	console.log('  That link carries the plant\'s key until the plant stops. Keep it to yourself.');
	if (agents) console.log(`  Agents: ${agents} on file.`);
	else {
		const ready = wiredHere().map((t) => (t === 'claude' ? 'Claude Code' : 'Codex'));
		if (ready.length) console.log(`  ${ready.join(' and ')} ${ready.length > 1 ? 'are' : 'is'} wired. Start a new session in a project folder, and it appears here.`);
		else {
			console.log('  No agents yet. In a second terminal, wire one:');
			console.log(`    Claude Code:  ${commands.claude}`);
			console.log(`    Codex:        ${commands.codex}`);
			console.log('                  Then type /hooks in Codex and trust the plant\'s hooks.');
		}
	}
	console.log(`  Files:  ${dir}        Stop: Ctrl+C`);
	if (updated) console.log(`  Updated the hook script in ${installed} to this version.`);
	for (const l of stale()) console.log(`  ${l}`);
	if (inWsl()) console.log('  Inside WSL, the browser runs on the Windows side, which the plant cannot check. A program there could take this port. Use the plant in WSL only on a computer nobody else uses.');
	if (a.open) {
		openBrowser(dir, url);
		console.log('  If the plant did not open in your browser, open the link above.');
	}
	return -1;
}
