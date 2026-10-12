/**
 * The bridge's web server (src/bridge/server.ts) on a real socket: only its own Host is
 * answered, writes need the plant's Origin and a JSON body, oversize bodies are refused, the
 * plant's files are served with the security headers, and nothing outside them is reachable.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { BODY_MAX, type Listening, hostAllowed, originAllowed, serve } from '../src/bridge/server';
import { BRIDGE_COMPANY_ID } from '../src/bridge/protocol';
import { answerSignature, proofOf, requestSignature } from '../src/bridge/proof';
import { randomBytes } from 'node:crypto';

let server: Listening;
let port = 0;
const KEY = 'a'.repeat(64);
const root = mkdtempSync(join(tmpdir(), 'plant-server-'));
const web = join(root, 'web');

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
 * @param headers Headers (Host defaults to localhost:<port>).
 * @param body Body.
 * @param signWith The key to sign the request with, as the plant's page does, or null to send it unsigned.
 * @returns Status, headers and body text.
 */
function ask(method: string, path: string, headers: Record<string, string> = {}, body?: string, signWith: string | null = KEY): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
	const nonce = randomBytes(16).toString('hex');
	const signed = signWith ? { 'x-plant-nonce': nonce, 'x-plant-auth': requestSignature(signWith, nonce, method, path, body ?? '') } : {};
	return new Promise((resolve, reject) => {
		const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...signed, ...headers } }, (res) => {
			let text = '';
			res.on('data', (c) => { text += c; });
			res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
		});
		req.on('error', (e) => (/ECONNRESET|EPIPE/.test(String(e)) ? resolve({ status: 413, headers: {}, text: '' }) : reject(e)));
		if (body) req.write(body);
		req.end();
	});
}

before(async () => {
	mkdirSync(web, { recursive: true });
	writeFileSync(join(web, 'index.html'), '<!doctype html><title>plant</title>');
	writeFileSync(join(root, 'secret.txt'), 'not for you');
	port = await freePort();
	server = await serve({ dir: join(root, 'plant'), web, port, key: KEY, wiring: () => ({ start: 'x', claude: 'x hooks claude', codex: 'x hooks codex', warnings: [], wired: [] }) });
});
after(() => server.close());

test('the Host rule: only localhost, 127.0.0.1 or [::1] on this port', async () => {
	assert.equal(hostAllowed(`localhost:${port}`, port), true);
	assert.equal(hostAllowed(`[::1]:${port}`, port), true);
	assert.equal(hostAllowed(`evil.example:${port}`, port), false, 'a rebinding page gets nothing');
	assert.equal(hostAllowed(`localhost:${port + 1}`, port), false);
	assert.equal(hostAllowed(undefined, port), false);
	assert.equal(hostAllowed(`p67-0123456789abcdef.localhost:${port}`, port, 'p67-0123456789abcdef'), true, 'the plant\'s own address');
	assert.equal(hostAllowed(`p67-ffffffffffffffff.localhost:${port}`, port, 'p67-0123456789abcdef'), false, 'not another plant\'s');
	assert.equal(hostAllowed(`p67-0123456789abcdef.localhost:${port}`, port), false, 'nor any name, when none is set');
	assert.equal((await ask('GET', '/api/companies', { host: `evil.example:${port}` })).status, 403);
	assert.equal((await ask('GET', '/', { host: `evil.example:${port}` })).status, 403);
	assert.equal((await ask('GET', '/api/companies')).status, 200);
});

test('writes need the plant\'s own Origin and JSON', async () => {
	assert.equal(originAllowed(`http://localhost:${port}`, `localhost:${port}`), true);
	assert.equal(originAllowed('http://evil.example', `localhost:${port}`), false);
	assert.equal(originAllowed('null', `localhost:${port}`), false);
	const path = `/api/companies/${BRIDGE_COMPANY_ID}/issues`;
	const json = { 'content-type': 'application/json' };
	assert.equal((await ask('POST', path, json, '{}')).status, 403, 'no Origin');
	assert.equal((await ask('POST', path, { ...json, origin: 'http://evil.example' }, '{}')).status, 403);
	assert.equal((await ask('POST', path, { 'content-type': 'text/plain', origin: `http://localhost:${port}` }, '{}')).status, 415, 'a plain form post is refused');
	assert.equal((await ask('POST', path, { ...json, origin: `http://localhost:${port}` }, '{nope')).status, 400);
	assert.equal((await ask('POST', path, { ...json, origin: `http://localhost:${port}` }, '{"title":""}')).status, 422, 'through to the bridge');
	assert.equal((await ask('POST', path, { ...json, origin: `http://localhost:${port}` }, `{"t":"${'x'.repeat(BODY_MAX)}"}`)).status, 413);
	assert.equal((await ask('PUT', path, { ...json, origin: `http://localhost:${port}` }, '{}')).status, 405);
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
	assert.equal((await ask('POST', '/', { origin: `http://localhost:${port}` })).status, 405);
});

