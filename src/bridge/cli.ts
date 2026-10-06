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
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, plantDir } from './files';
import { MARK, type Target, install, installNotify } from './install';
import { serve } from './server';

/** The bridge's port unless --port says otherwise. Sixty-seven twice. */
export const DEFAULT_PORT = 6767;

const NPX = 'npx github:People-sPlant-67/the-peoples-plant-67';

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
  --help          This page.
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
 * Whether a bridge already answers on a port.
 *
 * @param port Port.
 * @returns True when it does.
 */
function bridgeAt(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const req = request({ host: '127.0.0.1', port, path: '/api/plant-bridge', headers: { host: `localhost:${port}` }, timeout: 1500 }, (res) => {
			let t = '';
			res.on('data', (c) => { t += c; });
			res.on('end', () => { try { resolve(JSON.parse(t).bridge === true); } catch { resolve(false); } });
		});
		req.on('error', () => resolve(false));
		req.on('timeout', () => { req.destroy(); resolve(false); });
		req.end();
	});
}

/**
 * Open a page in the default browser. A failure only means the owner opens it by hand.
 *
 * @param url Page.
 */
function openBrowser(url: string): void {
	const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
	try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* Opened by hand. */ }
}

/**
 * Run the command.
 *
 * @param argv Arguments after the script.
 * @param here The folder this script was built into (dist-bridge).
 * @returns Exit code.
 */
export async function main(argv: string[], here: string = dirname(fileURLToPath(import.meta.url))): Promise<number> {
	let a: Args;
	try { a = parseArgs(argv); } catch (err) { console.error((err as Error).message); return 2; }
	if (a.command === 'help') { console.log(HELP); return 0; }
	const dir = plantDir(a.dir);
	const hookSource = join(here, MARK);

	if (a.command === 'hooks') {
		try {
			const o = { target: a.target!, remove: a.remove, dir, dirAsked: !!a.dir, hookSource };
			for (const l of a.notify ? installNotify(o) : install(o)) console.log(`  ${l}`);
			if (!a.remove) console.log(`  Undo: ${NPX} hooks ${a.target}${a.notify ? ' --notify' : ''} --remove`);
			return 0;
		} catch (err) {
			console.error(`  ${(err as Error).message}`);
			return 1;
		}
	}

	const web = join(here, 'web');
	if (!existsSync(join(web, 'index.html'))) { console.error(`The plant's pages are missing from ${web}. Reinstall, or run npm run bridge in a clone.`); return 1; }
	ensureDir(dir);
	// Keep an installed hook script the same version as this bridge.
	const installed = join(dir, 'hooks', MARK);
	if (existsSync(installed)) { try { copyFileSync(hookSource, installed); } catch { /* The old one still works. */ } }
	const url = `http://localhost:${a.port}`;
	try {
		await serve({ dir, web, port: a.port, log: (l) => console.error(`  ${l}`) });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
			if (await bridgeAt(a.port)) {
				console.log(`★ The plant is already running at ${url}`);
				if (a.open) openBrowser(url);
				return 0;
			}
			console.error(`Something else is using port ${a.port}. Start the plant on another: ${NPX} --port 6768`);
			return 1;
		}
		throw err;
	}
	let agents = 0;
	try { agents = readdirSync(join(dir, 'agents')).filter((n) => n.endsWith('.json')).length; } catch { /* None yet. */ }
	console.log(`★ The People's Plant #67 is open at ${url}`);
	console.log(agents ? `  Agents: ${agents} on file.` : `  Agents: none yet. Wire a harness:  ${NPX} hooks claude`);
	console.log(`  Files:  ${dir}        Stop: Ctrl+C`);
	if (a.open) openBrowser(url);
	return -1;
}
