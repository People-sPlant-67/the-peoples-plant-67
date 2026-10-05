/**
 * Pravda: only the allowed actions and fields are ever read out of the activity feed
 * (it also records secret reads), never a reply's text; only news prints a paper, never the
 * standing state alone; the lead is the most urgent story; and on screen the paper holds the
 * replay, keeps the news owed after a failure, and prints on a return to a hidden tab.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import type { FetchLike, ResponseLike } from '../src/live/http';
import { ACTIVITY_MAX, AWAY_MS, type Feed, type NewsEvent, type PressContext, gapWords, readFeed, setEdition, toEvent } from '../src/live/pravda';
import type { AgentState, Snapshot } from '../src/live/types';

const win = new Window();
Object.assign(globalThis, { document: win.document, localStorage: win.localStorage, HTMLElement: win.HTMLElement, requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number, cancelAnimationFrame: (h: number) => clearTimeout(h) });

const { createPravda, SEEN_KEY, WORDS } = await import('../src/cockpit/pravda');
const { ROSTER_KEY } = await import('../src/cockpit/remembered');
const { MOCK_COMPANY_ID, MOCK_EXTRA, mockFetch, mockSnapshots } = await import('../src/live/mock');

const A = '22222222-2222-4333-8444-000000000001';
const B = '22222222-2222-4333-8444-000000000002';
const C = '22222222-2222-4333-8444-000000000003';
const I = '44444444-2222-4333-8444-000000000001';
const J = '44444444-2222-4333-8444-000000000002';
const COMPANY = '33333333-2222-4333-8444-000000000001';
const T0 = Date.parse('2026-09-29T12:00:00Z');

/**
 * A JSON response.
 *
 * @param body Value.
 * @param status Status.
 * @returns Response-like.
 */
const json = (body: unknown, status = 200): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

/**
 * One raw activity record.
 *
 * @param action Action.
 * @param minsAgo How long before T0.
 * @param extra Other fields.
 * @returns Record.
 */
const row = (action: string, minsAgo: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: 'x', companyId: COMPANY, actorType: 'agent', actorId: A, action, entityType: 'issue', entityId: I, details: {}, createdAt: new Date(T0 - minsAgo * 60_000).toISOString(), ...extra,
});

/**
 * An event as toEvent makes it.
 *
 * @param action Action.
 * @param fields Fields to set.
 * @returns Event.
 */
const ev = (action: string, fields: Partial<NewsEvent> = {}): NewsEvent => ({ action, at: T0, actorType: 'agent', agentId: A, entityId: I, status: null, identifier: null, detail: null, ...fields });

/** Names on the roster in these tests. */
const NAMES: Record<string, string> = { [A]: 'Comrade Planner', [B]: 'Comrade Critic', [C]: 'Fresh Recruit' };

/** A press context with nothing waiting. */
const quiet: PressContext = { nameOf: (id) => NAMES[id] ?? null, statusOf: (id) => (NAMES[id] ? 'idle' : null), sent: new Set(), inError: [], dossiers: 0, tribunals: 0, hires: 0 };

/**
 * A feed from events.
 *
 * @param events Events.
 * @returns Feed.
 */
const feedOf = (events: NewsEvent[]): Feed => ({ events, cut: false, oldest: null });

/**
 * The headlines of an edition, lead first.
 *
 * @param events Events.
 * @param ctx Context.
 * @returns Headlines.
 */
const heads = (events: NewsEvent[], ctx: PressContext = quiet): string[] => {
	const e = setEdition(feedOf(events), ctx);
	return e ? [e.lead.head, ...e.briefs.map((b) => b.head)] : [];
};