test('the key never travels: every /api/ request is signed with it, over its method, path and body, once', async () => {
	const page = await ask('GET', '/', {}, undefined, null);
	assert.equal(page.status, 200, 'the page itself holds nothing secret: it takes the key from the link');
	assert.equal(page.headers['set-cookie'], undefined);
	for (const p of ['/api/companies', `/api/companies/${BRIDGE_COMPANY_ID}/agents`, '/api/plant-bridge/wiring', '/api/plant-bridge/prefs']) assert.equal((await ask('GET', p, {}, undefined, null)).status, 401, p);
	assert.equal((await ask('GET', '/api/companies', {}, undefined, 'b'.repeat(64))).status, 401, 'signed with a wrong key');
	assert.equal((await ask('GET', '/api/companies', { 'x-plant-key': KEY }, undefined, null)).status, 401, 'the key itself is no signature');
	assert.equal((await ask('GET', '/api/companies', { cookie: `plant67_${port}=${KEY}` }, undefined, null)).status, 401, 'a cookie is not a key');
	// A signature covers this request only: another path, another body, or the same nonce again is refused.
	const nonce = 'cd'.repeat(16);
	const auth = requestSignature(KEY, nonce, 'GET', '/api/companies', '');
	assert.equal((await ask('GET', '/api/companies', { 'x-plant-nonce': nonce, 'x-plant-auth': auth }, undefined, null)).status, 200);
	assert.equal((await ask('GET', '/api/companies', { 'x-plant-nonce': nonce, 'x-plant-auth': auth }, undefined, null)).status, 401, 'never twice');
	const other = 'ef'.repeat(16);
	assert.equal((await ask('GET', `/api/companies/${BRIDGE_COMPANY_ID}/agents`, { 'x-plant-nonce': other, 'x-plant-auth': requestSignature(KEY, other, 'GET', '/api/companies', '') }, undefined, null)).status, 401, 'not for another path');
	const json = { 'content-type': 'application/json', origin: `http://localhost:${port}` };
	const third = '12'.repeat(16);
	assert.equal((await ask('POST', `/api/companies/${BRIDGE_COMPANY_ID}/issues`, { ...json, 'x-plant-nonce': third, 'x-plant-auth': requestSignature(KEY, third, 'POST', `/api/companies/${BRIDGE_COMPANY_ID}/issues`, '{"title":"a"}') }, '{"title":"b"}', null)).status, 401, 'not for another body');
	assert.equal((await ask('POST', `/api/companies/${BRIDGE_COMPANY_ID}/issues`, json, '{"title":"x"}', null)).status, 401, 'a write with the right headers but no signature');
	assert.match(JSON.parse((await ask('GET', '/api/companies', {}, undefined, null)).text).error, /does not have the plant's current key/);
	const here = await ask('GET', '/api/plant-bridge', {}, undefined, null);
	assert.equal(here.status, 200, 'whether a bridge is here');
	assert.deepEqual(Object.keys(JSON.parse(here.text)).sort(), ['bridge', 'format'], 'nothing more: no folder, nothing to recognise it by');
	const proved = JSON.parse((await ask('GET', '/api/plant-bridge?challenge=0123456789abcdef', {}, undefined, null)).text);
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

test('the page\'s choices are kept in the plant\'s folder, strings only, a few at most', async () => {
	const json = { 'content-type': 'application/json', origin: `http://localhost:${port}` };
	assert.deepEqual(JSON.parse((await ask('GET', '/api/plant-bridge/prefs')).text), {});
	assert.equal((await ask('POST', '/api/plant-bridge/prefs', json, '{"plant67.edge":"1"}')).status, 200);
	assert.deepEqual(JSON.parse((await ask('GET', '/api/plant-bridge/prefs')).text), { 'plant67.edge': '1' });
	assert.equal(statSync(join(root, 'plant', 'prefs.json')).mode & 0o777, 0o600);
	assert.equal((await ask('POST', '/api/plant-bridge/prefs', json, '{"n":1}')).status, 422);
	assert.equal((await ask('POST', '/api/plant-bridge/prefs', json, JSON.stringify({ big: 'x'.repeat(70_000) }))).status, 422);
});

test('the bridge holds [::1] as well as 127.0.0.1, and will not start when [::1] is taken', async (t) => {
	// The plant's own address can lead a browser to either; one left free could be taken by another user.
	const six = await new Promise<number | null>((resolve) => {
		const req = request({ host: '::1', port, path: '/api/plant-bridge', headers: { host: `localhost:${port}` } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
		req.on('error', () => resolve(null));
		req.end();
	});
	if (six === null && !(await new Promise<boolean>((r) => { const s = createServer(); s.once('error', () => r(false)); s.listen(0, '::1', () => s.close(() => r(true))); }))) { t.skip('no IPv6 on this computer'); return; }
	assert.equal(six, 200, 'answers on [::1]');
	const other = await freePort();
	const squatter = createServer((sock) => sock.end());
	await new Promise<void>((r) => squatter.listen(other, '::1', () => r()));
	try {
		await assert.rejects(serve({ dir: join(root, 'plant'), web, port: other, key: KEY }), (err: NodeJS.ErrnoException) => err.code === 'EADDRINUSE');
		// And nothing is left listening on 127.0.0.1 either.
		const four = createServer();
		await new Promise<void>((resolve, reject) => { four.once('error', reject); four.listen(other, '127.0.0.1', () => four.close(() => resolve())); });
	} finally { squatter.close(); }
});

test('every answer to a signed request is signed back, status and all; nothing else is', async () => {
	for (const [path, status] of [['/api/companies', 200], ['/api/plant-bridge', 200], ['/api/nothing-here', 404]] as const) {
		const nonce = randomBytes(16).toString('hex');
		const r = await ask('GET', path, { 'x-plant-nonce': nonce, 'x-plant-auth': requestSignature(KEY, nonce, 'GET', path, '') }, undefined, null);
		assert.equal(r.status, status, path);
		assert.equal(r.headers['x-plant-proof'], answerSignature(KEY, nonce, status), path);
	}
	const unsigned = await ask('GET', '/api/companies', { 'x-plant-nonce': '34'.repeat(16) }, undefined, null);
	assert.equal(unsigned.status, 401);
	assert.equal(unsigned.headers['x-plant-proof'], answerSignature(KEY, '34'.repeat(16), 401), 'even a refusal is signed, so the page knows the plant refused it');
	assert.equal((await ask('GET', '/api/companies', { 'x-plant-nonce': 'not hex' }, undefined, null)).headers['x-plant-proof'], undefined);
});
