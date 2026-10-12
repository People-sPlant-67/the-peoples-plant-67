/**
 * The built npx command (dist-bridge/cli.mjs, made by npm install or npm run bridge), started
 * for real: two starts at once on one folder end with one bridge, a port someone else holds
 * on [::1] stops the start, a crashed plant's lock is taken over, a paused plant is named as
 * such, and the skeleton adapter in the docs works with it. Each start gets a scratch home, so
 * nothing touches ~/.plant-67.
 */
import assert from 'node:assert/strict';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { requestSignature } from '../src/bridge/proof';
import { join } from 'node:path';
import { after, test } from 'node:test';

const CLI = join(import.meta.dirname, '..', 'dist-bridge', 'cli.mjs');

/**
 * The newest change to any source file below a folder.
 *
 * @param dir Folder.
 * @returns Epoch ms.
 */
function newest(dir: string): number {
	let t = 0;
	for (const e of readdirSync(dir, { withFileTypes: true })) t = Math.max(t, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs);
	return t;
}
/** Set when the build is older than the source: these tests would then try the old plant. */
const STALE = existsSync(CLI) && newest(join(import.meta.dirname, '..', 'src')) > statSync(CLI).mtimeMs;
/** Scratch homes go under the real home folder: the plant rightly refuses shared ones such as /tmp. */
const ROOT = realpathSync(mkdtempSync(join(homedir(), '.plant-tests-')));
const running: ChildProcess[] = [];
after(() => {
	// A plant left paused by a test that ran out of time ignores SIGTERM until it runs again.
	for (const c of running) { c.kill('SIGCONT'); c.kill('SIGKILL'); }
	rmSync(ROOT, { recursive: true, force: true });
});

/**
 * A free port, from the system.
 *
 * @returns Port.
 */
async function freePort(): Promise<number> {
	for (;;) {
		const p = await new Promise<number>((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const n = (s.address() as AddressInfo).port; s.close(() => resolve(n)); }); });
		// Free on [::1] too (or no IPv6 here), as the plant needs it.
		const six = await new Promise<boolean>((resolve) => { const s = createServer(); s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code !== 'EADDRINUSE')); s.listen(p, '::1', () => s.close(() => resolve(true))); });
		if (six) return p;
	}
}

/**
 * Start the plant.
 *
 * @param home Scratch home.
 * @param dir The plant's folder.
 * @param port Port.
 * @returns The process, its output so far, and a promise of its exit code (null while it runs).
 */
function start(home: string, dir: string, port: number) {
	assert.ok(!STALE, 'dist-bridge is older than the source. Run npm run bridge, then the tests again.');
	const child = spawn(process.execPath, [CLI, '--no-open', '--port', String(port), '--dir', dir], { env: { ...process.env, HOME: home, PLANT67_DIR: '' } });
	running.push(child);
	const out = { text: '' };
	child.stdout.on('data', (c) => { out.text += c; });
	child.stderr.on('data', (c) => { out.text += c; });
	const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
	return { child, out, exited };
}

/**
 * Whether something answers as a bridge on a port.
 *
 * @param port Port.
 * @returns True when it does.
 */
function answers(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const req = request({ host: '127.0.0.1', port, path: '/api/plant-bridge', headers: { host: `localhost:${port}` }, timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
		req.on('error', () => resolve(false));
		req.on('timeout', () => { req.destroy(); resolve(false); });
		req.end();
	});
}

/**
 * Wait until a test holds, or give up.
 *
 * @param ok The test.
 * @param why What was waited for, and what the plant said, for the failure.
 * @param ms How long to wait.
 */
async function until(ok: () => boolean | Promise<boolean>, why: () => string, ms = 15_000): Promise<void> {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await ok()) return;
	assert.fail(`Timed out waiting: ${why()}`);
}

/**
 * A GET signed as the plant's page signs it, with the key in the folder's lock.
 *
 * @param dir The plant's folder.
 * @param path Path.
 * @param lock The lock to use instead of the folder's (its text).
 * @returns Status and body.
 */
function signedGet(dir: string, path: string, lock = readFileSync(join(dir, 'bridge.lock'), 'utf8')): Promise<{ status: number; text: string }> {
	const { port, key } = JSON.parse(lock) as { port: number; key: string };
	const nonce = randomBytes(16).toString('hex');
	return new Promise((resolve, reject) => {
		request({ host: '127.0.0.1', port, path, headers: { host: `localhost:${port}`, 'x-plant-nonce': nonce, 'x-plant-auth': requestSignature(key, nonce, 'GET', path, '') } }, (res) => {
			let text = '';
			res.on('data', (c) => { text += c; });
			res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
		}).on('error', reject).end();
	});
}