test('only printed actions are read, with named fields, and never a reply\'s text', () => {
	assert.equal(toEvent(row('secret.access.listed', 1, { details: { secretName: 'SECRET' } })), null);
	assert.equal(toEvent(row('environment.lease_acquired', 1)), null);
	assert.equal(toEvent(row('issue.updated', 1, { createdAt: 'yesterday' })), null);
	const e = toEvent(row('issue.comment_added', 1, { details: { identifier: 'PLT-1', issueTitle: 'Fix it', bodySnippet: 'SECRET pasted here', token: 'SECRET' } }));
	assert.ok(e);
	assert.equal(e.identifier, 'PLT-1');
	assert.ok(!JSON.stringify(e).includes('SECRET'));
	assert.equal(toEvent(row('agent.hire_created', 1, { details: { name: 'Fresh Recruit' } }))?.detail, 'Fresh Recruit');
	// Ids that are not UUIDs are dropped rather than looked up.
	assert.equal(toEvent(row('issue.updated', 1, { entityId: '../x', actorId: 'nope' }))?.entityId, null);
	assert.equal(toEvent(row('issue.updated', 1, { actorType: 'user' }))?.agentId, null);
});

test('the feed is read once, at the maximum, sorted, and cut at the last visit', async () => {
	const calls: string[] = [];
	const rows = [row('issue.created', 50), row('issue.created', 10), row('secret.access.listed', 60), row('issue.created', 200)];
	const f: FetchLike = async (p) => { calls.push(p); return json(rows); };
	const r = await readFeed(f, COMPANY, T0 - 100 * 60_000);
	assert.ok(r.ok);
	assert.deepEqual(calls, [`/api/companies/${COMPANY}/activity?limit=${ACTIVITY_MAX}`]);
	assert.deepEqual(r.feed.events.map((e) => (T0 - e.at) / 60_000), [10, 50], 'newest first, whatever order Paperclip sent');
	assert.equal(r.feed.cut, false);
	assert.equal(gapWords(r.feed, () => 'x'), '');
	// Every record newer than the last visit: older news is missing, and the paper says so.
	const full: FetchLike = async () => json(Array.from({ length: ACTIVITY_MAX }, (_, k) => row('issue.created', k + 1)));
	const r2 = await readFeed(full, COMPANY, T0 - 10_000 * 60_000);
	assert.ok(r2.ok && r2.feed.cut);
	assert.equal(gapWords(r2.feed, () => '25 Sept, 14:00'), "Pravda's archive only reaches back to 25 Sept, 14:00; anything older is not printed.");
	assert.equal((await readFeed(f, '../x', 0)).ok, false);
	assert.equal(calls.length, 1);
});

test('only news prints a paper: never the standing state alone, nor the owner\'s own work', () => {
	assert.equal(setEdition(feedOf([]), quiet), null);
	assert.equal(setEdition(feedOf([]), { ...quiet, inError: ['Comrade Planner'], dossiers: 2, tribunals: 1 }), null);
	assert.equal(setEdition(feedOf([ev('issue.created', { actorType: 'user', agentId: null }), ev('issue.comment_added', { actorType: 'user', agentId: null })]), quiet), null);
	// A comrade's comment on someone else's issue is news, if only a count.
	const e = setEdition(feedOf([ev('issue.comment_added', { entityId: J })]), quiet);
	assert.equal(e?.lead.head, 'A quiet shift at the plant');
	assert.equal(e?.inBrief, 'Comrades wrote 1 comment.');
});

test('the lead is the most urgent: waiting on you, a termination, errors, the plan, answers, the board, hires', () => {
	const all = [
		ev('agent.hire_created', { entityId: C, detail: 'Fresh Recruit' }),
		ev('approval.approved', { detail: 'hire_agent', actorType: 'user', agentId: null, entityId: J }),
		ev('issue.comment_added', { entityId: I, identifier: 'PLT-7' }),
		ev('issue.updated', { status: 'done', identifier: 'PLT-8', entityId: J }),
		ev('agent.terminated', { entityId: B, actorType: 'user', agentId: null }),
	];
	const ctx = { ...quiet, sent: new Set([I]), inError: ['Comrade Spanner'], tribunals: 1 };
	assert.deepEqual(heads(all, ctx), ['The court awaits the Chairman', 'Comrade Critic removed from the plant', 'Comrade Spanner stopped with an error', 'Plan fulfilled: 1 task completed', 'Comrade Planner answers your directives']);
	assert.equal(heads(all, { ...ctx, tribunals: 0 })[0], 'Comrade Critic removed from the plant');
	assert.equal(heads(all.slice(0, 4), { ...ctx, tribunals: 0, inError: [] })[0], 'Plan fulfilled: 1 task completed');
	assert.equal(heads(all.slice(0, 3), { ...ctx, tribunals: 0, inError: [] })[0], 'Comrade Planner answers your directives');
	assert.equal(heads(all.slice(0, 1), { ...ctx, tribunals: 0, inError: [] })[0], 'Fresh Recruit joins the plant');
	const e = setEdition(feedOf(all), ctx);
	assert.equal(e?.lead.body, 'A tribunal awaits your verdict. Put the paper down to see to it.');
	assert.equal(e?.briefs[1].body, 'They wait in Siberia. The reason is on their name card, and the Personnel File can clear it.');
	assert.equal(e?.briefs[3].body, 'Comrade Planner replied once, on PLT-7. The Directives tab has the replies.');
});

