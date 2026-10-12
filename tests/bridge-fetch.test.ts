/**
 * The bridge page's fetch (src/cockpit/bridge-fetch.ts) and the proof it checks
 * (src/bridge/proof.ts): only the plant holding the key is believed, and only it is told anything.
 */
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { proofOf } from '../src/bridge/proof';
import { createBridgeFetch } from '../src/cockpit/bridge-fetch';

const KEY = 'k'.repeat(64);

test('the proof is HMAC-SHA256, the same as Node\'s, for keys and challenges of every length', () => {
	for (let n = 0; n < 200; n++) {
		const key = randomBytes(n % 90).toString('hex'), ch = `${randomBytes(n % 70).toString('hex')}é`;
		assert.equal(proofOf(key, ch), createHmac('sha256', key).update(`plant-67:${ch}`).digest('hex'));
	}
});

/** One request the fake fetch saw. */
interface Seen { url: string; method: string; headers: Headers; body: unknown }

/**
 * A fake fetch answering as a bridge holding a key (or as an impostor).
 *
 * @param answer How to answer each request: the key to prove with (null for none), a status, or a failure.
 * @returns The fetch and what it saw.
 */
function fake(answer: (s: Seen) => { proveWith: string | null; status?: number; body?: string } | 'fail') {
	const seen: Seen[] = [];
	const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const s = { url: String(url), method: (init?.method ?? 'GET').toUpperCase(), headers: new Headers(init?.headers), body: init?.body };
		seen.push(s);
		const a = answer(s);
		if (a === 'fail') throw new TypeError('Failed to fetch');
		const nonce = s.headers.get('x-plant-nonce');
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (a.proveWith && nonce) headers['x-plant-proof'] = proofOf(a.proveWith, nonce);
		return new Response(a.body ?? '{}', { status: a.status ?? 200, headers });
	};
	return { f: f as typeof fetch, seen };
}

test('the plant\'s answers are believed: each request carries the key and a fresh challenge', async () => {
	const { f, seen } = fake(() => ({ proveWith: KEY }));
	const b = createBridgeFetch(KEY, f);
	assert.equal((await b.fetchImpl('/api/companies')).status, 200);
	await b.fetchImpl('/api/companies');
	assert.equal(seen[0].headers.get('x-plant-key'), KEY);
	assert.match(seen[0].headers.get('x-plant-nonce') ?? '', /^[0-9a-f]{32}$/);
	assert.notEqual(seen[0].headers.get('x-plant-nonce'), seen[1].headers.get('x-plant-nonce'));
	assert.equal(b.line(), 'live');
});

test('an answer without the proof (a program that took the port) ends the line, and nothing more is sent', async () => {
	const { f, seen } = fake(() => ({ proveWith: null }));
	const b = createBridgeFetch(KEY, f);
	await assert.rejects(b.fetchImpl('/api/companies'), TypeError);
	assert.equal(b.line(), 'gone');
	await assert.rejects(b.fetchImpl('/api/companies'), TypeError);
	assert.equal(seen.length, 1, 'never asked again');
	const wrong = createBridgeFetch(KEY, fake(() => ({ proveWith: 'another key' })).f);
	await assert.rejects(wrong.fetchImpl('/api/companies'), TypeError, 'a proof with another key is no proof');
});

test('the owner\'s words go only to a proven plant: an impostor gets the check, never the directive', async () => {
	const { f, seen } = fake(() => ({ proveWith: null }));
	const b = createBridgeFetch(KEY, f);
	await assert.rejects(b.fetchImpl('/api/companies/c/issues', { method: 'POST', body: '{"title":"Secret plans"}' }), TypeError);
	assert.equal(seen.length, 1);
	assert.equal(seen[0].url, '/api/plant-bridge', 'only the keyless check was sent');
	assert.equal(seen[0].headers.get('x-plant-key'), null);
	assert.equal(seen[0].body, undefined);
	const real = fake(() => ({ proveWith: KEY }));
	const ok = createBridgeFetch(KEY, real.f);
	assert.equal((await ok.fetchImpl('/api/companies/c/issues', { method: 'POST', body: '{"title":"Go"}' })).status, 200);
	assert.deepEqual(real.seen.map((s) => [s.method, s.url]), [['GET', '/api/plant-bridge'], ['POST', '/api/companies/c/issues']]);
});

test('a 401 (the plant started again) stays refused, so the page keeps saying the tab is out of date', async () => {
	const { f, seen } = fake(() => ({ proveWith: 'the new key', status: 401, body: '{"error":"old key"}' }));
	const b = createBridgeFetch(KEY, f);
	assert.equal((await b.fetchImpl('/api/companies')).status, 401);
	assert.equal(b.line(), 'refused');
	const again = await b.fetchImpl('/api/companies');
	assert.equal(again.status, 401);
	assert.equal(await again.text(), '{"error":"old key"}');
	assert.equal(seen.length, 1, 'never asked again');
});

test('a request that fails outright (a blip) ends nothing: the next proven answer is believed', async () => {
	let n = 0;
	const { f } = fake(() => (n++ === 0 ? 'fail' : { proveWith: KEY }));
	const b = createBridgeFetch(KEY, f);
	await assert.rejects(b.fetchImpl('/api/companies'), TypeError);
	assert.equal(b.line(), 'live');
	assert.equal((await b.fetchImpl('/api/companies')).status, 200);
});