/** Every start here is over within this, or the test fails instead of hanging CI. */
const LIMIT = { timeout: 60_000 };

test('two starts at once on one folder end with one bridge, and the other points at it', { ...LIMIT, skip: !existsSync(CLI) && 'run npm run bridge first' }, async () => {
	for (const samePort of [false, true]) {
		const home = mkdtempSync(join(ROOT, 'home-'));
		const dir = join(home, 'plant');
		const [p1, p2] = [await freePort(), await freePort()];
		const a = start(home, dir, p1), b = start(home, dir, samePort ? p1 : p2);
		// One keeps running; the other ends at once.
		const first = await Promise.race([a.exited.then(() => 'a'), b.exited.then(() => 'b')]);
		const [stays, ends] = first === 'a' ? [b, a] : [a, b];
		assert.equal(await ends.exited, 0, ends.out.text);
		assert.match(ends.out.text, /already running/, ends.out.text);
		await until(() => existsSync(join(dir, 'bridge.lock')), () => `the lock. ${stays.out.text}`);
		const lock = JSON.parse(readFileSync(join(dir, 'bridge.lock'), 'utf8')) as { pid: number; port: number; key: string };
		assert.equal(lock.pid, stays.child.pid, 'the lock names the one still running');
		assert.ok(ends.out.text.includes(`:${lock.port}/#key=${lock.key}`), 'pointed at the running one, with its key');
		assert.equal(await answers(lock.port), true);
		if (!samePort) assert.equal(await answers(lock.port === p1 ? p2 : p1), false, 'the other is not listening');
		stays.child.kill('SIGTERM');
		await stays.exited;
		assert.equal(existsSync(join(dir, 'bridge.lock')), false, 'the lock goes when the plant stops');
	}
});

