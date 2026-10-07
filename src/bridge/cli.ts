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
import { addressName, checkDir, closeFolder, copyAtomic, defaultDir, ensureDir, hookScriptPath, keepKey, lockFolder, newKey, plantDir, proofOf, releaseFolder, writeAtomic } from './files';
import { randomBytes } from 'node:crypto';
import { NPX, commandsFor } from './words';
import { MARK, type Target, install, installNotify, staleNode } from './install';
import { serve } from './server';

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
  --dir <folder>  Keep the plant's files somewhere else (default ~/.plant-67).
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
 * What answers on a port: this plant's bridge (it proves it holds the key in this folder),
 * another bridge, something that does not answer in time, something else, or nothing.
 *
 * @param port Port.
 * @param dir The plant's folder, whose key file the proof is checked against.
 * @returns What is there.
 */
function bridgeAt(port: number, dir: string): Promise<'here' | 'bridge' | 'silent' | 'other' | null> {
	const challenge = randomBytes(16).toString('hex');
	let key = '';
	try { key = readFileSync(join(dir, 'key'), 'utf8').trim(); } catch { /* No key: nothing can prove it is here. */ }
	return new Promise((resolve) => {
		const req = request({ host: '127.0.0.1', port, path: `/api/plant-bridge?challenge=${challenge}`, headers: { host: `127.0.0.1:${port}` }, timeout: 3000 }, (res) => {
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
 * Open the plant in the default browser. The link carries the key, and a program's arguments
 * can be read by every user on the computer, so the browser is given a small page in the
 * plant's own folder (readable by its owner alone) that forwards to the link. The page is
 * removed a minute later. A failure only means the owner opens the printed link by hand.
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

/**
 * Run the command.
 *
 * @param argv Arguments after the script.
 * @param here The folder this script was built into (dist-bridge).
 * @returns Exit code, or -1 while the bridge runs.
 */
export async function main(argv: string[], here: string = dirname(fileURLToPath(import.meta.url))): Promise<number> {
	if (process.platform === 'win32') { console.error('The plant does not run on Windows yet. Use it inside WSL.'); return 1; }
	let a: Args;
	try { a = parseArgs(argv); } catch (err) { console.error((err as Error).message); return 2; }
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
			ensureDir(dir);
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
	if (!existsSync(join(web, 'index.html'))) { console.error(`The plant's pages are missing from ${web}. Reinstall, or run npm run bridge in a clone.`); return 1; }
	ensureDir(dir);
	closeFolder(dir);
	// A page left by a start that ended within its minute is not left lying about.
	rmSync(join(dir, 'open.html'), { force: true });
	/**
	 * Point the owner at the plant already running for this folder. Only reached once that bridge
	 * has proved it holds this folder's key, so the key is never handed to anything else.
	 *
	 * @param port Its port.
	 * @returns Exit code.
	 */
	const alreadyRunning = (port: number): number => {
		const key = readFileSync(join(dir, 'key'), 'utf8').trim();
		const there = `http://${addressName(dir)}.localhost:${port}/#key=${key}`;
		console.log(`★ The plant for this folder is already running. Open it at ${there}`);
		if (a.open) openBrowser(dir, there);
		return 0;
	};
	// One bridge per folder: a second would keep its own copy of the threads and overwrite the first's.
	let held: Awaited<ReturnType<typeof lockFolder>>;
	try {
		held = await lockFolder(dir, a.port, async (port) => {
			const there = await bridgeAt(port, dir);
			return there === 'here' ? 'here' : there === 'silent' ? 'silent' : 'gone';
		});
	} catch (err) { console.error(`  ${(err as Error).message}`); return 1; }
	if (held && 'port' in held) return alreadyRunning(held.port);
	if (held) { console.error(`  ${held.problem}`); return 1; }
	process.once('exit', () => { releaseFolder(dir); rmSync(join(dir, 'open.html'), { force: true }); });
	for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => process.exit(0));
	const key = newKey();
	// Keep the installed hook script the same version as this bridge, and say so when it changes.
	const installed = hookScriptPath();
	let updated = false;
	if (existsSync(installed)) {
		try {
			if (readFileSync(installed, 'utf8') !== readFileSync(hookSource, 'utf8')) { copyAtomic(hookSource, installed); updated = true; }
		} catch { /* The old one still works. */ }
	}
	const stale = (): string[] => staleNode().map((s) => `The ${s.target === 'claude' ? 'Claude Code' : 'Codex'} hooks run a Node that is no longer on this computer (${s.node}), so they fail. Run: ${commands[s.target]}`);
	// The plant's own address (see addressName), never shared with anything else on 127.0.0.1.
	// The key goes after the #, which the browser never sends to a server.
	const name = addressName(dir);
	const url = `http://${name}.localhost:${a.port}/#key=${key}`;
	try {
		await serve({ dir, web, port: a.port, key, name, log: (l) => console.error(`  ${l}`), wiring: () => ({ ...commands, warnings: stale() }) });
		// Kept only once listening: a start that failed must not replace the running bridge's key.
		keepKey(dir, key);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EACCES') {
			console.error(`The plant cannot use port ${a.port}. Pick one from 1025 to 65535: ${commandsFor(dirArg, ' --port 6768').start}`);
			return 1;
		}
		if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
			const there = await bridgeAt(a.port, dir);
			if (there === 'here') return alreadyRunning(a.port);
			const elsewhere = commandsFor(dirArg, ` --port ${a.port + 1}`).start;
			console.error(there === 'bridge'
				? `A plant for another folder is already on port ${a.port}. Stop it with Ctrl+C in its terminal, or start this one on another port: ${elsewhere}`
				: `Something else is using port ${a.port}. Start the plant on another port: ${elsewhere}`);
			return 1;
		}
		throw err;
	}
	let agents = 0;
	try { agents = readdirSync(join(dir, 'agents')).filter((n) => n.endsWith('.json')).length; } catch { /* None yet. */ }
	console.log(`★ The People's Plant #67 is open at ${url}`);
	console.log('  That link carries the plant\'s key until the plant stops. Keep it to yourself.');
	if (agents) console.log(`  Agents: ${agents} on file.`);
	else {
		console.log('  No agents yet. In a second terminal, wire one:');
		console.log(`    Claude Code:  ${commands.claude}`);
		console.log(`    Codex:        ${commands.codex}   (then type /hooks in Codex and trust the plant's hooks)`);
	}
	console.log(`  Files:  ${dir}        Stop: Ctrl+C`);
	if (updated) console.log(`  Updated the hook script in ${installed} to this version.`);
	for (const l of stale()) console.log(`  ${l}`);
	if (a.open) {
		openBrowser(dir, url);
		console.log('  If the browser shows an error instead of the plant, open the link above.');
	}
	return -1;
}
