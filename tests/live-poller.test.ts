/**
 * Poller behaviour against a fake fetch and fake timers: company discovery, what it requests,
 * session mapping, keeping the last good roster, no overlapping ticks, backoff and hidden tabs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKOFF_MS, createPoller, type FetchLike, type ResponseLike } from '../src/live/poller';
import { mockFetch, mockSnapshots } from '../src/live/mock';
import type { Snapshot } from '../src/live/types';

const CID = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';

/**
 * A JSON response.
 *
 * @param body Value to serialise.
 * @param status HTTP status.
 * @returns Response-like object.
 */
const json = (body: unknown, status = 200): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

/**
 * A response carrying a status and non-JSON text.
 *
 * @param status HTTP status.
 * @param text Body text.
 * @returns Response-like object.
 */
const raw = (status: number, text = '<html>login</html>'): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => text });

const OPAQUE: ResponseLike = { type: 'opaqueredirect', status: 0, ok: false, text: async () => '' };

const AGENTS = [
	{ id: 'a1', name: 'Comrade One', title: 'Delivery Lead', role: 'pm', status: 'idle', lastHeartbeatAt: '2026-09-23T09:00:00Z', reportsTo: null, urlKey: 'one', secretToken: 'x' },
	{ id: 'a2', name: 'Comrade Two', status: 'weird-new-status' },
	{ name: 'No id, dropped' },
];
const BADGES = { inbox: 2, approvals: 1, failedRuns: 3, joinRequests: 0 };

type Handler = (path: string) => ResponseLike | Promise<ResponseLike>;

/**
 * Fake fetch that records every call and answers from a handler.
 *
 * @param handler Answers one path.
 * @returns The fetch and its call log.
 */
function fakeFetch(handler: Handler) {
	const calls: { path: string; init?: RequestInit }[] = [];
	const fetchImpl: FetchLike = async (path, init) => { calls.push({ path, init }); return handler(path); };
	return { fetchImpl, calls };
}

/**
 * Handler for a healthy Paperclip with the given companies.
 *
 * @param companies Companies list body.
 * @returns Handler.
 */
function healthy(companies: unknown = [{ id: OTHER, name: 'Other Co' }, { id: CID, name: 'The Propaganda Dept' }]): Handler {
	return (path) => {
		if (path === '/api/companies') return json(companies);
		if (path.endsWith('/agents')) return json(AGENTS);
		if (path.endsWith('/sidebar-badges')) return json(BADGES);
		return json({ error: 'nope' }, 404);
	};
}

/**
 * Fake timers: nothing fires until the test calls fire().
 *
 * @returns Timers plus a record of the pending delay.
 */
function fakeTimers() {
	let pending: { fn: () => void; ms: number } | null = null;
	const delays: number[] = [];
	return {
		timers: {
			set: (fn: () => void, ms: number) => { pending = { fn, ms }; delays.push(ms); return pending; },
			clear: (h: unknown) => { if (pending === h) pending = null; },
		},
		delays,
		/** Delay of the pending timer, or null. */
		pendingMs: () => pending?.ms ?? null,
		/** Fire the pending timer. */
		fire: () => { const p = pending; pending = null; assert.ok(p, 'a timer should be pending'); p.fn(); },
	};
}

/**
 * Let queued promise work run.
 *
 * @returns Resolves after one macrotask.
 */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Build a poller with fakes and collect its snapshots.
 *
 * @param handler Fetch handler.
 * @param extra Extra options.
 * @returns Poller, snapshots, fetch log, timers.
 */
function setup(handler: Handler, extra: { isHidden?: () => boolean; onVisibilityChange?: (cb: () => void) => () => void; companyId?: string | null } = {}) {
	const snaps: Snapshot[] = [];
	const f = fakeFetch(handler);
	const t = fakeTimers();
	let clock = 1_000_000;
	const poller = createPoller({ fetchImpl: f.fetchImpl, intervalMs: 20_000, companyId: 'companyId' in extra ? extra.companyId : CID, onSnapshot: (s) => snaps.push(s), now: () => clock, timers: t.timers, isHidden: extra.isHidden ?? (() => false), onVisibilityChange: extra.onVisibilityChange ?? (() => () => {}) });
	return { poller, snaps, ...f, ...t, advance: (ms: number) => { clock += ms; } };
}

