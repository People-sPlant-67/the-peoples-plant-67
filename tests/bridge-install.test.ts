/**
 * Wiring a harness (src/bridge/install.ts) on copies of settings files: the owner's own hooks
 * and settings survive install and remove, installing twice adds nothing twice, a broken file
 * is left alone, a path that cannot be quoted safely is refused, and the Codex notify fallback
 * never replaces another notify program. Also the CLI's arguments.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseArgs } from '../src/bridge/cli';
import { EVENTS, MARK, add, commandFor, install, installNotify, staleNode, strip } from '../src/bridge/install';
import { checkDir, plantDir } from '../src/bridge/files';
import { chmodSync, lstatSync, symlinkSync } from 'node:fs';

/**
 * A scratch home: a harness config folder, the bridge's folder and a fake built hook.
 *
 * @returns Paths and an options maker.
 */
function home() {
	const root = mkdtempSync(join(tmpdir(), 'plant-install-'));
	const claude = join(root, 'claude'), codex = join(root, 'codex'), dir = join(root, 'plant');
	mkdirSync(claude); mkdirSync(codex);
	const hookSource = join(root, MARK);
	writeFileSync(hookSource, '// hook');
	const env = { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex };
	const opts = (target: 'claude' | 'codex', remove = false) => ({ target, remove, dir, dirAsked: false, hookSource, node: '/usr/local/bin/node', env });
	return { root, claude, codex, dir, opts };
}

const OWNER = {
	model: 'opus',
	permissions: { allow: ['Bash(npm test)'] },
	hooks: {
		Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
		PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '~/guard.sh' }] }],
	},
};

test('install adds one entry per event, keeps the owner\'s settings, and backs up the old file', () => {
	const h = home();
	const path = join(h.claude, 'settings.json');
	writeFileSync(path, JSON.stringify(OWNER));
	const lines = install(h.opts('claude'));
	const after = JSON.parse(readFileSync(path, 'utf8'));
	assert.equal(after.model, 'opus');
	assert.deepEqual(after.permissions, OWNER.permissions);
	assert.deepEqual(after.hooks.Stop[0], OWNER.hooks.Stop[0], 'the owner\'s own Stop hook stays first');
	assert.equal(after.hooks.PreToolUse[0].matcher, 'Bash');
	const ours = Object.values(after.hooks as Record<string, { hooks: { command: string; async?: boolean }[] }[]>).flat().flatMap((g) => g.hooks).filter((e) => e.command.includes(MARK));
	assert.equal(ours.length, EVENTS.claude.sync.length + EVENTS.claude.background.length);
	assert.equal(after.hooks.UserPromptSubmit[0].hooks[0].async, undefined, 'the prompt hook runs in step: its output is the context');
	assert.equal(after.hooks.Stop[1].hooks[0].async, undefined, 'the end of a turn runs in step: the answer goes before the session is forgotten');
	assert.equal(after.hooks.PostToolUse[0].hooks[0].async, true, 'tool events run in the background');
	assert.equal(ours[0].command, `"/usr/local/bin/node" "${join(h.dir, 'hooks', MARK)}" claude`);
	assert.ok(existsSync(join(h.dir, 'hooks', MARK)), 'the script is copied where it stays');
	assert.deepEqual(JSON.parse(readFileSync(`${path}.plant-67-backup`, 'utf8')), OWNER);
	assert.ok(lines.some((l) => /Added 8 plant hooks/.test(l)));
	// Twice is the same as once.
	install(h.opts('claude'));
	assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), after);
});

test('remove takes out only the plant\'s entries and leaves the file as it was', () => {
	const h = home();
	const path = join(h.claude, 'settings.json');
	writeFileSync(path, JSON.stringify(OWNER));
	install(h.opts('claude'));
	install(h.opts('claude', true));
	assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), OWNER);
	assert.match(install(h.opts('claude', true))[0], /Nothing to remove/);
});

test('a missing settings file is made; a broken one is left alone', () => {
	const h = home();
	install(h.opts('codex'));
	const codex = JSON.parse(readFileSync(join(h.codex, 'hooks.json'), 'utf8'));
	assert.deepEqual(Object.keys(codex.hooks).sort(), [...EVENTS.codex.sync, ...EVENTS.codex.background].sort());
	assert.match(codex.hooks.PermissionRequest[0].hooks[0].command, / codex$/);
	writeFileSync(join(h.claude, 'settings.json'), '{ "model": "opus", }');
	assert.throws(() => install(h.opts('claude')), /not valid JSON, so the plant changed nothing/);
	assert.equal(readFileSync(join(h.claude, 'settings.json'), 'utf8'), '{ "model": "opus", }');
	writeFileSync(join(h.claude, 'settings.json'), JSON.stringify({ hooks: [] }));
	assert.throws(() => install(h.opts('claude')), /not in the shape/);
});

test('the command quotes its paths, names a folder that is not the default, and refuses unquotable ones', () => {
	assert.equal(commandFor('/n/node', '/My Stuff/plant-hook.mjs', 'claude', '/My Stuff/plant'), '"/n/node" "/My Stuff/plant-hook.mjs" claude --dir "/My Stuff/plant"');
	for (const bad of ['/a"b', '/a$(rm)', '/a`x`', '/a\\b']) assert.throws(() => commandFor('/n/node', bad, 'claude', null), /cannot write a safe hook command/);
	assert.throws(() => commandFor('/n/node', 'plantdata/hooks/plant-hook.mjs', 'claude', 'plantdata'), /only writes hook commands with full paths/, 'a relative path would run a file from the agent\'s project');
});

