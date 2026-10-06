/**
 * Keeping Chrome's permission, the registered content script and the saved address in step,
 * against a fake Chrome that follows Chrome's permission coverage rule.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect, disconnect, knock, likelyMoves, ORIGIN_KEY, requestAccess, savedOrigin, SCRIPT_ID, sync } from '../src/extension/registry';
import { fakeChrome } from './fake-chrome';

const LOCAL = 'http://localhost:3100';
const HOSTED = 'https://paperclip.example.com';

/**
 * Ask and connect, as the options page does.
 *
 * @param f The fake.
 * @param origin Origin.
 */
async function hook(f: ReturnType<typeof fakeChrome>, origin: string): Promise<void> {
	assert.equal(await requestAccess(f.c, origin), true);
	await connect(f.c, origin);
}

test('connect: ask for the host, save, register on the plant path of the exact origin', async () => {
	const f = fakeChrome();
	await hook(f, LOCAL);
	assert.equal(f.calls[0], 'request http://localhost/*');
	assert.equal(await savedOrigin(f.c), LOCAL);
	assert.deepEqual([...f.granted], ['http://localhost/*']);
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
	assert.equal(f.granted.size, 0);
});

test('a new host moves the script and gives back the old permission', async () => {
	const f = fakeChrome();
	await hook(f, LOCAL);
	await hook(f, HOSTED);
	assert.equal(await savedOrigin(f.c), HOSTED);
	assert.deepEqual([...f.granted], ['https://paperclip.example.com/*']);
	assert.equal(f.scripts.get(SCRIPT_ID)!.matches?.[0], 'https://paperclip.example.com/api/plant-67');
	assert.equal(f.scripts.size, 1);
});

test('a port change on the same host reuses the grant, and disconnect then leaves nothing behind', async () => {
	const f = fakeChrome();
	await hook(f, 'http://localhost:3000');
	await hook(f, LOCAL);
	assert.deepEqual([...f.granted], ['http://localhost/*']);
	assert.ok(!f.calls.some((x) => x.startsWith('remove')), f.calls.join('; '));
	assert.equal(f.scripts.get(SCRIPT_ID)!.matches?.[0], 'http://localhost:3100/api/plant-67');
	await disconnect(f.c);
	assert.equal(f.granted.size, 0, 'every grant the plant asked for is given back');
	assert.equal(await f.c.permissions.contains({ origins: ['http://localhost:3000/*'] }), false);
});

test('the same host by http and https are two grants, and the old one is given back', async () => {
	const f = fakeChrome();
	await hook(f, 'http://paperclip.example.com');
	await hook(f, HOSTED);
	assert.deepEqual([...f.granted], ['https://paperclip.example.com/*']);
});

test('connecting the same address twice does not re-register or give anything back', async () => {
	const f = fakeChrome();
	await hook(f, LOCAL);
	await hook(f, LOCAL);
	assert.equal(f.calls.filter((x) => x === 'register').length, 1);
	assert.ok(!f.calls.some((x) => x.startsWith('remove')));
});

test('a registration that fails keeps the old address, registered, and gives the new permission back', async () => {
	const f = fakeChrome();
	await hook(f, LOCAL);
	f.failNextRegister(new Error('Chrome said no'));
	assert.equal(await requestAccess(f.c, HOSTED), true);
	await assert.rejects(connect(f.c, HOSTED), /Chrome said no/);
	assert.equal(await savedOrigin(f.c), LOCAL);
	assert.deepEqual([...f.granted], ['http://localhost/*']);
	assert.equal(f.scripts.get(SCRIPT_ID)!.matches?.[0], 'http://localhost:3100/api/plant-67', 'the old address still has the plant');
});

test('a registration that fails on the same host keeps the shared grant and the old registration', async () => {
	const f = fakeChrome();
	await hook(f, 'http://localhost:3000');
	f.failNextRegister(new Error('Chrome said no'));
	await assert.rejects(connect(f.c, LOCAL));
	assert.deepEqual([...f.granted], ['http://localhost/*']);
	assert.equal(f.scripts.get(SCRIPT_ID)!.matches?.[0], 'http://localhost:3000/api/plant-67');
});

