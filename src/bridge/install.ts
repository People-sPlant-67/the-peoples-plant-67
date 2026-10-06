/**
 * `hooks claude|codex [--remove]`: wire a harness to the bridge, or unwire it.
 *
 * The hook script is copied to <dir>/hooks/plant-hook.mjs, so the harness runs a file that stays
 * put (npx's own copy moves). Each hook the plant adds runs that file, which is how the plant's
 * entries are told apart from the owner's: only entries whose command names plant-hook.mjs are
 * ever added or removed. The settings file is backed up beside itself before any change, and a
 * file that is not valid JSON is left alone.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { HOOK_EVENTS, copyAtomic, ensureDir, hookScriptPath, writeAtomic } from './files';

/** The hook script's file name. */
export const MARK = 'plant-hook.mjs';
/** How every command the plant adds is recognised: it names the script inside a hooks folder, quoted. */
export const COMMAND_MARK = `/hooks/${MARK}"`;

/** One hook entry, as Claude Code and Codex both write them. */
interface Entry { type: string; command?: string; timeout?: number; async?: boolean; [k: string]: unknown }
interface Group { matcher?: string; hooks?: Entry[]; [k: string]: unknown }
type HooksFile = { hooks?: Record<string, Group[]>; [k: string]: unknown };

/** The events each harness reports to the plant, and which run in the background (see files.ts). */
export const EVENTS = HOOK_EVENTS;
export type Target = keyof typeof EVENTS;

/**
 * Where a harness keeps its hooks.
 *
 * @param target Harness.
 * @param env Environment.
 * @returns Settings file path.
 */
