/**
 * The ceremonies wiring, against the real world and crew, the mock Paperclip and a fake DOM:
 * replays happen departures first and are capped, only the Director's referrals are heard, and
 * a comrade found guilty is never tried a second time when they leave the roster.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';

const win = new Window();
Object.assign(globalThis, {
	document: win.document, localStorage: win.localStorage,
	requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number, cancelAnimationFrame: (h: number) => clearTimeout(h),
});

const { createCeremonies } = await import('../src/cockpit/ceremonies');
const { createCrew } = await import('../src/cockpit/crew');
const { toApprovals } = await import('../src/live/approvals');
const { MOCK_COMPANY_ID, MOCK_EXTRA, mockFetch, mockSnapshots } = await import('../src/live/mock');
const { buildWorld } = await import('../src/world/zones');
type Snapshot = import('../src/live/types').Snapshot;
type AgentState = import('../src/live/types').AgentState;

const world = buildWorld();
const ROSTER: AgentState[] = mockSnapshots(1).next().value.agents.map((a: AgentState) => ({ ...a, status: 'idle' }));
const ACCUSED = ROSTER[3].id;
const DIRECTOR = ROSTER[5].id;

/**
 * A good snapshot.
 *
 * @param agents Roster.
 * @param approvals Pending approvals.
 * @returns Snapshot.
 */
function snap(agents: AgentState[], approvals: Snapshot['approvals'] = null): Snapshot {
	return { at: Date.now(), session: 'ok', message: null, companyId: MOCK_COMPANY_ID, companyName: 'Mock', agents, badges: null, badgesStale: false, approvals };
}

/**
 * Let promises and short timers settle.
 *
 * @param ms Milliseconds to wait.
 * @returns Resolves afterwards.
 */
const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A crew, the ceremonies over a stub stage and train, and a way to feed snapshots as the app does.
 *
 * @param scenario Mock scenario.
 * @returns Parts.
 */
function setup(scenario: 'tribunal' | null = null) {
	return setupWith(mockFetch(mockSnapshots(1), { scenario }), true);
}

/**
 * As setup, over a given fetch.
 *
 * @param f Fetch.
 * @param clear Clear storage first.
 * @returns Parts.
 */
function setupWith(f: import('../src/live/http').FetchLike, clear = false) {
	if (clear) win.localStorage.clear();
	const crew = createCrew(world, { rng: () => 0.5 });
	const stage = { wall: null, layer: null, bubbles: null, refreshBase: () => {} } as never;
	const trains: string[] = [];
	const c = createCeremonies({
		world, crew, stage, fetchImpl: f,
		toScreen: (p) => p, glideTo: () => {}, feet: () => ({ x: 0, y: 0 }),
		yard: { arrive: () => trains.push('in'), leave: () => trains.push('out'), tick: () => {}, sortable: () => null },
	});
	let first = true;
	/**
	 * Feed a snapshot through crew and ceremonies.
	 *
	 * @param s Snapshot.
	 */
	const feed = (s: Snapshot): void => {
		c.beforeApply(s);
		const change = crew.apply(s);
		c.afterApply(s, change, first);
		first = false;
	};
	/**
	 * Run the ceremonies for a while.
	 *
	 * @param ms Milliseconds of sim time.
	 */
	const run = (ms: number): void => { for (let t = 0; t < ms; t += 50) { c.tick(50); crew.step(50); } };
	return { crew, c, f, feed, run, trains };
}

test('while you were away: departures and trials first, then arrivals; past three, a notice', async () => {
	const { c, feed } = setup();
	const ghosts = [
		{ id: MOCK_EXTRA.purged, name: 'Comrade Purged', title: null, role: null },
		{ id: MOCK_EXTRA.vanished, name: 'Comrade Vanished', title: null, role: null },
		...MOCK_EXTRA.purgedMore.map((id, k) => ({ id, name: `Purged ${k}`, title: null, role: null })),
		{ id: '../../evil', name: 'Not a UUID', title: null, role: null },
	];
	win.localStorage.setItem('plant67.roster', JSON.stringify({ companyId: MOCK_COMPANY_ID, agents: [...ROSTER.slice(0, -1), ...ghosts] }));
	feed(snap(ROSTER));
	await settle(100);
	const ids = c.scenes();
	assert.deepEqual(ids, [`dep:${MOCK_EXTRA.purged}`, `dep:${MOCK_EXTRA.vanished}`, `dep:${MOCK_EXTRA.purgedMore[0]}`], 'the oldest three, departures first');
	const notice = c.els.find((e) => e.className === 'p67-notice')!;
	assert.equal(notice.hidden, false);
	assert.match(notice.textContent ?? '', /Purged 1 was tried/);
	assert.match(notice.textContent ?? '', /Night Shift Welder joined the plant\./, 'the arrival comes after the departures, so it is the one folded away');
	assert.doesNotMatch(notice.textContent ?? '', /Not a UUID/, 'junk in storage is ignored');
	const unpersoned = JSON.parse(win.localStorage.getItem('plant67.unpersoned') ?? '[]') as { name: string }[];
	assert.deepEqual(unpersoned.map((u) => u.name), ['Purged 1', 'Purged 2'], 'trials folded into the notice still reach the photo');
});