test('picks the company chosen at setup and maps agents and badges', async () => {
	const s = setup(healthy());
	await s.poller.refresh(); // not started: no-op
	assert.equal(s.calls.length, 0);
	s.poller.start();
	await settle();
	assert.deepEqual(s.calls.map((c) => c.path), ['/api/companies', `/api/companies/${CID}/agents`, `/api/companies/${CID}/sidebar-badges`, `/api/companies/${CID}/approvals?status=pending`]);
	const snap = s.snaps[0];
	assert.equal(snap.session, 'ok');
	assert.equal(snap.message, null);
	assert.equal(snap.companyName, 'The Propaganda Dept');
	assert.equal(snap.at, 1_000_000);
	assert.deepEqual(snap.badges, BADGES);
	assert.equal(snap.agents.length, 2);
	assert.deepEqual(snap.agents[0], { id: 'a1', name: 'Comrade One', title: 'Delivery Lead', role: 'pm', status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: '2026-09-23T09:00:00Z', reportsTo: null, urlKey: 'one' });
	assert.deepEqual(snap.agents[1], { id: 'a2', name: 'Comrade Two', title: null, role: null, status: 'weird-new-status', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null });
	s.poller.stop();
});

test('company is discovered once, not every tick', async () => {
	const s = setup(healthy());
	s.poller.start();
	await settle();
	s.fire();
	await settle();
	assert.equal(s.calls.filter((c) => c.path === '/api/companies').length, 1);
	assert.equal(s.calls.filter((c) => c.path.endsWith('/agents')).length, 2);
	s.poller.stop();
});

test('with no company chosen, draws the first listed; accepts wrapped lists', async () => {
	const s = setup(healthy({ data: [{ id: CID, name: 'Alpha' }, { id: OTHER, name: 'Beta' }] }), { companyId: null });
	s.poller.start();
	await settle();
	assert.equal(s.calls[1].path, `/api/companies/${CID}/agents`);
	s.poller.stop();
});

test('a chosen company that is not listed is an error, never a quiet switch to another', async () => {
	const s = setup(healthy({ data: [{ id: CID, name: 'Alpha' }, { id: OTHER, name: 'Beta' }] }), { companyId: '00000000-0000-4000-8000-0000000000ff' });
	s.poller.start();
	await settle();
	assert.deepEqual(s.calls.map((c) => c.path), ['/api/companies'], 'no other company is read');
	assert.equal(s.snaps[0].session, 'company-gone');
	assert.equal(s.snaps[0].companyId, null);
	assert.match(s.snaps[0].message!, /no longer listed/);
	s.poller.stop();
});

test('the chosen company is drawn even when it is not first', async () => {
	const s = setup(healthy([{ id: CID, name: 'Alpha' }, { id: OTHER, name: 'Beta' }]), { companyId: OTHER });
	s.poller.start();
	await settle();
	assert.equal(s.calls[1].path, `/api/companies/${OTHER}/agents`);
	assert.equal(s.snaps[0].companyName, 'Beta');
	s.poller.stop();
});

test('UUID guard: a non-UUID company id never reaches a request path', async () => {
	for (const id of ['../../admin', 'abc', 42, `${CID}/../x`]) {
		const s = setup(healthy([{ id, name: 'Propaganda' }]), { companyId: null });
		s.poller.start();
		await settle();
		assert.deepEqual(s.calls.map((c) => c.path), ['/api/companies'], `id ${String(id)}`);
		assert.equal(s.snaps[0].session, 'no-company');
		assert.match(s.snaps[0].message!, /^[A-Z].+\.$/);
		assert.doesNotMatch(s.snaps[0].message!, /papers, please/i);
		s.poller.stop();
	}
});

test("signed in but no company at all reports 'no-company', not 'unreachable', and keeps checking", async () => {
	for (const body of [[], { data: [] }, {}]) {
		const s = setup(healthy(body));
		s.poller.start();
		await settle();
		assert.equal(s.snaps.length, 1);
		assert.equal(s.snaps[0].session, 'no-company');
		assert.match(s.snaps[0].message!, /no company/);
		// Discovery is retried on the next tick rather than given up on.
		assert.equal(s.pendingMs(), 20_000);
		s.fire();
		await settle();
		assert.deepEqual(s.calls.map((c) => c.path), ['/api/companies', '/api/companies']);
		s.poller.stop();
	}
});

