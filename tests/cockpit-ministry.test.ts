/**
 * The setup while the plant runs (ministry.ts), against the mock Paperclip: the portrait is
 * repainted once after a run of brush strokes, a seat change re-places people, a new company
 * reloads the plant, the inspection runs on its schedule and hangs the plaque or the poster,
 * a blip never takes the plaque down, and a regime changed mid-inspection drops the old answer.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCHETYPES } from '../src/art/archetypes';
import { INSPECT_FOUNDED_MS, INSPECT_MS, REPAINT_MS, WATCH_MS, createMinistry, plaqueHangs } from '../src/cockpit/ministry';
import { DEFAULT_SETUP } from '../src/cockpit/setup-store';
import type { FetchLike } from '../src/live/http';
import { MOCK_COMPANY_ID, mockFetch, mockSnapshots } from '../src/live/mock';
import { isOwnSeat, setOwnSeat } from '../src/live/personas';
import type { Snapshot } from '../src/live/types';

const OTHER = '33333333-2222-4333-8444-000000000009';
const SEAT = '22222222-2222-4333-8444-000000000001';
const LEDGER = '44444444-2222-4333-8444-000000000001';
const settle = () => new Promise((r) => setTimeout(r, 0));
/**
 * Wait until a condition holds (a few event-loop turns at most).
 *
 * @param ok Condition.
 */
const until = async (ok: () => boolean): Promise<void> => { for (let k = 0; k < 200 && !ok(); k++) await settle(); };

/**
 * A controller over the mock, with a hand-driven clock and timers.
 *
 * @param fetchImpl Fetch.
 * @param start Setup fields to start from.
 * @param available The host can carry a Ministry.
 * @returns The controller and what it did.
 */