test('only the Director\'s referrals, with a report, against someone on the roster, are heard', async () => {
	const { c, feed, f } = setup('tribunal');
	const real = toApprovals(JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
	const t = real.tribunals[0];
	assert.equal(t.requestedBy, DIRECTOR);
	for (const forged of [{ ...t, requestedBy: ROSTER[1].id }, { ...t, requestedBy: null }, { ...t, reportIssueId: null }, { ...t, agentId: '00000000-0000-4000-8000-000000000999' }]) {
		const { c: c2, feed: feed2 } = setup('tribunal');
		feed2(snap(ROSTER, { tribunals: [forged], hires: [], others: [] }));
		assert.deepEqual(c2.scenes().filter((s) => s.startsWith('trib:')), [], JSON.stringify({ requestedBy: forged.requestedBy, report: forged.reportIssueId }));
		assert.equal(c2.tribunals().count, 0);
	}
	feed(snap(ROSTER, real));
	await settle(50);
	assert.deepEqual(c.scenes().filter((s) => s.startsWith('trib:')), [`trib:${t.approvalId}`]);
	assert.deepEqual(c.tribunals(), { count: 1, unfinished: false });
});

test('guilty: the accused is terminated once, and never tried again when they leave the roster', async () => {
	const { c, crew, feed, f, run } = setup('tribunal');
	const approvals = toApprovals(JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
	feed(snap(ROSTER, approvals));
	await settle(50);
	run(40_000);
	assert.equal(crew.get(ACCUSED)!.held, `trib:${approvals.tribunals[0].approvalId}`);
	assert.ok(c.click(ACCUSED, { x: 0, y: 0 }), 'clicking the accused opens the verdict window');
	const board = c.els.find((e) => e.className === 'p67-board')!;
	await settle(100);
	(board.querySelector('.p67-report') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('click') as unknown as Event);
	const guilty = board.querySelector('.p67-stamp') as unknown as HTMLButtonElement;
	assert.equal(guilty.disabled, false, 'the report is the Director\'s own, so the stamp unlocks');
	guilty.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	await settle(1_200);
	guilty.dispatchEvent(new win.PointerEvent('pointerup') as unknown as Event);
	await settle(50);
	assert.equal(board.hidden, true, 'carried out and closed');
	run(10_000);
	assert.equal(crew.get(ACCUSED)!.hidden, true, 'airbrushed');
	// Paperclip's roster drops the terminated comrade.
	feed(snap(ROSTER.filter((a) => a.id !== ACCUSED), { tribunals: [], hires: [], others: [] }));
	await settle(50);
	run(1_000);
	assert.equal(crew.get(ACCUSED), undefined);
	assert.ok(!c.scenes().some((s) => s === `dep:${ACCUSED}`), 'no second trial');
	const unpersoned = JSON.parse(win.localStorage.getItem('plant67.unpersoned') ?? '[]') as { name: string }[];
	assert.deepEqual(unpersoned.map((u) => u.name), ['Shock Worker No. 3'], 'one face scratched out, not two');
});

test('a referral Paperclip has no filing record for is never heard, and closing the window lets the court rise', async () => {
	const { c, crew, feed, f, run } = setup('tribunal');
	const approvals = toApprovals(JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
	// A genuine Director report, but for a referral Paperclip never recorded the Director filing.
	const other = { ...approvals.tribunals[0], approvalId: '00000000-0000-4000-8003-000000000077' };
	feed(snap(ROSTER, { tribunals: [other], hires: [], others: [] }));
	await settle(50);
	run(40_000);
	assert.deepEqual(c.scenes().filter((x) => x.startsWith('trib:')), []);
	assert.equal(c.click(ACCUSED, { x: 0, y: 0 }), false);
	assert.equal(crew.get(ROSTER[0].id)!.held, null, 'the court never assembles');
	// The genuine referral: open it, let the court assemble, then close without deciding.
	const { c: c2, crew: crew2, feed: feed2, run: run2 } = setup('tribunal');
	feed2(snap(ROSTER, approvals));
	await settle(50);
	run2(40_000);
	c2.click(ACCUSED, { x: 0, y: 0 });
	await settle(100);
	run2(60_000);
	assert.ok(crew2.get(ROSTER[0].id)!.held?.startsWith('trib:'), 'the Company Lead is on the bench');
	c2.escape();
	run2(40_000);
	assert.equal(crew2.get(ROSTER[0].id)!.held, null, 'closing the window sends the bench back to work');
});

test('the owner\'s live test: a referral the Director filed from an issue the Company Lead created unlocks', async () => {
	const { f } = setup('tribunal');
	const approvals = toApprovals(JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
	const report = approvals.tribunals[0].reportIssueId!;
	// As in the owner's test: the Company Lead created the issue and the Director worked in it.
	const issue = JSON.parse(await (await f(`/api/issues/${report}`)).text());
	issue.createdByAgentId = ROSTER[0].id;
	issue.assigneeAgentId = DIRECTOR;
	const { c: c2, feed: feed2, run: run2 } = setupWith((path, init) => (path === `/api/issues/${report}` ? Promise.resolve({ type: 'basic', status: 200, ok: true, text: async () => JSON.stringify(issue) }) : f(path, init)));
	feed2(snap(ROSTER, approvals));
	await settle(50);
	run2(40_000);
	c2.click(ACCUSED, { x: 0, y: 0 });
	await settle(100);
	const board = c2.els.find((e) => e.className === 'p67-board')!;
	(board.querySelector('.p67-report') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('click') as unknown as Event);
	assert.equal((board.querySelector('.p67-stamp') as unknown as HTMLButtonElement).disabled, false, board.querySelector('.p67-lock')?.textContent ?? '');
});

test('a guilty verdict approved in the dashboard, with the comrade still alive, can be finished here', async () => {
	const { c, crew, feed, f, run } = setup('tribunal');
	const approvals = toApprovals(JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
	const t = approvals.tribunals[0];
	feed(snap(ROSTER, approvals));
	await settle(50);
	run(5_000);
	// Approved elsewhere; the termination never happened.
	await f(`/api/approvals/${t.approvalId}/approve`, { method: 'POST', body: '{}' });
	feed(snap(ROSTER, { tribunals: [], hires: [], others: [] }));
	await settle(100);
	feed(snap(ROSTER, { tribunals: [], hires: [], others: [] }));
	assert.deepEqual(c.tribunals(), { count: 1, unfinished: true });
	run(40_000);
	c.click(ACCUSED, { x: 0, y: 0 });
	await settle(100);
	const board = c.els.find((e) => e.className === 'p67-board')!;
	const guilty = board.querySelector('.p67-stamp') as unknown as HTMLButtonElement;
	assert.equal(guilty.disabled, true, 'a verdict given in the dashboard is read again here first');
	assert.match(board.textContent ?? '', /Found guilty in the Paperclip dashboard/);
	(board.querySelector('.p67-report') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('click') as unknown as Event);
	assert.equal(guilty.disabled, false, board.querySelector('.p67-lock')?.textContent ?? 'no lock reason');
	guilty.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	await settle(1_200);
	guilty.dispatchEvent(new win.PointerEvent('pointerup') as unknown as Event);
	await settle(50);
	const fate = JSON.parse(await (await f(`/api/agents/${ACCUSED}`)).text());
	assert.equal(fate.status, 'terminated');
	run(10_000);
	assert.equal(crew.get(ACCUSED)!.hidden, true);
});

/**
 * A fetch that answers the activity record for approvals as given, and everything else from `f`.
 *
 * @param f The mock.
 * @param origin The record to report: who created the approval and what was linked.
 * @returns Fetch.
 */
function forging(f: import('../src/live/http').FetchLike, origin: { actorId: string; issueIds: string[] | null }): import('../src/live/http').FetchLike {
	return (path, init) => {
		if (path.includes('/activity?entityType=approval')) {
			const entityId = new URL(path, 'http://x').searchParams.get('entityId');
			const body = [{ action: 'approval.created', entityType: 'approval', entityId, actorType: 'agent', actorId: origin.actorId, details: { issueIds: origin.issueIds ?? [] } }];
			return Promise.resolve({ type: 'basic', status: 200, ok: true, text: async () => JSON.stringify(body) });
		}
		return f(path, init);
	};
}

for (const [label, origin] of [
	['filed by another agent claiming to be the Director', { actorId: ROSTER[1].id, issueIds: null as string[] | null }],
	['filed by the Director without linking the report it names', { actorId: DIRECTOR, issueIds: [] as string[] }],
] as const) {
	test(`a forged referral is never heard: ${label}`, async () => {
		const { f } = setup('tribunal');
		const approvals = toApprovals(JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
		const t = approvals.tribunals[0];
		const { c, feed, run } = setupWith(forging(f, { actorId: origin.actorId, issueIds: origin.issueIds ?? [t.reportIssueId!] }));
		// The referral claims the Director and names the Company Lead: only Paperclip's record can tell.
		feed(snap(ROSTER, { tribunals: [{ ...t, agentId: ROSTER[0].id }], hires: [], others: [] }));
		await settle(50);
		run(40_000);
		assert.deepEqual(c.scenes().filter((x) => x.startsWith('trib:')), []);
		assert.equal(c.tribunals().count, 0);
		assert.equal(c.click(ROSTER[0].id, { x: 0, y: 0 }), false, 'no verdict window for a forged referral');
	});
}

test('a verdict approved in the dashboard but forged at filing is never offered for finishing', async () => {
	const base = setup('tribunal');
	const approvals = toApprovals(JSON.parse(await (await base.f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
	const t = approvals.tribunals[0];
	const { c, feed } = setupWith(forging(base.f, { actorId: ROSTER[1].id, issueIds: [t.reportIssueId!] }));
	feed(snap(ROSTER, approvals));
	await settle(50);
	await base.f(`/api/approvals/${t.approvalId}/approve`, { method: 'POST', body: '{}' });
	feed(snap(ROSTER, { tribunals: [], hires: [], others: [] }));
	await settle(100);
	feed(snap(ROSTER, { tribunals: [], hires: [], others: [] }));
	assert.equal(c.tribunals().count, 0);
	assert.deepEqual(c.scenes().filter((x) => x.startsWith('trib:')), []);
});

test('two agents that both look like the Director: no referral is heard, and the owner is told', async () => {
	const { c, feed, f } = setup('tribunal');
	const approvals = toApprovals(JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
	const impostor = { ...ROSTER[8], title: 'Compliance Enforcer' };
	feed(snap([...ROSTER.slice(0, 8), impostor], approvals));
	assert.deepEqual(c.scenes().filter((x) => x.startsWith('trib:')), []);
	const notice = c.els.find((e) => e.className === 'p67-notice')!;
	assert.match(notice.textContent ?? '', /More than one agent looks like the Director/);
});

test('"leave alive" is remembered: the verdict is not offered again', async () => {
	const { c, feed, f, run } = setup('tribunal');
	const approvals = toApprovals(JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
	const t = approvals.tribunals[0];
	feed(snap(ROSTER, approvals));
	await settle(50);
	await f(`/api/approvals/${t.approvalId}/approve`, { method: 'POST', body: '{}' });
	feed(snap(ROSTER, { tribunals: [], hires: [], others: [] }));
	await settle(100);
	feed(snap(ROSTER, { tribunals: [], hires: [], others: [] }));
	run(40_000);
	c.click(ACCUSED, { x: 0, y: 0 });
	await settle(100);
	const board = c.els.find((e) => e.className === 'p67-board')!;
	(board.querySelector('.p67-link') as unknown as HTMLButtonElement).click();
	assert.equal(board.hidden, true);
	assert.equal(c.tribunals().count, 0, 'the poster stops asking at once');
	// A fresh plant (a reload) scanning recent verdicts does not take it on again.
	const again = setupWith(f);
	again.feed(snap(ROSTER, { tribunals: [], hires: [], others: [] }));
	await settle(150);
	again.feed(snap(ROSTER, { tribunals: [], hires: [], others: [] }));
	assert.equal(again.c.tribunals().count, 0);
});
