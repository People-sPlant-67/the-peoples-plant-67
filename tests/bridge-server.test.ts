/**
 * The bridge's web server (src/bridge/server.ts) on a real socket: the plant is served at its
 * own address only, every /api/ request is signed and every answer to one is signed back, writes
 * need the plant's Origin and a JSON body, oversize bodies are refused, the plant's files are
 * served with the security headers, nothing outside them is reachable, and the page's choices are
 * merged into the plant's folder.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { BODY_MAX, type Listening, hostKind, originAllowed, serve } from '../src/bridge/server';
import { BRIDGE_COMPANY_ID } from '../src/bridge/protocol';
import { answerSignature, proofOf, requestSignature } from '../src/bridge/proof';

let server: Listening;
let port = 0;
const KEY = 'a'.repeat(64);
const NAME = 'p67-0123456789abcdef';
const root = mkdtempSync(join(tmpdir(), 'plant-server-'));
const web = join(root, 'web');
let own = '';

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
 * One request to the bridge.
 *
 * @param method Method.
 * @param path Path (sent as is).
 * @param headers Headers (Host defaults to the plant's own address).
 * @param body Body.
 * @param signWith The key to sign the request with, as the plant's page does, or null to send it unsigned.
 * @returns Status, headers, body text, and whether the answer carries a good signature for the nonce sent.
 */
function ask(method: string, path: string, headers: Record<string, string> = {}, body?: string, signWith: string | null = KEY): Promise<{ status: number; headers: Record<string, unknown>; text: string; proven: boolean }> {
	const nonce = randomBytes(16).toString('hex'), time = Date.now();
	const signed = signWith ? { 'x-plant-nonce': nonce, 'x-plant-time': String(time), 'x-plant-auth': requestSignature(signWith, nonce, time, method, path, body ?? '') } : {};
	return new Promise((resolve, reject) => {
		const req = request({ host: '127.0.0.1', port, method, path, headers: { host: own, ...(method === 'POST' ? { origin: `http://${own}`, 'content-type': 'application/json' } : {}), ...signed, ...headers } }, (res) => {
			const parts: Buffer[] = [];
			res.on('data', (c: Buffer) => parts.push(c));
			res.on('end', () => {
				const text = Buffer.concat(parts).toString('utf8');
				resolve({ status: res.statusCode ?? 0, headers: res.headers, text, proven: res.headers['x-plant-proof'] === answerSignature(KEY, nonce, res.statusCode ?? 0, text) });
			});
		});
		req.on('error', (e) => (/ECONNRESET|EPIPE/.test(String(e)) ? resolve({ status: 413, headers: {}, text: '', proven: false }) : reject(e)));
		if (body) req.write(body);
		req.end();
	});
}

before(async () => {
	mkdirSync(web, { recursive: true });
	writeFileSync(join(web, 'index.html'), '<!doctype html><title>plant</title>');
	writeFileSync(join(root, 'secret.txt'), 'not for you');
	port = await freePort();
	own = `${NAME}.localhost:${port}`;
	server = await serve({ dir: join(root, 'plant'), web, port, key: KEY, name: NAME, wiring: () => ({ start: 'x', claude: 'x hooks claude', codex: 'x hooks codex', warnings: [], wired: [] }) });
});
after(() => server.close());