test('each thing is counted once, and the copy reads as sentences', () => {
	const done = [ev('issue.updated', { status: 'done', identifier: 'PLT-1' }), ev('issue.updated', { status: 'done', identifier: 'PLT-1' })];
	const e = setEdition(feedOf(done), quiet);
	assert.equal(e?.lead.head, 'Plan fulfilled: 1 task completed');
	assert.equal(e?.lead.body, 'Comrade Planner led the way with 1 task. Completed: PLT-1.');
	const approvals = [1, 2, 3].map((k) => ev('approval.approved', { detail: 'hire_agent', actorType: 'user', agentId: null, entityId: `44444444-2222-4333-8444-00000000000${k}` }));
	const board = setEdition(feedOf([...approvals, ev('approval.rejected', { detail: 'budget_override_required', actorType: 'user', agentId: null, entityId: '44444444-2222-4333-8444-000000000099' })]), quiet);
	assert.equal(board?.lead.body, 'The board approved 3 hires and refused a budget override.');
	const created = [1, 2].map((k) => ev('issue.created', { entityId: `44444444-2222-4333-8444-00000000001${k}` }));
	assert.equal(setEdition(feedOf([...created, ev('agent.paused', { actorType: 'user', agentId: null, entityId: B })]), quiet)?.inBrief, '2 new issues were filed. The board paused comrades once.');
	// A termination with no name left anywhere still starts with a capital.
	assert.equal(heads([ev('agent.terminated', { entityId: J, actorType: 'user', agentId: null })])[0], 'A comrade removed from the plant');
});

test('a hire is welcomed only once approved; one still at the desk waits; a refused one is not mentioned', () => {
	const hire = ev('agent.hire_created', { entityId: C, detail: 'Fresh Recruit' });
	const at = (status: string | null) => setEdition(feedOf([hire]), { ...quiet, statusOf: (id) => (id === C ? status : 'idle') });
	assert.equal(at('idle')?.lead.body, 'Welcome to Fresh Recruit.');
	assert.equal(at('pending_approval')?.lead.head, 'A new comrade asks to join');
	assert.equal(at('pending_approval')?.lead.body, 'Fresh Recruit waits at the Recruitment Office for your stamp.');
	assert.equal(at(null), null, 'nothing else happened, so no paper at all');
});

/**
 * A good snapshot from the mock.
 *
 * @returns Snapshot.
 */
function snap(): Snapshot {
	const s = mockSnapshots(1).next().value;
	return { ...s, companyId: MOCK_COMPANY_ID, session: 'ok', approvals: null, agents: s.agents.map((a: AgentState) => ({ ...a, status: 'idle', errorReason: null })) };
}

/**
 * Wait for pending promises.
 *
 * @param ms How long.
 */
const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Set up storage as a returning visit left it.
 *
 * @param lastSeenMsAgo How long ago the last visit was, or null for none.
 */
function stored(lastSeenMsAgo: number | null): void {
	win.localStorage.clear();
	if (lastSeenMsAgo !== null) win.localStorage.setItem(SEEN_KEY, JSON.stringify({ [MOCK_COMPANY_ID]: Date.now() - lastSeenMsAgo }));
	win.localStorage.setItem(ROSTER_KEY, JSON.stringify({ companyId: MOCK_COMPANY_ID, agents: [{ id: MOCK_EXTRA.purged, name: 'Comrade Purged', title: null, role: null }] }));
}