test('agents, badges and approvals are fetched in parallel, as GETs with same-origin credentials and manual redirects', async () => {
	let open = 0;
	let maxOpen = 0;
	const release: (() => void)[] = [];
	const s = setup(async (path) => {
		if (path === '/api/companies') return json([{ id: CID, name: 'Propaganda' }]);
		open++; maxOpen = Math.max(maxOpen, open);
		await new Promise<void>((r) => release.push(r));
		open--;
		return healthy()(path);
	});
	s.poller.start();
	await settle();
	assert.equal(maxOpen, 3, 'all three requests should be open at once');
	release.forEach((r) => r());
	await settle();
	for (const c of s.calls) {
		assert.equal(c.init?.method ?? 'GET', 'GET');
		assert.equal(c.init?.credentials, 'same-origin');
		assert.equal(c.init?.redirect, 'manual');
	}
	s.poller.stop();
});

test('never requests heartbeat-runs, over many ticks', async () => {
	const s = setup(healthy());
	s.poller.start();
	await settle();
	for (let i = 0; i < 10; i++) { s.fire(); await settle(); }
	assert.ok(s.calls.length > 20);
	assert.ok(s.calls.every((c) => !/heartbeat-runs/.test(c.path)));
	s.poller.stop();
});

const CASES: [string, Handler, Snapshot['session']][] = [
	['opaqueredirect', () => OPAQUE, 'access-lapsed'],
	['raw 302 (Node fetch)', () => raw(302, ''), 'access-lapsed'],
	['401', () => json({ error: 'no' }, 401), 'signed-out'],
	['403', () => json({ error: 'no' }, 403), 'signed-out'],
	['500', () => json({ error: 'boom' }, 500), 'unreachable'],
	['non-JSON 200', () => raw(200), 'unreachable'],
	['network error', () => { throw new TypeError('Failed to fetch'); }, 'unreachable'],
];

for (const [label, fail, session] of CASES) {
	test(`session mapping: ${label} → ${session}, with an actionable sentence`, async () => {
		const s = setup(fail);
		s.poller.start();
		await settle();
		assert.equal(s.snaps.length, 1);
		assert.equal(s.snaps[0].session, session);
		assert.match(s.snaps[0].message!, /^[A-Z].+\.$/);
		assert.doesNotMatch(s.snaps[0].message!, /papers, please/i);
		assert.deepEqual(s.snaps[0].agents, []);
		s.poller.stop();
	});
}

test('a failure keeps the last good agents and badges', async () => {
	let broken: ResponseLike | null = null;
	const s = setup((path) => broken && path !== '/api/companies' ? broken : healthy()(path));
	s.poller.start();
	await settle();
	const good = s.snaps[0];
	assert.equal(good.badgesStale, false);
	assert.equal(good.companyId, CID);
	for (const r of [OPAQUE, json({}, 401), json({}, 500)]) {
		broken = r;
		s.fire();
		await settle();
		const last = s.snaps.at(-1)!;
		assert.notEqual(last.session, 'ok');
		assert.deepEqual(last.agents, good.agents);
		assert.deepEqual(last.badges, good.badges);
		assert.equal(last.badgesStale, true);
		assert.equal(last.companyName, good.companyName);
	}
	s.poller.stop();
});

test('a failing badges endpoint leaves the session ok and the agents fresh, with the counts marked stale', async () => {
	let badgesDown = false;
	let name = 'Comrade One';
	const s = setup((path) => {
		if (path.endsWith('/sidebar-badges') && badgesDown) return json({ error: 'gone' }, 404);
		if (path.endsWith('/agents')) return json([{ id: 'a1', name }]);
		return healthy()(path);
	});
	s.poller.start();
	await settle();
	badgesDown = true;
	name = 'Comrade Renamed';
	for (let i = 0; i < 3; i++) { s.fire(); await settle(); }
	const last = s.snaps.at(-1)!;
	assert.equal(last.session, 'ok');
	assert.equal(last.agents[0].name, 'Comrade Renamed');
	assert.deepEqual(last.badges, BADGES);
	assert.equal(last.badgesStale, true);
	// A badges 404 is not a sign the company went away, and no backoff kicks in.
	assert.equal(s.calls.filter((c) => c.path === '/api/companies').length, 1);
	assert.equal(s.pendingMs(), 20_000);
	s.poller.stop();
});

test('agents failing while badges work reports the agents failure', async () => {
	const s = setup((path) => path.endsWith('/agents') ? OPAQUE : healthy()(path));
	s.poller.start();
	await settle();
	assert.equal(s.snaps[0].session, 'access-lapsed');
	assert.deepEqual(s.snaps[0].badges, BADGES);
	s.poller.stop();
});

