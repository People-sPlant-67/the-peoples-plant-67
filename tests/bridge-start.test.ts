/**
 * The built npx command (dist-bridge/cli.mjs, made by npm install or npm run bridge), started
 * for real: two starts at once on one folder end with one bridge, a port someone else holds
 * on [::1] stops the start, and the skeleton adapter in the docs works with it. Each start gets a scratch home, so nothing touches ~/.plant-67.
 */
import assert from 'node:assert/strict';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const CLI = join(import.meta.dirname, '..', 'dist-bridge', 'cli.mjs');
/** Scratch homes go under the real home folder: the plant rightly refuses shared ones such as /tmp. */
const ROOT = realpathSync(mkdtempSync(join(homedir(), '.plant-tests-')));
const running: ChildProcess[] = [];
after(() => {
	for (const c of running) c.kill('SIGTERM');
	rmSync(ROOT, { recursive: true, force: true });
});

/**
 * A free port, from the system.
 *
 * @returns Port.
 */
const freePort = (): Promise<number> => new Promise((resolve) => {
	const s = createServer();
	s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); });
});

/**
 * Start the plant.
 *
 * @param home Scratch home.
 * @param dir The plant's folder.
 * @param port Port.
 * @returns The process, its output so far, and a promise of its exit code (null while it runs).
 */
function start(home: string, dir: string, port: number) {
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
 * @param ms How long to wait.
 */
async function until(ok: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await ok()) return;
	assert.fail('timed out');
}

test('two starts at once on one folder end with one bridge, and the other points at it', { skip: !existsSync(CLI) && 'run npm run bridge first' }, async () => {
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
		await until(() => existsSync(join(dir, 'bridge.lock')));
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

test('a port someone else holds on [::1] stops the start', { skip: !existsSync(CLI) && 'run npm run bridge first' }, async (t) => {
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

test('the skeleton adapter in docs/ADAPTERS.md, run under a loose umask, leaves a folder the plant starts on and a comrade it sees', { skip: !existsSync(CLI) && 'run npm run bridge first' }, async () => {
	const doc = readFileSync(join(import.meta.dirname, '..', 'docs', 'ADAPTERS.md'), 'utf8');
	const code = /## A skeleton adapter[\s\S]*?```js\n([\s\S]*?)```/.exec(doc)?.[1];
	assert.ok(code, 'the skeleton is in the doc');
	const home = mkdtempSync(join(ROOT, 'home-'));
	const dir = join(home, 'plant');
	writeFileSync(join(home, 'plant-adapter.mjs'), code);
	execFileSync('/bin/sh', ['-c', `umask 002 && "${process.execPath}" plant-adapter.mjs running /work/shop`], { cwd: home, env: { ...process.env, HOME: home, PLANT67_DIR: dir } });
	const port = await freePort();
	const s = start(home, dir, port);
	await until(() => existsSync(join(dir, 'bridge.lock')) && /running at/.test(s.out.text));
	const { key } = JSON.parse(readFileSync(join(dir, 'bridge.lock'), 'utf8')) as { key: string };
	const get = (path: string): Promise<string> => new Promise((resolve, reject) => {
		request({ host: '127.0.0.1', port, path, headers: { host: `localhost:${port}`, 'x-plant-key': key } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(t)); }).on('error', reject).end();
	});
	const company = (JSON.parse(await get('/api/companies')) as { id: string }[])[0].id;
	const agents = JSON.parse(await get(`/api/companies/${company}/agents`)) as { name: string; title: string }[];
	assert.deepEqual(agents.map((a) => [a.name, a.title]), [['shop', 'My Harness']]);
	s.child.kill('SIGTERM');
	await s.exited;
});
