/**
 * Wiring a harness (src/bridge/install.ts) on copies of settings files: the owner's own hooks
 * and settings survive install and remove, installing twice adds nothing twice, a broken file
 * is left alone, a path that cannot be quoted safely is refused, and the Codex notify fallback
 * never replaces another notify program. Also the CLI's arguments.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parseArgs } from '../src/bridge/cli';
import { EVENTS, MARK, add, commandFor, install, installNotify, staleNode, strip, wired } from '../src/bridge/install';
import { checkDir, lockFolder, newAddressName, newKey, plantDir, readLock, releaseFolder, stillHeld } from '../src/bridge/files';
import { proofOf } from '../src/bridge/proof';
import { chmodSync, lstatSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';

/**
 * A scratch home: a harness config folder, the bridge's folder and a fake built hook.
 *
 * @returns Paths and an options maker.
 */
function home() {
	const root = mkdtempSync(join(tmpdir(), 'plant-install-'));
	made.push(root);
	const claude = join(root, 'claude'), codex = join(root, 'codex'), dir = join(root, 'plant');
	mkdirSync(claude); mkdirSync(codex);
	const hookSource = join(root, MARK);
	writeFileSync(hookSource, '// hook');
	const env = { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex };
	// The script goes inside the scratch home too: never into the real ~/.plant-67.
	const script = join(dir, 'hooks', MARK);
	const opts = (target: 'claude' | 'codex', remove = false) => ({ target, remove, dir, script, hookSource, node: '/usr/local/bin/node', env });
	return { root, claude, codex, dir, opts };
}

/** Scratch homes made by home(), removed at the end. */
const made: string[] = [];
after(() => { for (const m of made) rmSync(m, { recursive: true, force: true }); });

/** Folder checks need scratch folders under the home folder: the plant rightly refuses shared ones such as /tmp. */
const ROOT = realpathSync(mkdtempSync(join(homedir(), '.plant-tests-')));
after(() => rmSync(ROOT, { recursive: true, force: true }));

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
	assert.equal(ours[0].command, `"/usr/local/bin/node" "${join(h.dir, 'hooks', MARK)}" claude --dir "${h.dir}"`, 'the folder is always named: the hook never reads it from the environment');
	assert.ok(existsSync(join(h.dir, 'hooks', MARK)), 'the script is copied where it stays');
	assert.deepEqual(JSON.parse(readFileSync(`${path}.plant-67-backup`, 'utf8')), OWNER);
	assert.ok(lines.some((l) => /Added 8 plant hooks/.test(l)));
	// Twice is the same as once, and says so.
	assert.match(install(h.opts('claude')).at(-1) ?? '', /The plant's 8 hooks in .* are up to date\./);
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
	assert.match(codex.hooks.PermissionRequest[0].hooks[0].command, / codex --dir "[^"]+"$/);
	assert.equal(codex.hooks.UserPromptSubmit[0].hooks[0].additionalContextLimit, 10_000, 'Codex is told the plant\'s context may run to 10,000 characters');
	writeFileSync(join(h.claude, 'settings.json'), '{ "model": "opus", }');
	assert.throws(() => install(h.opts('claude')), /not valid JSON, so the plant changed nothing/);
	assert.equal(readFileSync(join(h.claude, 'settings.json'), 'utf8'), '{ "model": "opus", }');
	writeFileSync(join(h.claude, 'settings.json'), JSON.stringify({ hooks: [] }));
	assert.throws(() => install(h.opts('claude')), /not in the shape/);
});