test('on opening: printed after a real absence, holding the replay until then, and never a pasted secret', async () => {
	const base = mockFetch(mockSnapshots(1), { scenario: 'pravda' });
	let release: () => void = () => {};
	const slow: FetchLike = async (p, i) => { if (p.includes('/activity')) await new Promise<void>((r) => { release = r; }); return base(p, i); };
	stored(14 * 3_600_000);
	const p = createPravda({ fetchImpl: slow, sent: () => new Set() });
	p.start(snap());
	await tick();
	assert.equal(p.open, false);
	assert.equal(p.holding, true, 'the replay waits for the paper, not just for the paper to open');
	release();
	await tick();
	assert.equal(p.open, true);
	assert.equal(p.holding, true);
	const text = p.el.textContent ?? '';
	assert.match(text, /Comrade Purged removed from the plant/, 'named from the roster remembered at the last visit');
	assert.ok(!text.includes('MOCK_SECRET'));
	p.escape();
	assert.equal(p.holding, false);
	for (const ago of [AWAY_MS - 60_000, null]) {
		stored(ago);
		const q = createPravda({ fetchImpl: base, sent: () => new Set() });
		q.start(snap());
		await tick();
		assert.equal(q.open, false);
		assert.equal(q.holding, false);
	}
});

test('a failed print keeps the news owed: the last visit stays put and the button covers the absence', async () => {
	let fail = true;
	const calls: string[] = [];
	const f: FetchLike = async (p) => { calls.push(p); return fail ? json({ error: 'down' }, 503) : json([row('agent.terminated', 5, { entityId: MOCK_EXTRA.purged, actorType: 'user' })]); };
	stored(14 * 3_600_000);
	const before = win.localStorage.getItem(SEEN_KEY);
	const p = createPravda({ fetchImpl: f, sent: () => new Set() });
	const s = snap();
	p.start(s);
	await tick();
	p.seen(s);
	assert.equal(p.open, false);
	assert.equal(p.words, WORDS.unread);
	assert.equal(win.localStorage.getItem(SEEN_KEY), before);
	fail = false;
	p.read();
	await tick();
	assert.equal(p.open, true);
	assert.equal(p.words, WORDS.ready);
	assert.match(p.el.textContent ?? '', /Since .*\(14 hours ago\)/);
	p.escape();
});

test('the button on failure says the presses have stopped, in a sentence', async () => {
	stored(null);
	const p = createPravda({ fetchImpl: async () => json({ error: 'down' }, 503), sent: () => new Set() });
	p.start(snap());
	p.read();
	await tick();
	assert.equal(p.open, true);
	assert.match(p.el.textContent ?? '', /The presses have stopped/);
	assert.match(p.el.textContent ?? '', /Pravda could not be printed, because/);
	p.escape();
});

