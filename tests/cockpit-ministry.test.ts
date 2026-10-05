/**
 * The setup while the plant runs (ministry.ts), against the mock Paperclip: the portrait is
 * repainted once after a run of brush strokes, a seat change re-places people, a new company
 * reloads the plant, the inspection runs on its schedule and hangs the plaque or the poster,
 * a blip never takes the plaque down, and a regime changed mid-inspection drops the old answer.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCHETYPES } from '../src/art/archetypes';
import { INSPECT_FOUNDED_MS, INSPECT_MS, createMinistry } from '../src/cockpit/ministry';
import { DEFAULT_SETUP } from '../src/cockpit/setup-store';
import type { FetchLike } from '../src/live/http';
import { MOCK_COMPANY_ID, mockFetch, mockSnapshots } from '../src/live/mock';
import { isOwnSeat, setOwnSeat } from '../src/live/personas';
import type { Snapshot } from '../src/live/types';

const OTHER = '33333333-2222-4333-8444-000000000009';

/**
 * A controller over the mock, with a hand-driven clock and timers.
 *
 * @param fetchImpl Fetch.
 * @param start Setup fields to start from.
 * @returns The controller and what it did.
 */
function make(fetchImpl: FetchLike = mockFetch(mockSnapshots(67)), start: Partial<typeof DEFAULT_SETUP> = {}) {
	let clock = 1_000_000;
	const pending: { fn: () => void; at: number }[] = [];
	const did = { portraits: [] as string[], founded: [] as boolean[], refresh: 0, reload: 0, changes: 0, saved: 0 };
	const m = createMinistry({
		fetchImpl,
		initial: { ...DEFAULT_SETUP, ...start },
		save: () => { did.saved++; },
		paintPortrait: (_p, address) => did.portraits.push(address),
		paintFounded: (f) => did.founded.push(f),
		refresh: () => { did.refresh++; },
		reload: () => { did.reload++; },
		onChange: () => { did.changes++; },
		now: () => clock,
		timers: { set: (fn, ms) => { const t = { fn, at: clock + ms }; pending.push(t); return t; }, clear: (h) => { const i = pending.indexOf(h as never); if (i >= 0) pending.splice(i, 1); } },
	});
	/**
	 * Move the clock on, firing timers that fall due.
	 *
	 * @param ms Milliseconds.
	 */
	const advance = (ms: number): void => {
		clock += ms;
		for (const t of pending.filter((x) => x.at <= clock)) { pending.splice(pending.indexOf(t), 1); t.fn(); }
	};
	const snap = (): Snapshot => ({ ...mockSnapshots(67).next().value, session: 'ok', companyId: MOCK_COMPANY_ID });
	return { m, did, advance, snap };
}

test('brush strokes repaint the wall once, after the last one; the name and title go with it', () => {
	const t = make();
	for (const a of ARCHETYPES.slice(0, 4)) t.m.apply({ ...t.m.setup, portrait: a.pixels, name: 'Sasha' });
	assert.deepEqual(t.did.portraits, []);
	t.advance(200);
	assert.deepEqual(t.did.portraits, ['Chairman of the Board Sasha']);
	assert.equal(t.did.saved, 4, 'every change is kept');
});

test('a seat change re-places people at once; the seat rule follows the setup', () => {
	const t = make();
	try {
		t.m.apply({ ...t.m.setup, seatAgentId: 'none' });
		assert.equal(t.did.refresh, 1);
		assert.equal(isOwnSeat({ id: 'x', name: 'Manual Seat' }), false);
	} finally {
		setOwnSeat(null);
	}
});

test('a company other than the one drawn reloads the plant; keeping the drawn one does not', async () => {
	const t = make();
	t.m.see(t.snap());
	t.m.apply({ ...t.m.setup, companyId: MOCK_COMPANY_ID });
	t.advance(1);
	assert.equal(t.did.reload, 0, 'the company already drawn: nothing to start again');
	t.m.apply({ ...t.m.setup, companyId: OTHER });
	t.advance(1);
	assert.equal(t.did.reload, 1);
});

test('the inspection: on the first good snapshot, then on its schedule; founding hangs the plaque and remembers the ids', async () => {
	const t = make();
	t.m.see({ ...t.snap(), session: 'unreachable' });
	assert.equal(t.m.inspection, null, 'nothing is read before Paperclip answers');
	t.m.see(t.snap());
	await t.m.reinspect();
	assert.equal(t.m.setup.founded, true);
	assert.deepEqual(t.did.founded, [true]);
	assert.ok(t.m.setup.known.ledger, 'the ledger id is kept for next time');
	const before = t.m.inspection;
	t.advance(INSPECT_MS);
	t.m.see(t.snap());
	assert.equal(t.m.inspection, before, 'founded: the next look waits the longer gap');
	t.advance(INSPECT_FOUNDED_MS);
	t.m.see(t.snap());
	await t.m.reinspect();
	assert.notEqual(t.m.inspection, before);
});

test('a blip never takes the plaque down; a piece really gone does', async () => {
	let mode: 'up' | 'down' | 'gone' = 'up';
	const real = mockFetch(mockSnapshots(67));
	const empty = mockFetch(mockSnapshots(67), { ministry: false });
	const f: FetchLike = (p, i) => (mode === 'up' ? real(p, i) : mode === 'gone' ? empty(p, i) : Promise.resolve({ type: 'basic', status: 503, ok: false, text: async () => '{}' }));
	const t = make(f);
	t.m.see(t.snap());
	await t.m.reinspect();
	assert.equal(t.m.setup.founded, true);
	mode = 'down';
	await t.m.reinspect();
	assert.equal(t.m.setup.founded, true, 'a failed read keeps the verdict');
	mode = 'gone';
	await t.m.reinspect();
	assert.equal(t.m.setup.founded, false);
	assert.deepEqual(t.did.founded, [true, false]);
});

test('asked again while one is in flight, it inspects once more after; a regime changed meanwhile drops the old answer', async () => {
	let calls = 0;
	const real = mockFetch(mockSnapshots(67));
	const f: FetchLike = (p, i) => { if (p.endsWith('/routines')) calls++; return real(p, i); };
	const t = make(f);
	t.m.see(t.snap());
	const first = t.m.reinspect();
	t.m.apply({ ...t.m.setup, regime: 'purge' });
	void t.m.reinspect();
	await first;
	assert.equal(calls, 2, 'one more after the one in flight');
	assert.equal(t.m.inspection?.threshold.state, 'wrong', 'the answer is for the regime now chosen');
	assert.match(t.m.inspection!.threshold.note!, /regime says 1/);
});