test('the command quotes its paths, names a folder that is not the default, and refuses unquotable ones', () => {
	assert.equal(commandFor('/n/node', '/My Stuff/plant-hook.mjs', 'claude', '/My Stuff/plant'), '"/n/node" "/My Stuff/plant-hook.mjs" claude --dir "/My Stuff/plant"');
	for (const bad of ['/a"b', '/a$(rm)', '/a`x`', '/a\\b']) assert.throws(() => commandFor('/n/node', bad, 'claude', '/p'), /cannot write a safe hook command/);
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

test('hooks moved to another plant\'s folder say so, and wired() finds them', () => {
	const h = home();
	install(h.opts('claude'));
	assert.deepEqual(wired(h.opts('claude').env).map((w) => [w.target, w.dirs]), [['claude', [h.dir]]]);
	const other = join(h.root, 'other-plant');
	const lines = install({ ...h.opts('claude'), dir: other });
	assert.ok(lines.includes(`The Claude Code hooks pointed at the plant in ${h.dir}. They now point at ${other}, so the plant in ${h.dir} no longer hears from Claude Code.`), lines.join('\n'));
	assert.deepEqual(wired(h.opts('claude').env)[0].dirs, [other]);
	assert.ok(!install({ ...h.opts('claude'), dir: other }).some((l) => /pointed at/.test(l)), 'not said again when nothing moved');
});

test('the Codex notify fallback goes first in config.toml and never replaces another program', () => {
	const h = home();
	const path = join(h.codex, 'config.toml');
	writeFileSync(path, 'model = "o4"\n\n[tui]\nnotifications = true\n');
	installNotify(h.opts('codex'));
	const text = readFileSync(path, 'utf8');
	assert.match(text.split('\n')[0], /^notify = \["\/usr\/local\/bin\/node", ".*plant-hook\.mjs", "codex-notify", "--dir", "[^"]+"\]$/);
	assert.match(text, /\[tui\]\nnotifications = true/);
	const again = installNotify(h.opts('codex'));
	assert.equal(again.length, 2);
	assert.match(again[1], /^The plant's notify line in .*config\.toml is up to date\.$/, 'run again: said so, and nothing changed');
	assert.equal(readFileSync(path, 'utf8'), text);
	assert.equal(readFileSync(`${path}.plant-67-backup`, 'utf8'), 'model = "o4"\n\n[tui]\nnotifications = true\n', 'the backup is still the owner\'s own file');
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

test('the plant\'s folder: absolute, its real path, and refused where a project or another user could reach it', () => {
	assert.equal(plantDir('plantdata', {}), join(process.cwd(), 'plantdata'), 'a relative --dir is made absolute where it was typed');
	assert.equal(plantDir('~/plantx', {}), join(homedir(), 'plantx'), 'a ~ the shell left alone is the home folder');
	assert.equal(plantDir('~', {}), homedir());
	assert.throws(() => checkDir(homedir(), homedir()), /That is your home folder itself\. Keep the plant's files in a folder of their own inside it/, 'never the home folder itself');
	assert.throws(() => parseArgs(['--dir', '~someone/plant']), /Write the folder's full path/);
	assert.equal(plantDir(null, { PLANT67_DIR: '.plantx' }), plantDir(null, {}), 'a relative $PLANT67_DIR is ignored: a hook would read it inside the project');
	const h = { root: mkdtempSync(join(ROOT, 'folder-')) };
	const real = (p: string) => realpathSync(p);
	mkdirSync(join(h.root, 'repo', '.git'), { recursive: true });
	assert.throws(() => checkDir(join(h.root, 'repo', 'deep', 'plant'), homedir()), /inside the project at .*repo/);
	// A home folder that is itself a dotfiles repository is fine; a project inside it is not.
	const homeDir = join(h.root, 'home');
	mkdirSync(join(homeDir, '.git'), { recursive: true });
	assert.equal(checkDir(join(homeDir, '.plant-67'), homeDir), join(real(homeDir), '.plant-67'));
	mkdirSync(join(homeDir, 'code', 'shop', '.git'), { recursive: true });
	assert.throws(() => checkDir(join(homeDir, 'code', 'shop', '.plant'), homeDir), /inside the project/);
	const open = join(h.root, 'open');
	mkdirSync(open);
	chmodSync(open, 0o777);
	assert.equal(checkDir(open, homedir()), real(open), 'the plant\'s own folder, left open by a loose umask, is closed rather than refused');
	assert.equal(statSync(open).mode & 0o777, 0o700);
	mkdirSync(join(open, 'agents'));
	chmodSync(join(open, 'agents'), 0o770);
	chmodSync(open, 0o775);
	assert.throws(() => checkDir(open, homedir()), new RegExp(`Your group can write to .*agents.*chmod -R g-w "${real(open)}"`), 'what is inside gets one fix for all of it');
	assert.equal(statSync(open).mode & 0o777, 0o775, 'a folder the plant refuses is left as it was');
	chmodSync(join(open, 'agents'), 0o700);
	chmodSync(open, 0o777);
	const sticky = join(h.root, 'sticky');
	mkdirSync(sticky);
	chmodSync(sticky, 0o1777);
	assert.throws(() => checkDir(join(sticky, 'x', 'plant'), homedir()), /in a folder other users can change/, 'a shared folder like /tmp is refused, sticky or not: what is made there can be made again by someone else');
	assert.throws(() => checkDir(join(open, 'plant'), homedir()), /in a folder other users can change/, 'a folder under a shared one is refused too');
	chmodSync(open, 0o700);
	mkdirSync(join(open, 'inbox', 'deep'), { recursive: true });
	chmodSync(join(open, 'inbox', 'deep'), 0o777);
	assert.throws(() => checkDir(open, homedir()), /Other users can write to .*deep/, 'and everything inside it');
	chmodSync(join(open, 'inbox', 'deep'), 0o700);
	symlinkSync('/etc', join(open, 'inbox', 'deep', 'link'));
	assert.throws(() => checkDir(open, homedir()), /is a link/, 'no link inside it');
	unlinkSync(join(open, 'inbox', 'deep', 'link'));
	// A link is followed now, and the real path is what gets used.
	symlinkSync(open, join(h.root, 'link'));
	assert.equal(checkDir(join(h.root, 'link'), homedir()), real(open));
	assert.equal(checkDir(join(h.root, 'not-yet', 'deeper'), homedir()), join(real(h.root), 'not-yet', 'deeper'), 'a folder not made yet is fine');
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

/**
 * A process id that has gone: a child that has already exited.
 *
 * @returns Process id.
 */
function gonePid(): number {
	const r = spawnSync(process.execPath, ['-e', '']);
	return r.pid;
}

test('one bridge per folder: a running holder that proves the lock\'s key keeps it; anything else loses it', async () => {
	const h = home();
	mkdirSync(h.dir, { recursive: true });
	const N = 'p67-0123456789abcdef';
	const lock = (pid: number, port = 47001) => writeFileSync(join(h.dir, 'bridge.lock'), JSON.stringify({ pid, port, name: N, key: 'k'.repeat(64) }));
	const me = (key: string) => ({ port: 6767, name: 'p67-ffffffffffffffff', key });
	const notAsked = async (): Promise<never> => { throw new Error('not asked'); };
	// Another process that is running (this test's parent).
	lock(process.ppid);
	let asked: [number, string] | null = null;
	assert.deepEqual(await lockFolder(h.dir, me('m'), async (port, key) => { asked = [port, key]; return 'here'; }), { held: { pid: process.ppid, port: 47001, name: N, key: 'k'.repeat(64) } });
	assert.deepEqual(asked, [47001, 'k'.repeat(64)], 'asked to prove the key in the lock');
	// A running plant that does not answer was most likely paused (Ctrl+Z): never "delete the lock".
	const frozen = (await lockFolder(h.dir, me('m'), async () => 'silent') as { problem: string }).problem;
	assert.equal(frozen, `The plant for this folder is still running as process ${process.ppid} on port 47001, but it does not answer. It may be busy, or paused with Ctrl+Z. If you paused it, type fg in its terminal, then press Ctrl+C. If it stays stuck, stop it with: kill ${process.ppid}; kill -CONT ${process.ppid}`);
	// The writer of a lock listens on its port before it locks, so anything else on that port (or
	// nothing) means the writer has gone and its process id is someone else's now.
	for (const who of ['other', 'bridge', null] as const) {
		lock(process.ppid);
		assert.equal(await lockFolder(h.dir, me('n'), async () => who), null, `taken over when ${who ?? 'nothing'} answers`);
	}
	// A lock of an older plant, which this one cannot read: left behind.
	writeFileSync(join(h.dir, 'bridge.lock'), JSON.stringify({ pid: process.ppid, port: 47001, nonce: 'x' }));
	assert.equal(await lockFolder(h.dir, me('m'), notAsked), null);
	// A lock naming this start's own port: this start holds that port, so no other plant can.
	lock(process.ppid, 6767);
	assert.equal(await lockFolder(h.dir, me('m'), notAsked), null, 'taken over without asking');
	// A process that has gone left the lock behind: taken over without asking.
	lock(gonePid());
	assert.equal(await lockFolder(h.dir, me('m'), notAsked), null, 'taken over');
	assert.deepEqual(JSON.parse(readFileSync(join(h.dir, 'bridge.lock'), 'utf8')), { pid: process.pid, ...me('m') });
	assert.equal(statSync(join(h.dir, 'bridge.lock')).mode & 0o777, 0o600);
	releaseFolder(h.dir, 'another start\'s key');
	assert.equal(existsSync(join(h.dir, 'bridge.lock')), true, 'only the start that took it gives it back');
	releaseFolder(h.dir, 'm');
	assert.equal(existsSync(join(h.dir, 'bridge.lock')), false);
	assert.deepEqual(readdirSync(h.dir), ['start'], 'no temporary files left behind: only the record of the newest start, kept on purpose');
});

test('the running plant keeps its folder: a lock deleted by hand is put back, unless another start has come since', async () => {
	const h = home();
	mkdirSync(h.dir, { recursive: true });
	const mine = { port: 6767, name: 'p67-0123456789abcdef', key: 'm' };
	assert.equal(await lockFolder(h.dir, mine, async () => null), null);
	assert.equal(readFileSync(join(h.dir, 'start'), 'utf8'), 'm', 'the newest start is named');
	assert.equal(stillHeld(h.dir, mine), true);
	rmSync(join(h.dir, 'bridge.lock'));
	assert.equal(stillHeld(h.dir, mine), true);
	assert.equal(readLock(h.dir)?.key, 'm', 'put back');
	// Another start takes the folder (the lock deleted by hand while this one was paused).
	rmSync(join(h.dir, 'bridge.lock'));
	const other = { port: 6768, name: 'p67-ffffffffffffffff', key: 'other' };
	assert.equal(await lockFolder(h.dir, other, async () => null), null);
	assert.equal(stillHeld(h.dir, mine), false, 'while it runs');
	releaseFolder(h.dir, 'other');
	assert.equal(existsSync(join(h.dir, 'bridge.lock')), false);
	assert.equal(stillHeld(h.dir, mine), false, 'and after it has stopped: its threads are newer than this start\'s copy');
	assert.equal(existsSync(join(h.dir, 'bridge.lock')), false, 'nothing put back');
});

test('the address name and the key are new at every start, and the key is proven without being given', () => {
	assert.match(newAddressName(), /^p67-[0-9a-f]{16}$/);
	assert.notEqual(newAddressName(), newAddressName());
	const a = newKey(), b = newKey();
	assert.match(a, /^[0-9a-f]{64}$/);
	assert.notEqual(a, b);
	assert.equal(proofOf(a, 'c1'), proofOf(a, 'c1'));
	assert.notEqual(proofOf(a, 'c1'), proofOf(a, 'c2'));
	assert.notEqual(proofOf(a, 'c1'), proofOf(b, 'c1'));
	assert.ok(!proofOf(a, 'c1').includes(a));
});

test('--notify is not added on top of the hooks', () => {
	const h = home();
	install(h.opts('codex'));
	assert.match(installNotify(h.opts('codex'))[0], /already in .*hooks\.json, so Codex does not need the notify line\. Nothing was changed\./);
	assert.equal(existsSync(join(h.codex, 'config.toml')), false);
});
