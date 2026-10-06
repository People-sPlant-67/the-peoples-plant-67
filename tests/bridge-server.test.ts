/**
 * The bridge's web server (src/bridge/server.ts) on a real socket: only its own Host is
 * answered, writes need the plant's Origin and a JSON body, oversize bodies are refused, the
 * plant's files are served with the security headers, and nothing outside them is reachable.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { BODY_MAX, hostAllowed, originAllowed, serve } from '../src/bridge/server';
import { BRIDGE_COMPANY_ID } from '../src/bridge/protocol';

let server: Server;
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
 * @returns Status, headers and body text.
 */
function ask(method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
	return new Promise((resolve, reject) => {
		const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, cookie: `plant67_${port}=${KEY}`, ...headers } }, (res) => {
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
	server = await serve({ dir: join(root, 'plant'), web, port, key: KEY, wiring: () => ({ claude: 'x hooks claude', codex: 'x hooks codex', warnings: [] }) });
});
after(() => { server.close(); });

test('the Host rule: only localhost, 127.0.0.1 or [::1] on this port', async () => {
	assert.equal(hostAllowed(`localhost:${port}`, port), true);
	assert.equal(hostAllowed(`[::1]:${port}`, port), true);
	assert.equal(hostAllowed(`evil.example:${port}`, port), false, 'a rebinding page gets nothing');
	assert.equal(hostAllowed(`localhost:${port + 1}`, port), false);
	assert.equal(hostAllowed(undefined, port), false);
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

test('the key: the link sets it as a strict cookie, and nothing of the plant answers without it', async () => {
	const link = await ask('GET', `/?key=${KEY}`, { cookie: '' });
	assert.equal(link.status, 303);
	assert.equal(link.headers.location, '/', 'the key leaves the address bar');
	assert.match(String(link.headers['set-cookie']), new RegExp(`^plant67_${port}=${KEY}; HttpOnly; SameSite=Strict; Path=/$`));
	const wrong = await ask('GET', `/?key=${'b'.repeat(64)}`, { cookie: '' });
	assert.equal(wrong.status, 403);
	assert.equal(wrong.headers['set-cookie'], undefined);
	const locked = await ask('GET', '/', { cookie: '' });
	assert.equal(locked.status, 200);
	assert.match(locked.text, /opens from the link in the terminal where you started it/);
	assert.doesNotMatch(locked.text, /<script/);
	for (const p of ['/api/companies', `/api/companies/${BRIDGE_COMPANY_ID}/agents`, '/api/plant-bridge/wiring']) assert.equal((await ask('GET', p, { cookie: '' })).status, 401, p);
	assert.equal((await ask('GET', '/api/companies', { cookie: `plant67_${port}=${'b'.repeat(64)}` })).status, 401, 'a wrong key');
	assert.equal((await ask('GET', '/api/companies', { cookie: `plant67_${port + 1}=${KEY}` })).status, 401, 'another port\'s cookie');
	const json = { 'content-type': 'application/json', origin: `http://localhost:${port}` };
	assert.equal((await ask('POST', `/api/companies/${BRIDGE_COMPANY_ID}/issues`, { ...json, cookie: '' }, '{"title":"x"}')).status, 401, 'a write with the right headers but no key');
	const here = await ask('GET', '/api/plant-bridge', { cookie: '' });
	assert.equal(here.status, 200, 'whether a bridge is here, for a second npx command');
	assert.deepEqual(Object.keys(JSON.parse(here.text)).sort(), ['bridge', 'folder', 'format']);
	assert.deepEqual(JSON.parse((await ask('GET', '/api/plant-bridge/wiring')).text), { claude: 'x hooks claude', codex: 'x hooks codex', warnings: [] });
});
