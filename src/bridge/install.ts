/**
 * `hooks claude|codex [--remove]`: wire a harness to the bridge, or unwire it.
 *
 * The hook script is copied to <dir>/hooks/plant-hook.mjs, so the harness runs a file that stays
 * put (npx's own copy moves). Each hook the plant adds runs that file, which is how the plant's
 * entries are told apart from the owner's: only entries whose command names plant-hook.mjs are
 * ever added or removed. The settings file is backed up beside itself before any change, and a
 * file that is not valid JSON is left alone.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ensureDir, writeAtomic } from './files';

/** How every command the plant adds is recognised. */
export const MARK = 'plant-hook.mjs';

/** One hook entry, as Claude Code and Codex both write them. */
interface Entry { type: string; command?: string; timeout?: number; async?: boolean; [k: string]: unknown }
interface Group { matcher?: string; hooks?: Entry[]; [k: string]: unknown }
type HooksFile = { hooks?: Record<string, Group[]>; [k: string]: unknown };

/**
 * The events each harness reports to the plant. Those that start and end a turn or a session
 * run in step: two hand messages to the agent (their output is the context), and the ends must
 * finish in order (the answer is sent before the session is forgotten). Tool events and
 * notifications, which can come many times a turn, run in the background so the agent never
 * waits on the plant for them.
 */
export const EVENTS = {
	claude: { sync: ['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd'], background: ['PreToolUse', 'PostToolUse', 'Notification'] },
	codex: { sync: ['SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'], background: ['PreToolUse', 'PostToolUse', 'PermissionRequest'] },
} as const;
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
 * @param dir The bridge's folder, or null for the default.
 * @returns Shell command.
 * @throws Error when a path holds a double quote (it could not be quoted safely).
 */
export function commandFor(node: string, script: string, target: Target, dir: string | null): string {
	for (const p of [node, script, dir ?? '']) if (/["\n\r`$\\]/.test(p)) throw new Error(`The plant cannot write a safe hook command for a path holding quotes, backslashes, $ or backticks: ${p}`);
	return `"${node}" "${script}" ${target}${dir ? ` --dir "${dir}"` : ''}`;
}

/**
 * Whether an entry is one the plant added.
 *
 * @param e Entry.
 * @returns True when its command runs plant-hook.mjs.
 */
const ours = (e: Entry): boolean => typeof e.command === 'string' && e.command.includes(MARK);

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
		const entry: Entry = { type: 'command', command, timeout: 10, ...(background ? { async: true } : {}) };
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
	/** The bridge's folder. */
	dir: string;
	/** True when the folder was asked for (it then goes into the command). */
	dirAsked: boolean;
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
	const path = settingsPath(o.target, o.env);
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
		if (original !== null) writeAtomic(`${path}.plant-67-backup`, original);
		writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
		lines.push(`Removed ${n} plant hooks from ${path}. Your other hooks are untouched.`);
		lines.push(`The old file is kept as ${path}.plant-67-backup.`);
		return lines;
	}
	const script = join(ensureDir(join(o.dir, 'hooks')), MARK);
	copyFileSync(o.hookSource, script);
	lines.push(`Copied the hook script to ${script}`);
	const command = commandFor(o.node ?? process.execPath, script, o.target, o.dirAsked ? o.dir : null);
	const n = add(file, o.target, command);
	ensureDir(dirname(path));
	if (original !== null) {
		writeAtomic(`${path}.plant-67-backup`, original);
		lines.push(`Backed up ${path} to ${path}.plant-67-backup`);
	}
	writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
	lines.push(`Added ${n} plant hooks to ${path}. Your other hooks are untouched.`);
	if (o.target === 'codex') lines.push('Codex asks you to trust new hooks once: open Codex, type /hooks, and trust the plant\'s.');
	lines.push(`Start a new ${name} session and it walks into the plant.`);
	return lines;
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
 * only hears when a turn ends, so the comrade shows at work for a few minutes after each turn
 * and messages are not handed over. Codex allows one notify program, so an existing one is
 * never replaced.
 *
 * @param o Options (target must be codex).
 * @returns Lines to print.
 * @throws Error with a sentence for the owner when nothing could be done.
 */
export function installNotify(o: InstallOptions): string[] {
	const path = codexConfigPath(o.env);
	const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
	const lines = text.split('\n');
	const mine = (l: string): boolean => /^\s*notify\s*=/.test(l) && l.includes(MARK);
	if (o.remove) {
		if (!lines.some(mine)) return [`No plant notify line in ${path}. Nothing to remove.`];
		writeAtomic(`${path}.plant-67-backup`, text);
		writeAtomic(path, lines.filter((l) => !mine(l)).join('\n'));
		return [`Removed the plant's notify line from ${path}. The old file is kept as ${path}.plant-67-backup.`];
	}
	const other = lines.find((l) => /^\s*notify\s*=/.test(l) && !mine(l));
	if (other) throw new Error(`${path} already has a notify program, and Codex allows only one, so the plant changed nothing. Use the hooks instead (run this without --notify), or swap the line by hand.`);
	const script = join(ensureDir(join(o.dir, 'hooks')), MARK);
	copyFileSync(o.hookSource, script);
	const node = o.node ?? process.execPath;
	commandFor(node, script, 'codex', o.dirAsked ? o.dir : null);
	const args = [node, script, 'codex-notify', ...(o.dirAsked ? ['--dir', o.dir] : [])];
	const line = `notify = [${args.map((a) => JSON.stringify(a)).join(', ')}]`;
	// Top-level keys must come before the first [table], so the line goes first.
	const kept = lines.filter((l) => !mine(l));
	if (text) writeAtomic(`${path}.plant-67-backup`, text);
	ensureDir(dirname(path));
	writeAtomic(path, [line, ...kept].join('\n'));
	return [
		`Copied the hook script to ${script}`,
		`Added the plant's notify line to ${path}.`,
		'Codex now tells the plant when each turn ends. Messages from the plant reach Codex only through its hooks: run this without --notify once your Codex has them.',
	];
}