export function settingsPath(target: Target, env: NodeJS.ProcessEnv = process.env): string {
	if (target === 'claude') return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
	return join(env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json');
}

/**
 * The command a hook runs: this Node, the copied script, the harness, and the folder when it
 * is not the default.
 *
 * @param node Path to node.
 * @param script Path to plant-hook.mjs.
 * @param target Harness.
 * @param dir The bridge's folder, always named: the hook must never fall back on an environment
 *   variable, which it would read inside the agent's project.
 * @returns Shell command.
 * @throws Error when a path holds a double quote (it could not be quoted safely).
 */
export function commandFor(node: string, script: string, target: Target, dir: string): string {
	for (const p of [node, script, dir]) if (/["\n\r`$\\]/.test(p)) throw new Error(`The plant cannot write a safe hook command for a path holding quotes, backslashes, $ or backticks: ${p}`);
	// The harness runs hooks inside the agent's project: a relative path would point into it.
	for (const p of [node, script, dir]) if (!p.startsWith('/')) throw new Error(`The plant only writes hook commands with full paths, and this one is not: ${p}`);
	return `"${node}" "${script}" ${target} --dir "${dir}"`;
}

/**
 * Whether an entry is one the plant added.
 *
 * @param e Entry.
 * @returns True when its command runs plant-hook.mjs.
 */
const ours = (e: Entry): boolean => typeof e.command === 'string' && e.command.includes(COMMAND_MARK);

/**
 * Take every plant entry out of a hooks file, dropping groups and events left empty.
 *
 * @param file Parsed settings.
 * @returns How many entries were removed.
 */
export function strip(file: HooksFile): number {
	let n = 0;
	const hooks = file.hooks;
	if (!hooks || typeof hooks !== 'object') return 0;
	for (const [event, groups] of Object.entries(hooks)) {
		if (!Array.isArray(groups)) continue;
		const kept: Group[] = [];
		for (const g of groups) {
			if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
			const left = g.hooks.filter((e) => !ours(e));
			n += g.hooks.length - left.length;
			if (left.length) kept.push({ ...g, hooks: left });
			else if (g.hooks.length === 0) kept.push(g);
		}
		if (kept.length) hooks[event] = kept;
		else delete hooks[event];
	}
	if (!Object.keys(hooks).length) delete file.hooks;
	return n;
}

/**
 * Add the plant's entries (after taking out any old ones).
 *
 * @param file Parsed settings.
 * @param target Harness.
 * @param command The hook command.
 * @returns How many entries were added.
 */
export function add(file: HooksFile, target: Target, command: string): number {
	strip(file);
	if (!file.hooks || typeof file.hooks !== 'object') file.hooks = {};
	const ev = EVENTS[target];
	let n = 0;
	for (const event of [...ev.sync, ...ev.background]) {
		const background = (ev.background as readonly string[]).includes(event);
		// Codex keeps a hook's context to its own limit unless told; the plant's never passes 10,000.
		const limit = target === 'codex' && event === 'UserPromptSubmit' ? { additionalContextLimit: 10_000 } : {};
		const entry: Entry = { type: 'command', command, timeout: 10, ...(background ? { async: true } : {}), ...limit };
		const list = Array.isArray(file.hooks[event]) ? file.hooks[event] : [];
		list.push({ hooks: [entry] });
		file.hooks[event] = list;
		n++;
	}
	return n;
}

export interface InstallOptions {
	target: Target;
	remove: boolean;
	/** The bridge's folder: a real, absolute path (see checkDir). */
	dir: string;
	/** Where the hook script goes; ~/.plant-67/hooks/plant-hook.mjs unless a test says otherwise. */
	script?: string;
	/** The built hook script to copy. */
	hookSource: string;
	node?: string;
	env?: NodeJS.ProcessEnv;
	now?: () => number;
}

/**
 * Install or remove the hooks.
 *
 * @param o Options.
 * @returns Lines to print.
 * @throws Error with a sentence for the owner when nothing could be done.
 */
export function install(o: InstallOptions): string[] {
	const path = writable(settingsPath(o.target, o.env));
	const name = o.target === 'claude' ? 'Claude Code' : 'Codex';
	let file: HooksFile = {};
	let original: string | null = null;
	if (existsSync(path)) {
		original = readFileSync(path, 'utf8');
		try {
			const parsed = original.trim() ? JSON.parse(original) : {};
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
			file = parsed as HooksFile;
		} catch {
			throw new Error(`${path} is not valid JSON, so the plant changed nothing. Fix that file first, then run this again.`);
		}
		if (file.hooks !== undefined && (typeof file.hooks !== 'object' || Array.isArray(file.hooks))) throw new Error(`The "hooks" in ${path} are not in the shape the plant expects, so it changed nothing.`);
	}
	const lines: string[] = [];
	if (o.remove) {
		const n = strip(file);
		if (!n) return [`No plant hooks found in ${path}. Nothing to remove.`];
		writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
		lines.push(`Removed ${n} plant hooks from ${path}. Your other hooks are untouched.`);
		return lines;
	}
	const script = o.script ?? hookScriptPath();
	const command = commandFor(o.node ?? process.execPath, script, o.target, o.dir);
	ensureDir(dirname(script));
	copyAtomic(o.hookSource, script);
	lines.push(`Copied the hook script to ${script}`);
	const n = add(file, o.target, command);
	// Run again with nothing to change: say so, and leave the file alone.
	if (original !== null && original.trim() && JSON.stringify(JSON.parse(original)) === JSON.stringify(file)) {
		lines.push(`The plant's ${n} hooks in ${path} are up to date.`);
		if (o.target === 'codex') lines.push('If Codex has not run them yet, open Codex, type /hooks, and trust the plant\'s.');
		return lines;
	}
	ensureDir(dirname(path));
	const kept = backup(path, original);
	if (kept) lines.push(`Backed up ${path} to ${kept}`);
	writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
	lines.push(`Added ${n} plant hooks to ${path}. Your other hooks are untouched.`);
	if (o.target === 'codex') lines.push('Codex asks you to trust new hooks once: open Codex, type /hooks, and trust the plant\'s.');
	lines.push(`Start a new ${name} session and it walks into the plant.`);
	return lines;
}

/**
 * The path to write a settings file at: the file a link points to, so a dotfiles link stays a link.
 *
 * @param path Settings path.
 * @returns Real path, or the path itself when nothing is there yet.
 */
function writable(path: string): string {
	try { return realpathSync(path); } catch { return path; }
}

/**
 * Keep the owner's file as it was before the plant first touched it: the backup is written once
 * and never replaced, so a second install cannot overwrite it with a file that already has the
 * plant in it.
 *
 * @param path Settings path.
 * @param original Its contents now, or null when there is none.
 * @returns The backup's path when one was written now, else null.
 */
function backup(path: string, original: string | null): string | null {
	const to = `${path}.plant-67-backup`;
	if (original === null || existsSync(to)) return null;
	writeAtomic(to, original);
	return to;
}

/**
 * Codex's config.toml path.
 *
 * @param env Environment.
 * @returns Path.
 */
export function codexConfigPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
}

/**
 * The fallback for a Codex without hooks: its one `notify` program, set in config.toml. It
 * only hears when a turn ends, so the comrade shows at work for two minutes after each turn
 * and messages are not handed over. Codex allows one notify program, so an existing one is
 * never replaced.
 *
 * @param o Options (target must be codex).
 * @returns Lines to print.
 * @throws Error with a sentence for the owner when nothing could be done.
 */
export function installNotify(o: InstallOptions): string[] {
	const path = writable(codexConfigPath(o.env));
	const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
	if (!o.remove) {
		let hooked = false;
		try { hooked = strip(JSON.parse(readFileSync(settingsPath('codex', o.env), 'utf8')) as HooksFile) > 0; } catch { /* No hooks file. */ }
		if (hooked) return [`The plant's hooks are already in ${settingsPath('codex', o.env)}, so Codex does not need the notify line. Nothing was changed.`];
	}
	const lines = text.split('\n');
	const mine = (l: string): boolean => /^\s*notify\s*=/.test(l) && l.includes(COMMAND_MARK);
	if (o.remove) {
		if (!lines.some(mine)) return [`No plant notify line in ${path}. Nothing to remove.`];
		writeAtomic(path, lines.filter((l) => !mine(l)).join('\n'));
		return [`Removed the plant's notify line from ${path}.`];
	}
	const other = lines.find((l) => /^\s*notify\s*=/.test(l) && !mine(l));
	if (other) throw new Error(`${path} already has a notify program, and Codex allows only one, so the plant changed nothing. Use the hooks instead (run this without --notify), or swap the line by hand.`);
	const script = o.script ?? hookScriptPath();
	const node = o.node ?? process.execPath;
	// Checked here for the same reasons as a hook command: full paths, nothing a shell would read.
	commandFor(node, script, 'codex', o.dir);
	ensureDir(dirname(script));
	copyAtomic(o.hookSource, script);
	const args = [node, script, 'codex-notify', '--dir', o.dir];
	const line = `notify = [${args.map((a) => JSON.stringify(a)).join(', ')}]`;
	// Top-level keys must come before the first [table], so the line goes first.
	const kept = lines.filter((l) => !mine(l));
	backup(path, text || null);
	ensureDir(dirname(path));
	writeAtomic(path, [line, ...kept].join('\n'));
	return [
		`Copied the hook script to ${script}`,
		`Added the plant's notify line to ${path}.`,
		'Codex now tells the plant when each turn ends. Messages from the plant reach Codex only through its hooks: run this without --notify once your Codex has them.',
	];
}

/**
 * Hook commands of the plant's that run a Node which is no longer there (an nvm or Homebrew
 * upgrade removes the old one). Those hooks fail on every event and the plant goes quiet.
 *
 * @param env Environment.
 * @returns For each harness affected, the missing Node.
 */
export function staleNode(env: NodeJS.ProcessEnv = process.env): { target: Target; node: string }[] {
	const out: { target: Target; node: string }[] = [];
	for (const target of ['claude', 'codex'] as const) {
		let file: HooksFile;
		try { file = JSON.parse(readFileSync(settingsPath(target, env), 'utf8')) as HooksFile; } catch { continue; }
		const commands = Object.values(file.hooks ?? {}).flatMap((g) => (Array.isArray(g) ? g : [])).flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : [])).filter(ours).map((e) => e.command as string);
		const node = commands.map((c) => /^"([^"]+)"/.exec(c)?.[1]).find((n) => n && !existsSync(n));
		if (node) out.push({ target, node });
	}
	return out;
}
