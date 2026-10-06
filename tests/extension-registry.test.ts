/**
 * Keeping Chrome's permission, the registered content script and the saved address in step,
 * against a fake Chrome.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect, disconnect, knock, ORIGIN_KEY, requestAccess, savedOrigin, SCRIPT_ID, sync } from '../src/extension/registry';
import { fakeChrome } from './fake-chrome';

const LOCAL = 'http://localhost:3100';
const HOSTED = 'https://paperclip.example.com';

test('connect: ask, save, register on the plant path only', async () => {
	const f = fakeChrome();
	assert.equal(await requestAccess(f.c, LOCAL), true);
	await connect(f.c, LOCAL);
	assert.equal(await savedOrigin(f.c), LOCAL);
	assert.deepEqual([...f.granted], ['http://localhost:3100/*']);
	const s = f.scripts.get(SCRIPT_ID)!;
	assert.deepEqual(s.matches, ['http://localhost:3100/api/plant-67', 'http://localhost:3100/api/plant-67?*']);
	assert.deepEqual(s.js, ['cockpit.js']);
	assert.equal(s.runAt, 'document_idle');
	assert.equal(s.persistAcrossSessions, true);
	// Only the address is stored.
	assert.deepEqual([...f.store.keys()], [ORIGIN_KEY]);
});

test('a refused request changes nothing', async () => {
	const f = fakeChrome({ grant: false });
	assert.equal(await requestAccess(f.c, LOCAL), false);
	assert.equal(await savedOrigin(f.c), null);
	assert.equal(f.scripts.size, 0);
});

test('connecting a new address moves the script and gives back the old permission', async () => {
	const f = fakeChrome();
	await requestAccess(f.c, LOCAL);
	await connect(f.c, LOCAL);
	await requestAccess(f.c, HOSTED);
	await connect(f.c, HOSTED);
	assert.equal(await savedOrigin(f.c), HOSTED);
	assert.deepEqual([...f.granted], ['https://paperclip.example.com/*']);
	assert.deepEqual(f.scripts.get(SCRIPT_ID)!.matches?.[0], 'https://paperclip.example.com/api/plant-67');
	assert.equal(f.scripts.size, 1);
});

test('the same host on another port keeps its permission', async () => {
	const f = fakeChrome();
	await requestAccess(f.c, 'http://localhost');
	await connect(f.c, 'http://localhost');
	await requestAccess(f.c, LOCAL);
	await connect(f.c, LOCAL);
	assert.ok(!f.calls.some((x) => x.startsWith('remove')), f.calls.join('; '));
});

test('connecting the same address twice does not re-register', async () => {
	const f = fakeChrome();
	await requestAccess(f.c, LOCAL);
	await connect(f.c, LOCAL);
	await connect(f.c, LOCAL);
	assert.equal(f.calls.filter((x) => x === 'register').length, 1);
	assert.ok(!f.calls.some((x) => x.startsWith('remove')));
});

test('disconnect unregisters, forgets and gives the permission back', async () => {
	const f = fakeChrome();
	await requestAccess(f.c, LOCAL);
	await connect(f.c, LOCAL);
	await disconnect(f.c);
	assert.equal(await savedOrigin(f.c), null);
	assert.equal(f.scripts.size, 0);
	assert.equal(f.granted.size, 0);
	// Twice is harmless.
	await disconnect(f.c);
});

test('sync re-registers a saved, permitted address (after an update wiped the script)', async () => {
	const f = fakeChrome();
	await requestAccess(f.c, LOCAL);
	await connect(f.c, LOCAL);
	f.scripts.clear();
	assert.equal(await sync(f.c), LOCAL);
	assert.equal(f.scripts.get(SCRIPT_ID)!.matches?.[0], 'http://localhost:3100/api/plant-67');
});

test('sync forgets an address whose permission was taken away in Chrome', async () => {
	const f = fakeChrome();
	await requestAccess(f.c, LOCAL);
	await connect(f.c, LOCAL);
	f.granted.clear();
	assert.equal(await sync(f.c), null);
	assert.equal(f.scripts.size, 0);
	assert.equal(await savedOrigin(f.c), null);
});

test('sync with nothing saved clears a stray registration', async () => {
	const f = fakeChrome();
	f.scripts.set(SCRIPT_ID, { id: SCRIPT_ID, matches: ['https://old.example.com/api/plant-67'] });
	assert.equal(await sync(f.c), null);
	assert.equal(f.scripts.size, 0);
});

test('sync fixes a registration for the wrong address', async () => {
	const f = fakeChrome();
	await requestAccess(f.c, LOCAL);
	await f.c.storage.set({ [ORIGIN_KEY]: LOCAL });
	f.scripts.set(SCRIPT_ID, { id: SCRIPT_ID, matches: ['https://old.example.com/api/plant-67'] });
	await sync(f.c);
	assert.equal(f.scripts.get(SCRIPT_ID)!.matches?.[0], 'http://localhost:3100/api/plant-67');
});

test('a junk saved value counts as nothing', async () => {
	const f = fakeChrome();
	await f.c.storage.set({ [ORIGIN_KEY]: 42 });
	assert.equal(await savedOrigin(f.c), null);
});

test('knock: any reply is an answer, silence is not', async () => {
	let seen: [string, RequestInit | undefined] | null = null;
	const answers: typeof fetch = async (u, i) => { seen = [String(u), i]; return new Response('{}', { status: 404 }); };
	assert.equal(await knock(answers, LOCAL), true);
	assert.equal(seen![0], 'http://localhost:3100/api/plant-67');
	assert.equal(seen![1]?.credentials, 'omit');
	assert.equal(seen![1]?.redirect, 'manual');
	const refused: typeof fetch = async () => { throw new TypeError('Failed to fetch'); };
	assert.equal(await knock(refused, LOCAL), false);
	const hangs: typeof fetch = (_u, i) => new Promise((_res, rej) => i?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
	assert.equal(await knock(hangs, LOCAL, 20), false);
});