function make(fetchImpl: FetchLike = mockFetch(mockSnapshots(67)), start: Partial<typeof DEFAULT_SETUP> = {}, available = true) {
	let clock = 1_000_000;
	const pending: { fn: () => void; at: number }[] = [];
	const did = { portraits: [] as string[], founded: [] as boolean[], refresh: 0, reload: 0, changes: 0, saved: 0 };
	const m = createMinistry({
		fetchImpl,
		initial: { ...DEFAULT_SETUP, ...start },
		available,
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


test('brush strokes repaint the wall once, after the last one; the name and title go with it', () => {
	const t = make();
	for (const a of ARCHETYPES.slice(0, 4)) t.m.apply({ ...t.m.setup, portrait: a.pixels, name: 'Sasha' });
	t.advance(REPAINT_MS - 1);
	assert.deepEqual(t.did.portraits, []);
	t.advance(1);
	assert.deepEqual(t.did.portraits, ['Chairman of the Board Sasha']);
	assert.equal(t.did.saved, 4, 'every change is kept');
});

test('a company chosen while none is drawn (the old one has gone) reloads at once', () => {
	const t = make(undefined, { companyId: '33333333-2222-4333-8444-0000000000ff' });
	t.m.see({ ...t.snap(), session: 'company-gone', companyId: null });
	t.m.apply({ ...t.m.setup, companyId: MOCK_COMPANY_ID });
	t.advance(1);
	assert.equal(t.did.reload, 1);
});

test('the inspection runs on the first good snapshot, then waits its gap; founding hangs the plaque and keeps the ids', async () => {
	let routines = 0;
	const real = mockFetch(mockSnapshots(67));
	const t = make((p, i) => { if (p.endsWith('/routines')) routines++; return real(p, i); });
	t.m.see({ ...t.snap(), session: 'unreachable' });
	await settle();
	assert.equal(routines, 0, 'nothing is read before Paperclip answers');
	t.m.see(t.snap());
	await until(() => t.m.inspection !== null);
	assert.equal(routines, 1, 'the snapshot started one');
	assert.equal(t.m.setup.founded, true);
	assert.deepEqual(t.did.founded, [true]);
	assert.ok(t.m.setup.known.ledger, 'the ledger id is kept for next time');
	t.advance(INSPECT_MS);
	t.m.see(t.snap());
	await settle();
	assert.equal(routines, 1, 'founded: the next look waits the longer gap');
	t.advance(INSPECT_FOUNDED_MS);
	t.m.see(t.snap());
	await until(() => routines === 2);
	assert.equal(routines, 2, 'after the longer gap, one more');
});

test('a regime changed mid-inspection drops the old answer and looks again for the new one', async () => {
	let routines = 0;
	const real = mockFetch(mockSnapshots(67));
	const t = make((p, i) => { if (p.endsWith('/routines')) routines++; return real(p, i); });
	t.m.see(t.snap());
	t.m.apply({ ...t.m.setup, regime: 'purge' });
	await t.m.reinspect();
	assert.equal(routines, 2, 'the change asked for one more after the one in flight');
	assert.deepEqual(t.did.founded, [], 'the Standard answer never hung the plaque for a Purge regime');
	assert.equal(t.m.inspection?.threshold.state, 'wrong');
	assert.match(t.m.inspection!.threshold.note!, /regime says 1/);
});


test('a new company forgets the old one\'s seat, ledger, Lessons and plaque, reopens on Connect and reloads; keeping the drawn one does neither', () => {
	const t = make(undefined, { seatAgentId: SEAT, founded: true, known: { ledger: LEDGER, lessons: LEDGER } });
	try {
		t.m.see(t.snap());
		t.m.apply({ ...t.m.setup, companyId: MOCK_COMPANY_ID });
		t.advance(1);
		assert.equal(t.did.reload, 0, 'the company already drawn: nothing to start again');
		assert.equal(t.m.setup.seatAgentId, SEAT, 'and its seat stays');
		t.m.apply({ ...t.m.setup, companyId: OTHER, seatAgentId: SEAT, step: 'coffee' });
		assert.equal(t.m.setup.seatAgentId, null, 'the old company\'s seat is not this one\'s');
		assert.deepEqual(t.m.setup.known, { ledger: null, lessons: null });
		assert.equal(t.m.setup.founded, false);
		assert.equal(t.m.setup.step, 'connect', 'the form reopens where the seat is chosen from the new roster');
		t.m.apply({ ...t.m.setup, step: 'coffee' });
		assert.equal(t.m.setup.step, 'connect', 'nothing changes it while the reload is pending');
		t.advance(1);
		assert.equal(t.did.reload, 1);
	} finally {
		setOwnSeat(null);
	}
});

test('an inspection of the old company that lands after the switch is dropped', async () => {
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => { release = r; });
	const real = mockFetch(mockSnapshots(67));
	const t = make(async (p, i) => { if (p.endsWith('/routines')) await gate; return real(p, i); });
	try {
		t.m.see(t.snap());
		await settle();
		t.m.apply({ ...t.m.setup, companyId: OTHER });
		release();
		await until(() => false);
		assert.equal(t.m.setup.founded, false, 'the old company\'s plaque is not hung for the new one');
		assert.deepEqual(t.m.setup.known, { ledger: null, lessons: null });
		assert.equal(t.m.inspection, null);
	} finally {
		setOwnSeat(null);
	}
});

test('watching the inspection page asks again every few seconds on its own, and stops when told', async () => {
	let routines = 0;
	const real = mockFetch(mockSnapshots(67));
	const t = make((p, i) => { if (p.endsWith('/routines')) routines++; return real(p, i); });
	t.m.see(t.snap());
	await until(() => t.m.inspection !== null);
	assert.equal(routines, 1);
	t.m.watch(true);
	await until(() => routines === 2);
	assert.equal(routines, 2, 'watching starts with a look');
	t.advance(WATCH_MS);
	await until(() => routines === 3);
	t.advance(WATCH_MS);
	await until(() => routines === 4);
	assert.equal(routines, 4, 'and looks again every WATCH_MS, with no one asking');
	t.m.watch(false);
	t.advance(WATCH_MS * 3);
	await settle();
	assert.equal(routines, 4, 'no more once the page has gone');
});

test('a regime change looks again by itself', async () => {
	let routines = 0;
	const real = mockFetch(mockSnapshots(67));
	const t = make((p, i) => { if (p.endsWith('/routines')) routines++; return real(p, i); });
	t.m.see(t.snap());
	await until(() => t.m.inspection !== null);
	t.m.apply({ ...t.m.setup, regime: 'lenient' });
	await until(() => t.m.inspection?.threshold.state !== 'unknown');
	assert.equal(routines, 2);
	assert.match(t.m.inspection!.threshold.note!, /regime says 5/);
});

test('a regime change keeps the rest of the inspection, so the Director still counts while the ledger is read again', async () => {
	const t = make();
	t.m.see(t.snap());
	await until(() => t.m.inspection !== null);
	t.m.apply({ ...t.m.setup, regime: 'purge' });
	assert.equal(t.m.inspection?.director.state, 'ok');
	assert.equal(t.m.inspection?.threshold.state, 'unknown');
});

test('a reload that never happens does not freeze the plant', () => {
	const t = make();
	t.m.see(t.snap());
	t.m.apply({ ...t.m.setup, companyId: OTHER });
	t.m.apply({ ...t.m.setup, name: 'Ignored' });
	assert.notEqual(t.m.setup.name, 'Ignored');
	t.advance(10_000);
	assert.equal(t.m.setup.companyId, null, 'the setup goes back to the company still drawn');
	t.m.apply({ ...t.m.setup, name: 'Kept' });
	assert.equal(t.m.setup.name, 'Kept');
	setOwnSeat(null);
});

test('an inspection of a company other than the one the setup names is never kept', async () => {
	let routines = 0;
	const real = mockFetch(mockSnapshots(67));
	const t = make((p, i) => { if (p.endsWith('/routines')) routines++; return real(p, i); }, { companyId: OTHER });
	t.m.see(t.snap());
	await until(() => routines === 1);
	await settle();
	assert.equal(t.m.setup.founded, false, 'the drawn company\'s plaque is not hung for the one the setup names');
	assert.deepEqual(t.m.setup.known, { ledger: null, lessons: null });
});

test('a host with no Ministry is never inspected and never nags', async () => {
	let calls = 0;
	const real = mockFetch(mockSnapshots(67));
	const t = make((p, i) => { calls++; return real(p, i); }, {}, false);
	assert.equal(t.m.on, false);
	assert.equal(plaqueHangs(t.m.setup, false), true, 'the wall shows the plaque, not the poster');
	t.m.see(t.snap());
	t.m.watch(true);
	t.advance(INSPECT_MS * 3);
	await settle();
	assert.equal(calls, 0);
	assert.equal(t.m.inspection, null);
});

test('No Ministry, thanks: inspections stop and the plaque hangs; yes again inspects at once', async () => {
	let calls = 0;
	const real = mockFetch(mockSnapshots(67), { ministry: false });
	const t = make((p, i) => { calls++; return real(p, i); });
	assert.equal(plaqueHangs(t.m.setup, true), false, 'a wanted Ministry not founded: the poster');
	t.m.apply({ ...t.m.setup, ministry: false });
	assert.deepEqual(t.did.founded, [true], 'the poster comes down');
	assert.equal(t.m.on, false);
	t.m.see(t.snap());
	t.m.watch(true);
	t.advance(INSPECT_MS * 3);
	await settle();
	assert.equal(calls, 0, 'nothing is asked of Paperclip');
	t.m.apply({ ...t.m.setup, ministry: true });
	assert.deepEqual(t.did.founded, [true, false], 'the poster is back');
	await until(() => calls > 0 && t.m.inspection !== null);
	assert.ok(t.m.inspection, 'inspected at once');
});