test('a failed first connect gives the new grant back', async () => {
	const f = fakeChrome();
	f.failNextRegister(new Error('Chrome said no'));
	assert.equal(await requestAccess(f.c, LOCAL), true);
	await assert.rejects(connect(f.c, LOCAL));
	assert.equal(f.granted.size, 0);
	assert.equal(await savedOrigin(f.c), null);
});

test('two syncs at once take turns and agree', async () => {
	const f = fakeChrome({ slow: true });
	await f.c.permissions.request({ origins: ['http://localhost/*'] });
	await f.c.storage.set({ [ORIGIN_KEY]: LOCAL });
	const [a, b] = await Promise.all([sync(f.c), sync(f.c)]);
	assert.equal(a, LOCAL);
	assert.equal(b, LOCAL);
	assert.equal(f.calls.filter((x) => x === 'register').length, 1);
});

test('grants left over from an interrupted connect are given back on the next connect and on disconnect', async () => {
	const f = fakeChrome();
	// A tab closed between Chrome's prompt and its connect left this behind.
	await f.c.permissions.request({ origins: ['https://stray.example.com/*'] });
	await hook(f, LOCAL);
	assert.deepEqual([...f.granted], ['http://localhost/*']);
	await f.c.permissions.request({ origins: ['https://stray.example.com/*'] });
	await disconnect(f.c);
	assert.equal(f.granted.size, 0);
});

test('a wider grant someone chose in Chrome is never taken away', async () => {
	const f = fakeChrome();
	f.granted.add('*://*/*');
	f.granted.add('https://*/*');
	await hook(f, LOCAL);
	await disconnect(f.c);
	assert.deepEqual([...f.granted].sort(), ['*://*/*', 'https://*/*']);
});

test('disconnect unregisters, forgets and gives the permission back; twice is harmless', async () => {
	const f = fakeChrome();
	await hook(f, LOCAL);
	await disconnect(f.c);
	assert.equal(await savedOrigin(f.c), null);
	assert.equal(f.scripts.size, 0);
	assert.equal(f.granted.size, 0);
	await disconnect(f.c);
});

test('disconnect survives a grant Chrome will not take back (one the manifest requires)', async () => {
	const f = fakeChrome({ required: ['http://localhost/*'] });
	await hook(f, LOCAL);
	await disconnect(f.c);
	assert.equal(await savedOrigin(f.c), null);
	assert.equal(f.scripts.size, 0);
});

test('sync re-registers a saved, permitted address (after an update wiped the script)', async () => {
	const f = fakeChrome();
	await hook(f, LOCAL);
	f.scripts.clear();
	assert.equal(await sync(f.c), LOCAL);
	assert.equal(f.scripts.get(SCRIPT_ID)!.matches?.[0], 'http://localhost:3100/api/plant-67');
});

test('permission taken away in Chrome: unregistered, address kept; given back: registered again', async () => {
	const f = fakeChrome();
	await hook(f, LOCAL);
	f.granted.clear();
	assert.equal(await sync(f.c), null);
	assert.equal(f.scripts.size, 0);
	assert.equal(await savedOrigin(f.c), LOCAL);
	f.granted.add('http://localhost/*');
	assert.equal(await sync(f.c), LOCAL);
	assert.equal(f.scripts.size, 1);
});

test('a broader grant (Chrome set to "on all sites") still counts', async () => {
	const f = fakeChrome();
	f.granted.add('*://*/*');
	await f.c.storage.set({ [ORIGIN_KEY]: LOCAL });
	assert.equal(await sync(f.c), LOCAL);
});

test('sync with nothing saved clears a stray registration', async () => {
	const f = fakeChrome();
	f.scripts.set(SCRIPT_ID, { id: SCRIPT_ID, matches: ['https://old.example.com/api/plant-67'] });
	assert.equal(await sync(f.c), null);
	assert.equal(f.scripts.size, 0);
});