test('the plant is served at its own address only; a bare address answers a probe, and says where the plant is', async () => {
	assert.equal(hostKind(own, port, NAME), 'own');
	for (const h of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) assert.equal(hostKind(h, port, NAME), 'bare', h);
	assert.equal(hostKind(`p67-ffffffffffffffff.localhost:${port}`, port, NAME), 'old', 'an earlier start\'s address');
	assert.equal(hostKind(`evil.example:${port}`, port, NAME), null, 'a rebinding page gets nothing');
	assert.equal(hostKind(`${NAME}.localhost:${port + 1}`, port, NAME), null);
	assert.equal(hostKind(undefined, port, NAME), null);
	assert.equal((await ask('GET', '/api/companies', { host: `evil.example:${port}` })).status, 403);
	assert.equal((await ask('GET', '/', { host: `evil.example:${port}` })).status, 403);
	assert.equal((await ask('GET', '/api/companies')).status, 200);
	// A bare address: the probe another start makes, and nothing of the plant's own.
	const bare = await ask('GET', '/', { host: `localhost:${port}` }, undefined, null);
	assert.match(bare.text, /does not open at this address/);
	assert.doesNotMatch(bare.text, /<script/);
	assert.equal((await ask('GET', '/api/companies', { host: `127.0.0.1:${port}` })).status, 403, 'a signed request is refused there too');
	assert.match((await ask('GET', '/api/plant-bridge?challenge=0123456789abcdef', { host: `localhost:${port}` }, undefined, null)).text, /"proof"/);
	// An earlier start's address: the reloaded tab is told to use the newest link.
	const old = await ask('GET', '/', { host: `p67-ffffffffffffffff.localhost:${port}` }, undefined, null);
	assert.match(String(old.headers['content-type']), /text\/html/);
	assert.match(old.text, /This is an old address of the plant\. The plant's address changes each time it starts\./);
	assert.equal(old.headers['clear-site-data'], '"cache", "storage"', 'what another program left there is wiped');
	assert.equal(bare.headers['clear-site-data'], '"cache", "storage"');
	// A service worker another program put at a bare or old address removes itself.
	for (const host of [`localhost:${port}`, `p67-ffffffffffffffff.localhost:${port}`]) assert.match((await ask('GET', '/sw.js', { host, 'service-worker': 'script' }, undefined, null)).text, /registration\.unregister\(\)/, host);
});

test('writes need the plant\'s own Origin and JSON', async () => {
	assert.equal(originAllowed(`http://${own}`, own), true);
	assert.equal(originAllowed('http://evil.example', own), false);
	assert.equal(originAllowed('null', own), false);
	const path = `/api/companies/${BRIDGE_COMPANY_ID}/issues`;
	assert.equal((await ask('POST', path, { origin: '' }, '{}')).status, 403, 'no Origin');
	assert.equal((await ask('POST', path, { origin: 'http://evil.example' }, '{}')).status, 403);
	assert.equal((await ask('POST', path, { 'content-type': 'text/plain' }, '{}')).status, 415, 'a plain form post is refused');
	assert.equal((await ask('POST', path, {}, '{nope')).status, 400);
	assert.equal((await ask('POST', path, {}, '{"title":""}')).status, 422, 'through to the bridge');
	assert.equal((await ask('POST', path, {}, `{"t":"${'x'.repeat(BODY_MAX)}"}`)).status, 413);
	assert.equal((await ask('PUT', path, { origin: `http://${own}`, 'content-type': 'application/json' }, '{}')).status, 405);
});

test('the plant\'s files, with the security headers, and nothing outside them', async () => {
	const page = await ask('GET', '/');
	assert.equal(page.status, 200);
	assert.match(String(page.headers['content-type']), /text\/html/);
	assert.match(String(page.headers['content-security-policy']), /default-src 'self'.*connect-src 'self'/);
	assert.equal(page.headers['x-frame-options'], 'DENY');
	for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/web/../../secret.txt', '/%00']) {
		const r = await ask('GET', p);
		assert.notEqual(r.status, 200, p);
		assert.doesNotMatch(r.text, /not for you/, p);
	}
	assert.equal((await ask('GET', '/missing.js')).status, 404);
	assert.equal((await ask('POST', '/', { 'content-type': '' })).status, 405);
});