test('a port someone else holds on [::1] stops the start', { ...LIMIT, skip: !existsSync(CLI) && 'run npm run bridge first' }, async (t) => {
	const port = await freePort();
	const squatter = createServer((sock) => sock.end());
	const ok = await new Promise<boolean>((resolve) => { squatter.once('error', () => resolve(false)); squatter.listen(port, '::1', () => resolve(true)); });
	if (!ok) { t.skip('no IPv6 on this computer'); return; }
	try {
		const home = mkdtempSync(join(ROOT, 'home-'));
		mkdirSync(join(home, 'plant'), { mode: 0o700 });
		const s = start(home, join(home, 'plant'), port);
		assert.equal(await s.exited, 1, s.out.text);
		assert.match(s.out.text, new RegExp(`Something else is using port ${port}\\. Start the plant on another port:`));
		assert.doesNotMatch(s.out.text, /#key=/, 'no link is printed');
	} finally { squatter.close(); }
});

test('the skeleton adapter in docs/ADAPTERS.md, run under a loose umask, leaves a folder the plant starts on and a comrade it sees', { ...LIMIT, skip: !existsSync(CLI) && 'run npm run bridge first' }, async () => {
	const doc = readFileSync(join(import.meta.dirname, '..', 'docs', 'ADAPTERS.md'), 'utf8');
	const code = /## A skeleton adapter[\s\S]*?```js\n([\s\S]*?)```/.exec(doc)?.[1];
	assert.ok(code, 'the skeleton is in the doc');
	const home = mkdtempSync(join(ROOT, 'home-'));
	const dir = join(home, 'plant');
	writeFileSync(join(home, 'plant-adapter.mjs'), code);
	// The skeleton never makes the plant's folder (see the hook script's rule): the plant does.
	execFileSync('/bin/sh', ['-c', `"${process.execPath}" plant-adapter.mjs running /work/shop`], { cwd: home, env: { ...process.env, HOME: home, PLANT67_DIR: dir } });
	assert.equal(existsSync(dir), false, 'no folder made by the adapter');
	mkdirSync(dir, { mode: 0o700 });
	execFileSync('/bin/sh', ['-c', `umask 002 && "${process.execPath}" plant-adapter.mjs running /work/shop`], { cwd: home, env: { ...process.env, HOME: home, PLANT67_DIR: dir } });
	const port = await freePort();
	const s = start(home, dir, port);
	await until(() => existsSync(join(dir, 'bridge.lock')) && /running at/.test(s.out.text), () => s.out.text);
	const company = (JSON.parse((await signedGet(dir, '/api/companies')).text) as { id: string }[])[0].id;
	const agents = JSON.parse((await signedGet(dir, `/api/companies/${company}/agents`)).text) as { name: string; title: string }[];
	assert.deepEqual(agents.map((a) => [a.name, a.title]), [['shop', 'My Harness']]);
	s.child.kill('SIGTERM');
	await s.exited;
});

test('a plant that crashed (SIGKILL) leaves a lock the next start takes over', { ...LIMIT, skip: !existsSync(CLI) && 'run npm run bridge first' }, async () => {
	const home = mkdtempSync(join(ROOT, 'home-'));
	const dir = join(home, 'plant');
	const port = await freePort();
	const first = start(home, dir, port);
	await until(() => /running at/.test(first.out.text), () => first.out.text);
	first.child.kill('SIGKILL');
	await first.exited;
	assert.equal(existsSync(join(dir, 'bridge.lock')), true, 'the crash left its lock');
	const again = start(home, dir, port);
	await until(() => /running at/.test(again.out.text), () => again.out.text);
	assert.equal((JSON.parse(readFileSync(join(dir, 'bridge.lock'), 'utf8')) as { pid: number }).pid, again.child.pid);
	again.child.kill('SIGTERM');
	await again.exited;
});

test('a paused plant (Ctrl+Z) is named as this folder\'s plant, and the advice given stops it', { ...LIMIT, skip: !existsSync(CLI) && 'run npm run bridge first' }, async () => {
	const home = mkdtempSync(join(ROOT, 'home-'));
	const dir = join(home, 'plant');
	const port = await freePort();
	const first = start(home, dir, port);
	await until(() => /running at/.test(first.out.text), () => first.out.text);
	first.child.kill('SIGSTOP');
	try {
		for (const p of [port, await freePort()]) {
			const s = start(home, dir, p);
			assert.equal(await s.exited, 1, s.out.text);
			assert.ok(s.out.text.includes(`The plant for this folder is still running as process ${first.child.pid} on port ${port}, but it does not answer. If you pressed Ctrl+Z in its terminal, type fg there, then press Ctrl+C. Or stop it with: kill ${first.child.pid}; kill -CONT ${first.child.pid}`), s.out.text);
			assert.doesNotMatch(s.out.text, /delete/, 'never told to delete the lock while the plant runs');
		}
		// Do what it says: kill, then kill -CONT.
		execFileSync('/bin/sh', ['-c', `kill ${first.child.pid}; kill -CONT ${first.child.pid}`]);
		assert.equal(await first.exited, 0);
		const again = start(home, dir, port);
		await until(() => /running at/.test(again.out.text), () => again.out.text);
		again.child.kill('SIGTERM');
		await again.exited;
	} finally {
		first.child.kill('SIGCONT');
		first.child.kill('SIGKILL');
	}
});

test('a paused plant whose folder another start took stops when it wakes, before answering from its old threads', { ...LIMIT, skip: !existsSync(CLI) && 'run npm run bridge first' }, async () => {
	const home = mkdtempSync(join(ROOT, 'home-'));
	const dir = join(home, 'plant');
	const [p1, p2] = [await freePort(), await freePort()];
	const first = start(home, dir, p1);
	await until(() => /running at/.test(first.out.text), () => first.out.text);
	const firstLock = readFileSync(join(dir, 'bridge.lock'), 'utf8');
	first.child.kill('SIGSTOP');
	try {
		// The owner deletes the lock, as an older message told them to, and starts again.
		rmSync(join(dir, 'bridge.lock'));
		const second = start(home, dir, p2);
		await until(() => /running at/.test(second.out.text), () => second.out.text);
		const secondLock = readFileSync(join(dir, 'bridge.lock'), 'utf8');
		// The paused plant's old tab asks it something, and it wakes.
		const asked = signedGet(dir, '/api/companies', firstLock).catch(() => ({ status: 0, text: '' }));
		first.child.kill('SIGCONT');
		assert.equal((await asked).status, 503, 'it refuses rather than answer from its old copy');
		assert.equal(await first.exited, 1, first.out.text);
		assert.match(first.out.text, /Another plant \(process \d+, port \d+\) took this plant's folder\. This one is stopping/);
		assert.equal(readFileSync(join(dir, 'bridge.lock'), 'utf8'), secondLock, 'the second start keeps the folder');
		second.child.kill('SIGTERM');
		await second.exited;
	} finally {
		first.child.kill('SIGCONT');
		first.child.kill('SIGKILL');
	}
});