test('strip and add work on odd but valid files', () => {
	const file: Record<string, unknown> = { hooks: { Stop: [{ hooks: [] }, { matcher: 'x' }] } };
	assert.equal(strip(file as never), 0);
	assert.deepEqual(file, { hooks: { Stop: [{ hooks: [] }, { matcher: 'x' }] } });
	const empty: Record<string, unknown> = {};
	add(empty as never, 'claude', `"/n/node" "/p/hooks/${MARK}" claude`);
	strip(empty as never);
	assert.deepEqual(empty, {}, 'nothing of the plant left, not even an empty hooks object');
});

test('the Codex notify fallback goes first in config.toml and never replaces another program', () => {
	const h = home();
	const path = join(h.codex, 'config.toml');
	writeFileSync(path, 'model = "o4"\n\n[tui]\nnotifications = true\n');
	installNotify(h.opts('codex'));
	const text = readFileSync(path, 'utf8');
	assert.match(text.split('\n')[0], /^notify = \["\/usr\/local\/bin\/node", ".*plant-hook\.mjs", "codex-notify"\]$/);
	assert.match(text, /\[tui\]\nnotifications = true/);
	installNotify(h.opts('codex', true));
	assert.equal(readFileSync(path, 'utf8'), 'model = "o4"\n\n[tui]\nnotifications = true\n');
	writeFileSync(path, 'notify = ["say", "done"]\n');
	assert.throws(() => installNotify(h.opts('codex')), /already has a notify program/);
	assert.equal(readFileSync(path, 'utf8'), 'notify = ["say", "done"]\n');
});

test('the command line', () => {
	assert.deepEqual(parseArgs([]), { command: 'serve', target: null, port: 6767, dir: null, open: true, remove: false, notify: false });
	assert.equal(parseArgs(['--port', '7000', '--no-open']).port, 7000);
	assert.deepEqual(parseArgs(['hooks', 'codex', '--notify', '--remove']).target, 'codex');
	assert.throws(() => parseArgs(['hooks']), /Say which harness/);
	assert.throws(() => parseArgs(['--port', 'x']), /--port needs a number/);
	assert.throws(() => parseArgs(['--remove']), /go with hooks/);
	assert.throws(() => parseArgs(['hooks', 'claude', '--notify']), /codex only/);
	assert.throws(() => parseArgs(['--dance']), /does not know "--dance"/);
	assert.equal(parseArgs(['--help']).command, 'help');
});

test('the plant\'s folder is always absolute, and refused inside a project or open to other users', () => {
	assert.equal(plantDir('plantdata', {}), join(process.cwd(), 'plantdata'), 'a relative --dir is made absolute where it was typed');
	const h = home();
	mkdirSync(join(h.root, 'repo', '.git'), { recursive: true });
	assert.throws(() => checkDir(join(h.root, 'repo', 'deep', 'plant')), /inside the project at .*repo/);
	const open = join(h.root, 'open');
	mkdirSync(open);
	chmodSync(open, 0o777);
	assert.throws(() => checkDir(open), /Other users can write to .* chmod 700/);
	chmodSync(open, 0o700);
	assert.doesNotThrow(() => checkDir(open));
	assert.doesNotThrow(() => checkDir(join(h.root, 'not-yet')), 'a folder not made yet is fine');
});

test('copying the hook script replaces a link at the destination instead of writing through it', () => {
	const h = home();
	const victim = join(h.root, 'victim.txt');
	writeFileSync(victim, 'keep me');
	mkdirSync(join(h.dir, 'hooks'), { recursive: true });
	symlinkSync(victim, join(h.dir, 'hooks', MARK));
	install(h.opts('claude'));
	assert.equal(readFileSync(victim, 'utf8'), 'keep me');
	assert.equal(lstatSync(join(h.dir, 'hooks', MARK)).isSymbolicLink(), false);
});

test('the backup is the owner\'s file from before the plant, kept once; a linked settings file stays linked', () => {
	const h = home();
	const real = join(h.root, 'dotfiles-settings.json');
	writeFileSync(real, JSON.stringify(OWNER));
	symlinkSync(real, join(h.claude, 'settings.json'));
	install(h.opts('claude'));
	install(h.opts('claude'));
	install(h.opts('claude', true));
	assert.equal(lstatSync(join(h.claude, 'settings.json')).isSymbolicLink(), true, 'the link is kept');
	assert.deepEqual(JSON.parse(readFileSync(real, 'utf8')), OWNER, 'the file it points to is the one changed');
	assert.deepEqual(JSON.parse(readFileSync(`${real}.plant-67-backup`, 'utf8')), OWNER, 'the backup is the original, not a later install');
});

test('a hook command whose Node has gone is found, so the bridge can say so', () => {
	const h = home();
	install({ ...h.opts('claude'), node: join(h.root, 'old-node', 'bin', 'node') });
	assert.deepEqual(staleNode(h.opts('claude').env), [{ target: 'claude', node: join(h.root, 'old-node', 'bin', 'node') }]);
	install(h.opts('claude'));
	writeFileSync(join(h.root, 'node'), '');
	install({ ...h.opts('claude'), node: join(h.root, 'node') });
	assert.deepEqual(staleNode(h.opts('claude').env), []);
});