test('sync fixes a registration for the wrong address', async () => {
	const f = fakeChrome();
	await f.c.permissions.request({ origins: ['http://localhost/*'] });
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

/**
 * A fetch that answers once with a response.
 *
 * @param r The response.
 * @returns fetch.
 */
const answering = (r: Response | (Partial<Response> & { type: string })): typeof fetch => (async () => r) as unknown as typeof fetch;

test('knock: Paperclip, a sign-in, someone else, or nobody', async () => {
	let seen: [string, RequestInit | undefined] | null = null;
	const paperclip: typeof fetch = async (u, i) => {
		seen = [String(u), i];
		return new Response('{"error":"API route not found"}', { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } });
	};
	assert.deepEqual(await knock(paperclip, LOCAL), { kind: 'paperclip' });
	assert.equal(seen![0], 'http://localhost:3100/api/plant-67');
	assert.equal(seen![1]?.credentials, 'omit');
	assert.equal(seen![1]?.redirect, 'manual');
	assert.deepEqual(await knock(answering(new Response('', { status: 403 })), HOSTED), { kind: 'signin' });
	assert.deepEqual(await knock(answering(new Response('', { status: 401 })), HOSTED), { kind: 'signin' });
	assert.deepEqual(await knock(answering(new Response('<html>Not found</html>', { status: 404, headers: { 'content-type': 'text/html' } })), LOCAL), { kind: 'other' });
	assert.deepEqual(await knock(answering(new Response('{"nope":1}', { status: 404, headers: { 'content-type': 'application/json' } })), LOCAL), { kind: 'other' });
	assert.deepEqual(await knock(answering(new Response('{"error":"x"}', { status: 200, headers: { 'content-type': 'application/json' } })), LOCAL), { kind: 'other' });
	assert.deepEqual(await knock(answering(new Response('not json', { status: 404, headers: { 'content-type': 'application/json' } })), LOCAL), { kind: 'other' });
	assert.deepEqual(await knock(answering(new Response('', { status: 502 })), HOSTED), { kind: 'other' });
	const refused: typeof fetch = async () => { throw new TypeError('Failed to fetch'); };
	assert.deepEqual(await knock(refused, LOCAL), { kind: 'silent' });
	const hangs: typeof fetch = (_u, i) => new Promise((_res, rej) => i?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
	assert.deepEqual(await knock(hangs, LOCAL, 20), { kind: 'silent' });
});

/**
 * A little web, seen from the extension the way Chrome lets it see: `redirects` sends an origin
 * on to a URL, `servers` answer with Paperclip's 404. A followed request may only be read where
 * the extension holds the knocked origin's grant (same scheme and host, any port); anywhere
 * else the CORS check fails, as it does for Paperclip, which sends no CORS headers. A no-cors
 * request reads nothing but resolves wherever a server answers.
 *
 * @param o The web.
 * @param o.redirects Origin to the URL it redirects to.
 * @param o.servers Origins with a server.
 * @param o.knocked The origin the extension holds a grant for.
 * @returns fetch.
 */
function web(o: { redirects?: Record<string, string>; servers: string[]; knocked: string }): typeof fetch {
	const grant = new URL(o.knocked);
	const readable = (u: URL): boolean => u.protocol === grant.protocol && u.hostname === grant.hostname;
	const land = (u: URL): URL => {
		for (let i = 0; i < 5 && o.redirects?.[u.origin]; i++) {
			const next = new URL(o.redirects[u.origin], u);
			if (next.origin === u.origin && next.pathname !== u.pathname) return next;
			u = next;
		}
		return u;
	};
	return (async (input: string | URL | Request, i?: RequestInit) => {
		const u = new URL(String(input));
		if (i?.redirect === 'manual') {
			if (o.redirects?.[u.origin]) return { type: 'opaqueredirect', status: 0, url: '', headers: new Headers() };
			if (o.servers.includes(u.origin)) return new Response('{"error":"API route not found"}', { status: 404, headers: { 'content-type': 'application/json' } });
			throw new TypeError('Failed to fetch');
		}
		const end = land(u);
		if (!o.servers.includes(end.origin)) throw new TypeError('Failed to fetch');
		if (i?.mode === 'no-cors') return { type: 'opaque', status: 0, url: '', headers: new Headers() };
		if (!readable(end)) throw new TypeError('Failed to fetch');
		return { type: 'basic', status: 404, url: end.href, headers: new Headers({ 'content-type': 'application/json' }) };
	}) as unknown as typeof fetch;
}

test('knock: http to https cannot be read, so the https address is tried and offered', async () => {
	const at = 'http://paperclip.example.com';
	const f = web({ knocked: at, redirects: { [at]: 'https://paperclip.example.com/api/plant-67' }, servers: ['https://paperclip.example.com'] });
	assert.deepEqual(await knock(f, at), { kind: 'redirect', guess: 'https://paperclip.example.com' });
});

test('knock: to "www." cannot be read either, and is offered', async () => {
	const f = web({ knocked: HOSTED, redirects: { [HOSTED]: 'https://www.paperclip.example.com/api/plant-67' }, servers: ['https://www.paperclip.example.com'] });
	assert.deepEqual(await knock(f, HOSTED), { kind: 'redirect', guess: 'https://www.paperclip.example.com' });
});

test('knock: another port on the same host can be read, and is a move', async () => {
	const at = 'http://paperclip.local:3100';
	const f = web({ knocked: at, redirects: { [at]: 'http://paperclip.local:8080/api/plant-67' }, servers: ['http://paperclip.local:8080'] });
	assert.deepEqual(await knock(f, at), { kind: 'moved', to: 'http://paperclip.local:8080' });
});

test('knock: a sign-in service elsewhere is a redirect with no guess', async () => {
	const f = web({ knocked: HOSTED, redirects: { [HOSTED]: 'https://team.cloudflareaccess.com/login' }, servers: ['https://team.cloudflareaccess.com'] });
	assert.deepEqual(await knock(f, HOSTED), { kind: 'redirect' });
});

test('knock: a /login page on the same origin is a sign-in', async () => {
	const f = web({ knocked: HOSTED, redirects: { [HOSTED]: '/login' }, servers: [HOSTED] });
	assert.deepEqual(await knock(f, HOSTED), { kind: 'signin' });
});

test('knock: each request has its own time limit', async () => {
	let n = 0;
	const slowThenStuck: typeof fetch = (_u, i) => new Promise((res, rej) => {
		n++;
		if (i?.redirect === 'manual') setTimeout(() => res({ type: 'opaqueredirect', status: 0, url: '', headers: new Headers() } as unknown as Response), 30);
		else i?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
	});
	// The first reply takes most of the limit; the follow-up still gets its own.
	assert.deepEqual(await knock(slowThenStuck, HOSTED, 40), { kind: 'redirect' });
	assert.ok(n >= 2);
});

test('likely moves: https for http, and with or without www', () => {
	assert.deepEqual(likelyMoves('http://paperclip.example.com'), ['https://paperclip.example.com', 'http://www.paperclip.example.com']);
	assert.deepEqual(likelyMoves('http://paperclip.local:3100'), ['https://paperclip.local', 'https://paperclip.local:3100', 'http://www.paperclip.local:3100']);
	assert.deepEqual(likelyMoves('https://www.paperclip.example.com'), ['https://paperclip.example.com']);
	assert.deepEqual(likelyMoves('http://192.168.1.5:3100'), ['https://192.168.1.5', 'https://192.168.1.5:3100']);
	assert.deepEqual(likelyMoves('http://localhost:3100'), ['https://localhost', 'https://localhost:3100']);
});

test('a script someone else already removed counts as unregistered', async () => {
	const f = fakeChrome();
	await hook(f, LOCAL);
	const real = f.c.scripting.unregisterContentScripts;
	// Another context removes it between our look and our removal.
	f.c.scripting.unregisterContentScripts = async (filter) => {
		f.scripts.clear();
		await real(filter);
	};
	await disconnect(f.c);
	assert.equal(f.scripts.size, 0);
	assert.equal(await savedOrigin(f.c), null);
});