test('the key never travels: every /api/ request is signed with it, over its nonce, time, method, path and body, once', async () => {
	const page = await ask('GET', '/', {}, undefined, null);
	assert.equal(page.status, 200, 'the page itself holds nothing secret: it takes the key from the link');
	assert.equal(page.headers['set-cookie'], undefined);
	for (const p of ['/api/companies', `/api/companies/${BRIDGE_COMPANY_ID}/agents`, '/api/plant-bridge/wiring', '/api/plant-bridge/prefs']) assert.equal((await ask('GET', p, {}, undefined, null)).status, 401, p);
	assert.equal((await ask('GET', '/api/companies', {}, undefined, 'b'.repeat(64))).status, 401, 'signed with a wrong key');
	assert.equal((await ask('GET', '/api/companies', { 'x-plant-key': KEY }, undefined, null)).status, 401, 'the key itself is no signature');
	assert.equal((await ask('GET', '/api/companies', { cookie: `plant67_${port}=${KEY}` }, undefined, null)).status, 401, 'a cookie is not a key');
	// A signature covers this request only.
	const at = Date.now();
	const by = (nonce: string, time: number, method: string, path: string, body = '') => ({ 'x-plant-nonce': nonce, 'x-plant-time': String(time), 'x-plant-auth': requestSignature(KEY, nonce, time, method, path, body) });
	const n1 = 'cd'.repeat(16);
	assert.equal((await ask('GET', '/api/companies', by(n1, at, 'GET', '/api/companies'), undefined, null)).status, 200);
	assert.equal((await ask('GET', '/api/companies', by(n1, at, 'GET', '/api/companies'), undefined, null)).status, 401, 'never twice');
	assert.equal((await ask('GET', `/api/companies/${BRIDGE_COMPANY_ID}/agents`, by('ef'.repeat(16), at, 'GET', '/api/companies'), undefined, null)).status, 401, 'not for another path');
	const issues = `/api/companies/${BRIDGE_COMPANY_ID}/issues`;
	assert.equal((await ask('POST', issues, by('12'.repeat(16), at, 'POST', issues, '{"title":"a"}'), '{"title":"b"}', null)).status, 401, 'not for another body');
	const stale = at - 10 * 60_000;
	assert.equal((await ask('GET', '/api/companies', by('34'.repeat(16), stale, 'GET', '/api/companies'), undefined, null)).status, 401, 'not once it is old: a request seen once is soon worthless');
	assert.equal((await ask('POST', issues, {}, '{"title":"x"}', null)).status, 401, 'a write with the right headers but no signature');
	assert.match(JSON.parse((await ask('GET', '/api/companies', {}, undefined, null)).text).error, /does not have the plant's current key/);
	const here = await ask('GET', '/api/plant-bridge', {}, undefined, null);
	assert.equal(here.status, 200, 'whether a bridge is here');
	assert.deepEqual(Object.keys(JSON.parse(here.text)).sort(), ['bridge', 'format'], 'nothing more: no folder, nothing to recognise it by');
	const proved = JSON.parse((await ask('GET', '/api/plant-bridge?challenge=0123456789abcdef', { host: `localhost:${port}` }, undefined, null)).text);
	assert.equal(proved.proof, proofOf(KEY, '0123456789abcdef'), 'it proves it holds the key, without giving it');
	assert.ok(!JSON.stringify(proved).includes(KEY));
	assert.deepEqual(JSON.parse((await ask('GET', '/api/plant-bridge/wiring')).text), { start: 'x', claude: 'x hooks claude', codex: 'x hooks codex', warnings: [], wired: [] });
	// A page elsewhere must ask the browser first before sending the headers; the answer is never yes.
	const pre = await ask('OPTIONS', '/api/companies', { origin: 'http://evil.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-plant-auth' }, undefined, null);
	assert.ok(pre.status >= 400, `refused (${pre.status})`);
	assert.equal(pre.headers['access-control-allow-origin'], undefined);
	assert.equal(pre.headers['access-control-allow-headers'], undefined);
	const sw = await ask('GET', '/sw.js', { 'service-worker': 'script' }, undefined, null);
	assert.match(sw.text, /registration\.unregister\(\)/, 'a service worker someone else put here removes itself at its next update check');
});

test('only an answer to a verified request is signed, status and body; nothing else is', async () => {
	for (const [path, status] of [['/api/companies', 200], ['/api/plant-bridge', 200], ['/api/nothing-here', 404]] as const) {
		const r = await ask('GET', path);
		assert.equal(r.status, status, path);
		assert.ok(r.proven, path);
	}
	const nonce = '56'.repeat(16);
	const unsigned = await ask('GET', '/api/plant-bridge', { 'x-plant-nonce': nonce }, undefined, null);
	assert.equal(unsigned.headers['x-plant-proof'], undefined, 'no signature for a nonce anyone picked');
	assert.equal((await ask('GET', '/api/companies', {}, undefined, 'b'.repeat(64))).headers['x-plant-proof'], undefined, 'nor for a refused request');
	assert.equal((await ask('GET', '/', { 'x-plant-nonce': nonce }, undefined, null)).headers['x-plant-proof'], undefined, 'nor for a file');
});

test('the page\'s choices are merged into the plant\'s folder, names and words only, a few at most', async () => {
	assert.deepEqual(JSON.parse((await ask('GET', '/api/plant-bridge/prefs')).text), {});
	assert.deepEqual(JSON.parse((await ask('POST', '/api/plant-bridge/prefs', {}, '{"set":{"plant67.edge":"1"}}')).text), { 'plant67.edge': '1' });
	// Another tab changes another choice: both stay.
	assert.deepEqual(JSON.parse((await ask('POST', '/api/plant-bridge/prefs', {}, '{"set":{"plant67.me":"Sasha"}}')).text), { 'plant67.edge': '1', 'plant67.me': 'Sasha' });
	assert.deepEqual(JSON.parse((await ask('POST', '/api/plant-bridge/prefs', {}, '{"remove":["plant67.edge"]}')).text), { 'plant67.me': 'Sasha' });
	assert.equal(statSync(join(root, 'plant', 'prefs.json')).mode & 0o777, 0o600);
	for (const bad of ['{"set":{"n":1}}', '["x"]', 'null', '"x"', '{"other":1}', '{"remove":[1]}']) assert.equal((await ask('POST', '/api/plant-bridge/prefs', {}, bad)).status, 422, bad);
	assert.equal((await ask('POST', '/api/plant-bridge/prefs', {}, JSON.stringify({ set: { big: 'é'.repeat(31_000) } }))).status, 422, 'counted in bytes');
	assert.deepEqual(JSON.parse((await ask('GET', '/api/plant-bridge/prefs')).text), { 'plant67.me': 'Sasha' }, 'nothing refused was kept');
	// A prefs.json broken by hand is never written over: the page is told, and keeps nothing new.
	writeFileSync(join(root, 'plant', 'prefs.json'), '{ broken');
	assert.equal((await ask('GET', '/api/plant-bridge/prefs')).status, 500);
	const refused = await ask('POST', '/api/plant-bridge/prefs', {}, '{"set":{"x":"1"}}');
	assert.equal(refused.status, 500);
	assert.match(JSON.parse(refused.text).error, /could not read prefs\.json in its folder, so it keeps no new choices\. Fix that file or delete it/);
	assert.equal(readFileSync(join(root, 'plant', 'prefs.json'), 'utf8'), '{ broken');
	rmSync(join(root, 'plant', 'prefs.json'));
});

test('the bridge holds [::1] as well as 127.0.0.1, and will not start when [::1] is taken', async (t) => {
	// The plant's own address can lead a browser to either; one left free could be taken by another user.
	const six = await new Promise<number | null>((resolve) => {
		const req = request({ host: '::1', port, path: '/api/plant-bridge', headers: { host: own } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
		req.on('error', () => resolve(null));
		req.end();
	});
	if (six === null && !(await new Promise<boolean>((r) => { const s = createServer(); s.once('error', () => r(false)); s.listen(0, '::1', () => s.close(() => r(true))); }))) { t.skip('no IPv6 on this computer'); return; }
	assert.equal(six, 200, 'answers on [::1]');
	const other = await freePort();
	const squatter = createServer((sock) => sock.end());
	await new Promise<void>((r) => squatter.listen(other, '::1', () => r()));
	try {
		await assert.rejects(serve({ dir: join(root, 'plant'), web, port: other, key: KEY, name: NAME }), (err: NodeJS.ErrnoException) => err.code === 'EADDRINUSE');
		// And nothing is left listening on 127.0.0.1 either.
		const four = createServer();
		await new Promise<void>((resolve, reject) => { four.once('error', reject); four.listen(other, '127.0.0.1', () => four.close(() => resolve())); });
	} finally { squatter.close(); }
});

test('scripts/plant-api.mjs signs as the page does: a GET and a POST go through, and a wrong folder is refused', async () => {
	const dir = join(root, 'plant');
	writeFileSync(join(dir, 'bridge.lock'), JSON.stringify({ pid: process.pid, port, name: NAME, key: KEY }));
	const script = join(import.meta.dirname, '..', 'scripts', 'plant-api.mjs');
	const run = (...args: string[]) => new Promise<{ code: number | null; out: string }>((resolve) => {
		execFile(process.execPath, [script, ...args], (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}${stderr}` }));
	});
	const companies = await run(dir, 'get', '/api/companies');
	assert.equal(companies.code, 0, companies.out);
	assert.equal(JSON.parse(companies.out)[0].id, BRIDGE_COMPANY_ID);
	const saved = await run(dir, 'POST', '/api/plant-bridge/prefs', '{"set":{"via.script":"yes"}}');
	assert.equal(saved.code, 0, saved.out);
	assert.equal(JSON.parse(saved.out)['via.script'], 'yes');
	writeFileSync(join(dir, 'bridge.lock'), JSON.stringify({ pid: process.pid, port, name: NAME, key: 'c'.repeat(64) }));
	const refused = await run(dir, 'GET', '/api/companies');
	assert.notEqual(refused.code, 0);
	assert.match(refused.out, /The plant refused the signature\. Is .* the folder of the plant running now\?/);
});