test('no overlapping requests: a refresh during a slow tick joins it', async () => {
	let release: () => void = () => {};
	let agentCalls = 0;
	const s = setup(async (path) => {
		if (path.endsWith('/agents')) { agentCalls++; await new Promise<void>((r) => { release = r; }); }
		return healthy()(path);
	});
	s.poller.start();
	await settle();
	const a = s.poller.refresh();
	const b = s.poller.refresh();
	await settle();
	assert.equal(agentCalls, 1);
	assert.equal(s.pendingMs(), null, 'no tick is scheduled while one is in flight');
	release();
	await Promise.all([a, b]);
	assert.equal(agentCalls, 1);
	assert.equal(s.snaps.length, 1);
	assert.equal(s.pendingMs(), 20_000);
	s.poller.stop();
});

test('backs off to 60s after 3 consecutive failures and returns on success', async () => {
	let down = true;
	const s = setup((path) => down ? json({}, 503) : healthy()(path));
	s.poller.start();
	await settle();
	assert.equal(s.pendingMs(), 20_000); // 1 failure
	s.fire(); await settle();
	assert.equal(s.pendingMs(), 20_000); // 2 failures
	s.fire(); await settle();
	assert.equal(s.pendingMs(), BACKOFF_MS); // 3 failures
	s.fire(); await settle();
	assert.equal(s.pendingMs(), BACKOFF_MS);
	down = false;
	s.fire(); await settle();
	assert.equal(s.snaps.at(-1)!.session, 'ok');
	assert.equal(s.pendingMs(), 20_000);
	s.poller.stop();
});

test('hidden tab: the first poll still runs, later ticks are skipped, and coming back refreshes at once', async () => {
	let hidden = true;
	let visibility: () => void = () => {};
	let unsubscribed = false;
	const s = setup(healthy(), { isHidden: () => hidden, onVisibilityChange: (cb) => { visibility = cb; return () => { unsubscribed = true; }; } });
	s.poller.start();
	await settle();
	assert.equal(s.snaps.length, 1, 'a cockpit opened in a background tab still loads the plant');
	const calls = s.calls.length;
	s.fire(); await settle();
	assert.equal(s.calls.length, calls);
	assert.equal(s.snaps.length, 1);
	assert.equal(s.pendingMs(), 20_000, 'keeps checking');
	hidden = false;
	visibility();
	await settle();
	assert.equal(s.snaps.length, 2);
	assert.equal(s.pendingMs(), 20_000);
	s.poller.stop();
	assert.ok(unsubscribed);
	assert.equal(s.pendingMs(), null);
});

test('stop drops an in-flight result and schedules nothing', async () => {
	let release: () => void = () => {};
	const s = setup(async (path) => { if (path.endsWith('/agents')) await new Promise<void>((r) => { release = r; }); return healthy()(path); });
	s.poller.start();
	await settle();
	s.poller.stop();
	release();
	await settle();
	assert.equal(s.snaps.length, 0);
	assert.equal(s.pendingMs(), null);
});

test('a 404 on the company path triggers rediscovery next tick', async () => {
	let gone = true;
	const s = setup((path) => gone && path.endsWith('/agents') ? json({}, 404) : healthy()(path));
	s.poller.start();
	await settle();
	gone = false;
	s.fire(); await settle();
	assert.equal(s.calls.filter((c) => c.path === '/api/companies').length, 2);
	assert.equal(s.snaps.at(-1)!.session, 'ok');
	s.poller.stop();
});

test('runs end to end against mockFetch, lapses included', async () => {
	const snaps: Snapshot[] = [];
	const t = fakeTimers();
	const poller = createPoller({ fetchImpl: mockFetch(mockSnapshots(7)), onSnapshot: (x) => snaps.push(x), timers: t.timers, isHidden: () => false, onVisibilityChange: () => () => {} });
	poller.start();
	await settle();
	for (let i = 0; i < 80; i++) { t.fire(); await settle(); }
	poller.stop();
	assert.equal(snaps.length, 81);
	assert.equal(snaps[0].session, 'ok');
	assert.equal(snaps[0].agents.length, 9);
	assert.ok(snaps.some((x) => x.session === 'access-lapsed'), 'the mock should lapse now and then');
	const statuses = new Set(snaps.flatMap((x) => x.agents.map((a) => a.status)));
	for (const st of ['running', 'idle', 'error', 'paused']) assert.ok(statuses.has(st), st);
	assert.ok(snaps.every((x) => x.agents.length === 9));
});
