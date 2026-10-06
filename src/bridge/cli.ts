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
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDir, closeFolder, copyAtomic, defaultDir, ensureDir, hookScriptPath, lockFolder, newKey, plantDir } from './files';
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
			if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('--port needs a number from 1 to 65535.');
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
 * What answers on a port: a bridge (and the folder it serves, as a hash), something else, or nothing.
 *
 * @param port Port.
 * @returns The bridge's folder hash, 'other', or null when nothing answers.
 */
function bridgeAt(port: number): Promise<string | 'other' | null> {
	return new Promise((resolve) => {
		const req = request({ host: '127.0.0.1', port, path: '/api/plant-bridge', headers: { host: `127.0.0.1:${port}` }, timeout: 1500 }, (res) => {
			let t = '';
			res.on('data', (c) => { t += c; });
			res.on('end', () => { try { const o = JSON.parse(t); resolve(o.bridge === true && typeof o.folder === 'string' ? o.folder : 'other'); } catch { resolve('other'); } });
		});
		req.on('error', () => resolve(null));
		req.on('timeout', () => { req.destroy(); resolve('other'); });
		req.end();
	});
}

/**
 * Open a page in the default browser. A failure only means the owner opens it by hand.
 *
 * @param url Page.
 */
function openBrowser(url: string): void {
	const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
	try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* Opened by hand. */ }
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
			const o = { target: a.target!, remove: a.remove, dir, hookSource };
			for (const l of a.notify ? installNotify(o) : install(o)) console.log(`  ${l}`);
			if (!a.remove) console.log(`  Undo: ${NPX} hooks ${a.target}${a.notify ? ' --notify' : ''}${dirArg} --remove`);
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
	// One bridge per folder: a second would keep its own copy of the threads and overwrite the first's.
	const held = lockFolder(dir, a.port);
	if (held !== null) {
		const port = held || a.port;
		let key = '';
		try { key = readFileSync(join(dir, 'key'), 'utf8').trim(); } catch { /* Opened without a key: the page says how to get one. */ }
		const there = `http://127.0.0.1:${port}/${key ? `#key=${key}` : ''}`;
		console.log(`★ The plant for this folder is already running. Open it at ${there}`);
		if (a.open) openBrowser(there);
		return 0;
	}
	const key = newKey(dir);
	// Keep the installed hook script the same version as this bridge, and say so when it changes.
	const installed = hookScriptPath();
	let updated = false;
	if (existsSync(installed)) {
		try {
			if (readFileSync(installed, 'utf8') !== readFileSync(hookSource, 'utf8')) { copyAtomic(hookSource, installed); updated = true; }
		} catch { /* The old one still works. */ }
	}
	const stale = (): string[] => staleNode().map((s) => `The ${s.target === 'claude' ? 'Claude Code' : 'Codex'} hooks run a Node that is no longer on this computer (${s.node}), so they fail. Run: ${commands[s.target]}`);
	// 127.0.0.1, not localhost: the name localhost may reach another program on the same port.
	// The key goes after the #, which the browser never sends to a server.
	const url = `http://127.0.0.1:${a.port}/#key=${key}`;
	try {
		await serve({ dir, web, port: a.port, key, log: (l) => console.error(`  ${l}`), wiring: () => ({ ...commands, warnings: stale() }) });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
			const there = await bridgeAt(a.port);
			const elsewhere = commandsFor(dirArg, ` --port ${a.port + 1}`).start;
			console.error(there && there !== 'other'
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
	if (a.open) openBrowser(url);
	return -1;
}