test('the last visit moves on at most once a minute, and a return to a long-hidden tab prints', async () => {
	stored(null);
	let now = T0;
	let hidden = false;
	const f: FetchLike = async () => json([row('agent.terminated', 5, { entityId: MOCK_EXTRA.purged, actorType: 'user', createdAt: new Date(now - 60_000).toISOString() })]);
	const p = createPravda({ fetchImpl: f, sent: () => new Set(), now: () => now, isHidden: () => hidden });
	const s = snap();
	p.start(s);
	p.seen(s);
	const saved = () => (JSON.parse(win.localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>)[MOCK_COMPANY_ID];
	assert.equal(saved(), T0);
	now += 30_000;
	p.seen(s);
	assert.equal(saved(), T0);
	now += 40_000;
	p.seen({ ...s, session: 'access-lapsed' });
	assert.equal(saved(), T0, 'a lapsed snapshot is not a visit');
	p.seen(s);
	assert.equal(saved(), T0 + 70_000);
	// Hidden for two hours: the poller skips the tab, so nothing moves the last visit meanwhile.
	hidden = true;
	p.onVisible();
	now += 2 * 3_600_000;
	hidden = false;
	p.onVisible();
	assert.equal(p.holding, true);
	await tick();
	assert.equal(p.open, true);
	p.escape();
	// Hidden for a moment: no paper.
	hidden = true;
	p.onVisible();
	now += 60_000;
	hidden = false;
	p.onVisible();
	await tick();
	assert.equal(p.open, false);
});

test('keys stay in the paper: Escape closes it, Tab stays inside, and nothing reaches the plant behind', async () => {
	stored(null);
	const p = createPravda({ fetchImpl: async () => json([]), sent: () => new Set() });
	// The invisible button over the paper on the desk, as the keyboard reaches it.
	const opener = win.document.createElement('button') as unknown as HTMLButtonElement;
	(win.document.body as unknown as HTMLElement).append(opener, p.el);
	p.start(snap());
	opener.focus();
	p.read();
	await tick();
	const paper = p.el.querySelector('.p67-pravda') as unknown as HTMLElement;
	const leaked: string[] = [];
	win.document.addEventListener('keydown', (e) => leaked.push((e as unknown as KeyboardEvent).key));
	for (const key of ['ArrowLeft', '+', 'Tab']) paper.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true }) as unknown as Event);
	assert.deepEqual(leaked, []);
	assert.equal(win.document.activeElement, p.el.querySelector('.p67-pravda-close'));
	paper.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }) as unknown as Event);
	assert.equal(win.document.activeElement, paper);
	paper.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	assert.equal(p.open, false);
	assert.equal(win.document.activeElement, opener, 'focus goes back to the button that opened it');
	p.el.remove();
	opener.remove();
});

test('a status change that makes no story is not news, even with a comrade in error and dossiers waiting', () => {
	const busy = { ...quiet, inError: ['Comrade Spanner'], dossiers: 2 };
	assert.equal(setEdition(feedOf([ev('issue.updated', { status: 'in_progress' })]), busy), null);
	assert.equal(setEdition(feedOf([ev('issue.updated', { status: 'todo', actorType: 'system', agentId: null })]), busy), null);
	// A pause (most likely the owner's own) is counted when there is news, but is not news itself.
	const pause = ev('agent.paused', { actorType: 'user', agentId: null, entityId: B });
	assert.equal(setEdition(feedOf([pause]), quiet), null);
	assert.equal(setEdition(feedOf([pause, ev('issue.created')]), quiet)?.inBrief, '1 new issue was filed. The board paused comrades once.');
	// With news, the standing state is printed too.
	assert.deepEqual(heads([ev('issue.created')], busy), ['Comrade Spanner stopped with an error', 'The board at work']);
});

test('a hire waiting is said once: in the lead, not again in a brief', () => {
	const hire = ev('agent.hire_created', { entityId: C, detail: 'Fresh Recruit' });
	const ctx = { ...quiet, hires: 1, statusOf: (id: string) => (id === C ? 'pending_approval' : 'idle') };
	assert.deepEqual(heads([hire], ctx), ['The Recruitment Office awaits the Chairman']);
});

test('a tab opened in the background prints on the first look after 30 minutes', async () => {
	stored(10 * 60_000);
	let now = Date.now();
	let hidden = true;
	const f: FetchLike = async () => json([row('agent.terminated', 5, { entityId: MOCK_EXTRA.purged, actorType: 'user', createdAt: new Date(now - 60_000).toISOString() })]);
	const p = createPravda({ fetchImpl: f, sent: () => new Set(), now: () => now, isHidden: () => hidden });
	const s = snap();
	p.start(s);
	await tick();
	assert.equal(p.open, false, 'away only 10 minutes before it opened');
	p.seen(s);
	now += 3 * 3_600_000;
	hidden = false;
	p.onVisible();
	await tick();
	assert.equal(p.open, true);
	p.escape();
});

test('a request whose body stalls after the headers gives up at the timeout', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const { TIMEOUT_MS, get } = await import('../src/live/http');
	const stall: FetchLike = async () => ({ type: 'basic', status: 200, ok: true, text: () => new Promise<string>(() => {}) });
	const r = get(stall, '/api/x');
	await Promise.resolve();
	await Promise.resolve();
	t.mock.timers.tick(TIMEOUT_MS);
	const got = await r;
	assert.equal(got.ok, false);
});
