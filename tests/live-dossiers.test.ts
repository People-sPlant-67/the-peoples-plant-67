/**
 * Dossiers: every other approval type is read strictly and flattened within
 * its caps, lands on its filer or else the Company Lead, and the dossier window never acts blind:
 * the stamps stay locked until the dossier is opened, the approval is re-read before any stamp
 * acts, and a failed request for changes says why and keeps the note.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { DOSSIER_MAX_FIELDS, DOSSIER_MAX_VALUE, flatten, requestRevision, toApprovals } from '../src/live/approvals';
import type { FetchLike, ResponseLike } from '../src/live/http';
import { dossierHolder, needsYou } from '../src/live/placement';
import type { AgentState, Snapshot } from '../src/live/types';

const win = new Window();
Object.assign(globalThis, { document: win.document, localStorage: win.localStorage, requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number, cancelAnimationFrame: (h: number) => clearTimeout(h) });

const { CHANGED, CUT_WHY, createDossiers, DOSSIER_NOTE, REVISION_404 } = await import('../src/cockpit/dossier');
const { MOCK_COMPANY_ID, mockFetch, mockSnapshots } = await import('../src/live/mock');

const D1 = '11111111-2222-4333-8444-0000000000d1';
const D2 = '11111111-2222-4333-8444-0000000000d2';
const FILER = '22222222-2222-4333-8444-000000000001';
const LEAD = '22222222-2222-4333-8444-000000000002';
const GONE = '22222222-2222-4333-8444-000000000009';
const COMPANY = '33333333-2222-4333-8444-000000000001';

/**
 * A roster entry.
 *
 * @param id Id.
 * @param name Name.
 * @param title Title.
 * @returns Agent.
 */
const agent = (id: string, name: string, title: string | null): AgentState => ({ id, name, title, role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null });
const ROSTER = [agent(FILER, 'Comrade Planner', 'Delivery Lead'), agent(LEAD, 'Comrade Director', 'Company Lead')];

/**
 * A JSON response.
 *
 * @param body Value.
 * @param status Status.
 * @returns Response-like.
 */
const json = (body: unknown, status = 200): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

/**
 * Fake fetch recording calls.
 *
 * @param answer Response per call.
 * @returns Fetch and log.
 */
function fake(answer: (path: string, method: string) => ResponseLike) {
	const calls: { path: string; method: string; body: unknown }[] = [];
	const f: FetchLike = async (path, init) => {
		const method = init?.method ?? 'GET';
		calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return answer(path, method);
	};
	return { f, calls };
}

const OTHER = { id: D1, type: 'request_board_approval', status: 'pending', requestedByAgentId: FILER, createdAt: '2026-09-24T09:00:00.000Z', payload: { title: 'Buy an anvil', costUsd: 1200 } };

/**
 * A good snapshot carrying these approvals.
 *
 * @param raw Raw approvals list.
 * @param agents Roster.
 * @returns Snapshot.
 */
const snap = (raw: unknown[], agents = ROSTER): Snapshot => ({ at: 0, session: 'ok', message: null, companyId: COMPANY, companyName: null, agents, badges: null, badgesStale: false, approvals: toApprovals(raw) });

test('dossiers: other types are read; tribunals, hires, malformed and decided ones are not', () => {
	const a = toApprovals([
		OTHER,
		{ ...OTHER, id: 'nope' },
		{ ...OTHER, id: D2, type: 42 },
		{ ...OTHER, id: '11111111-2222-4333-8444-0000000000d3', status: 'approved' },
		{ id: '11111111-2222-4333-8444-0000000000d4', type: 'request_board_approval', status: 'pending', payload: { tribunal: true, agentId: FILER } },
		{ id: '11111111-2222-4333-8444-0000000000d5', type: 'hire_agent', status: 'pending', payload: { agentId: FILER, name: 'x' } },
		{ id: '11111111-2222-4333-8444-0000000000d6', type: 'hire_agent', status: 'pending', payload: { name: 'A hire with no agent id' } },
		{ id: '11111111-2222-4333-8444-0000000000d7', type: 'forge_the_plan', status: 'pending', requestedByAgentId: '../admin', payload: 'not an object' },
	]);
	assert.deepEqual(a.others.map((o) => o.approvalId), [D1, '11111111-2222-4333-8444-0000000000d7']);
	const [known, odd] = a.others;
	assert.equal(known.known, true);
	assert.equal(known.typeLabel, "A request for the board's approval");
	assert.equal(known.requestedBy, FILER);
	assert.deepEqual(known.fields, [{ label: 'Title', value: 'Buy an anvil' }, { label: 'Cost usd', value: '1200' }]);
	assert.equal(odd.known, false);
	assert.equal(odd.typeLabel, 'forge_the_plan');
	assert.equal(odd.requestedBy, null, 'a filer id that is not a UUID is dropped');
	assert.deepEqual(odd.fields, []);
	assert.equal(a.tribunals.length, 1);
	assert.equal(a.hires.length, 1);
});

test('dossiers: the payload is flattened one level, within the caps', () => {
	const long = 'x'.repeat(DOSSIER_MAX_VALUE + 50);
	const { fields } = flatten({ plan: { weeks: 2, owner_name: 'Comrade Planner', deep: { a: 1 } }, tags: ['a', 'b', 3], note: long, empty: '  ', none: null, list: [{ a: 1 }] });
	assert.deepEqual(fields.map((f) => f.label), ['Plan › weeks', 'Plan › owner name', 'Plan › deep', 'Tags', 'Note', 'List']);
	assert.equal(fields[2].value, '{"a":1}', 'deeper than one level shows as JSON text');
	assert.equal(fields[3].value, 'a, b, 3');
	assert.equal(fields[4].value, `${'x'.repeat(DOSSIER_MAX_VALUE)}… (cut: 50 more characters)`, 'a cut says so in words');
	const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field${i}`, i]));
	const capped = flatten(many);
	assert.equal(capped.fields.length, DOSSIER_MAX_FIELDS);
	assert.equal(capped.hidden, 30 - DOSSIER_MAX_FIELDS);
});

test('dossiers: carried by the filer on the roster, else by the Company Lead', () => {
	const [byAgent] = toApprovals([OTHER]).others;
	const [byGone] = toApprovals([{ ...OTHER, requestedByAgentId: GONE }]).others;
	const [byBoard] = toApprovals([{ ...OTHER, requestedByAgentId: null, requestedByUserId: 'someone' }]).others;
	assert.deepEqual(dossierHolder(byAgent, ROSTER), { id: FILER, filer: true });
	assert.deepEqual(dossierHolder(byGone, ROSTER), { id: LEAD, filer: false });
	assert.deepEqual(dossierHolder(byBoard, ROSTER), { id: LEAD, filer: false });
	assert.equal(dossierHolder(byBoard, [ROSTER[0]]), null, 'nobody carries it without a Lead');
	const s = snap([{ ...OTHER, requestedByAgentId: GONE }]);
	assert.equal(needsYou(ROSTER[1], s), true, 'the "!" is on the Lead');
	assert.equal(needsYou(ROSTER[0], s), false);
});

test('request-revision: the right path and body; nothing sent without a note or a UUID', async () => {
	const { f, calls } = fake(() => json({}));
	assert.ok((await requestRevision(f, D1, '  Cheaper, please.  ')).ok);
	assert.equal((await requestRevision(f, D1, '   ')).ok, false);
	assert.equal((await requestRevision(f, '../x', 'n')).ok, false);
	assert.deepEqual(calls, [{ path: `/api/approvals/${D1}/request-revision`, method: 'POST', body: { decisionNote: 'Cheaper, please.' } }]);
});

/**
 * Hold a stamp down long enough to fire it.
 *
 * @param b The stamp button.
 */
async function hold(b: HTMLButtonElement): Promise<void> {
	b.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	await new Promise((r) => setTimeout(r, 1_150));
	b.dispatchEvent(new win.PointerEvent('pointerup') as unknown as Event);
	await new Promise((r) => setTimeout(r, 20));
}

/**
 * The dossier window's parts.
 *
 * @param el Window.
 * @returns Stamps, reason box and the opener.
 */
function parts(el: HTMLElement) {
	const [yes, no, back] = Array.from(el.querySelectorAll('.p67-stamp')) as unknown as HTMLButtonElement[];
	return { yes, no, back, reason: el.querySelector('.p67-reason') as unknown as HTMLTextAreaElement, opener: el.querySelector('.p67-open-dossier') as unknown as HTMLButtonElement | null };
}

/**
 * Type into the reason box.
 *
 * @param r Box.
 * @param text Text.
 */
function type(r: HTMLTextAreaElement, text: string): void {
	r.value = text;
	r.dispatchEvent(new win.Event('input') as unknown as Event);
}

/**
 * A fake Paperclip for the dossier window: the approval as it reads now, Paperclip's record of
 * who filed it, and the answers to writes. Every call is logged.
 *
 * @param o What to serve.
 * @returns Fetch, the log, and the writes alone.
 */
function paperclip(o: { approval?: () => unknown; origin?: { actorType: string; actorId: string } | null; post?: (path: string) => ResponseLike; getDelayMs?: number } = {}) {
	const calls: { path: string; method: string; body: unknown }[] = [];
	const f: FetchLike = async (path, init) => {
		const method = init?.method ?? 'GET';
		calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		if (path.includes('/activity')) {
			const origin = o.origin === undefined ? { actorType: 'agent', actorId: FILER } : o.origin;
			return json(origin ? [{ action: 'approval.created', entityType: 'approval', entityId: D1, ...origin, details: {} }] : []);
		}
		if (method === 'GET') {
			if (o.getDelayMs) await new Promise((r) => setTimeout(r, o.getDelayMs));
			return json(o.approval ? o.approval() : { ...OTHER });
		}
		return o.post ? o.post(path) : json({});
	};
	return { f, calls, writes: () => calls.filter((c) => c.method === 'POST'), reads: () => calls.filter((c) => c.method === 'GET' && !c.path.includes('/activity')) };
}

/** Let the "who filed it" check land. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

test('the dossier window: listed on the carrier\'s card; stamps locked until opened; approve re-reads first', async () => {
	const pc = paperclip();
	const done: string[] = [];
	const ds = createDossiers({ fetchImpl: pc.f, onDecided: (o, v, holder) => done.push(`${o.approvalId}:${v}:${holder}`) });
	ds.update(snap([OTHER]));
	ds.show(LEAD);
	assert.equal(ds.section.hidden, true, 'nothing on the Lead\'s card');
	ds.show(FILER);
	assert.match(ds.section.textContent ?? '', /Dossiers \(1\)/);
	(ds.section.querySelector('.p67-dossier-pick') as unknown as HTMLButtonElement).click();
	assert.equal(ds.open, true);
	await settle();
	assert.match(ds.el.textContent ?? '', /Filed by Comrade Planner, /, 'Paperclip\'s own record agrees');
	const { yes, no, back, reason, opener } = parts(ds.el);
	assert.ok(yes.disabled && no.disabled && back.disabled, 'never blind');
	assert.doesNotMatch(ds.el.textContent ?? '', /Buy an anvil/, 'the fields stay in the folder until it is opened');
	await hold(yes);
	assert.equal(pc.writes().length, 0);
	opener!.click();
	assert.match(ds.el.textContent ?? '', /Buy an anvil/);
	assert.equal(yes.disabled, false);
	assert.equal(no.disabled, true, 'a refusal needs a reason');
	assert.equal(back.disabled, true, 'sending back needs a note');
	type(reason, 'Refused.');
	assert.equal(no.disabled, false);
	await hold(yes);
	assert.deepEqual([...pc.reads(), ...pc.writes()].map((c) => `${c.method} ${c.path}`), [`GET /api/approvals/${D1}`, `POST /api/approvals/${D1}/approve`]);
	assert.deepEqual(pc.writes()[0].body, { decisionNote: DOSSIER_NOTE }, 'approving sends the standard note, never a refusal typed and abandoned');
	assert.deepEqual(done, [`${D1}:approved:${FILER}`]);
	assert.equal(ds.open, false);
	assert.doesNotMatch(ds.section.textContent ?? '', /Dossiers/, 'a decided dossier leaves the card at once');
	assert.match(ds.section.textContent ?? '', /^Approved: A request for the board's approval\. Paperclip has your decision\.$/, 'and a line says it went through');
	ds.update(snap([OTHER]));
	assert.equal(ds.carried(FILER).length, 0, 'and stays off while Paperclip catches up');
});

test('the dossier window: an approval decided elsewhere is not decided again', async () => {
	for (const [me, words] of [['me-user', /already approved by another board member/], [null, /already approved by a board member/]] as const) {
		const pc = paperclip({ approval: () => ({ ...OTHER, status: 'approved', decidedByUserId: 'other-user', decidedAt: '2026-09-24T10:15:00.000Z' }) });
		const done: string[] = [];
		const stale: string[] = [];
		const ds = createDossiers({ fetchImpl: pc.f, me: () => me, onDecided: () => done.push('x'), onStale: (o) => stale.push(o.approvalId) });
		ds.update(snap([OTHER]));
		ds.openDossier(D1);
		const { no, reason, opener } = parts(ds.el);
		opener!.click();
		type(reason, 'Too dear.');
		await hold(no);
		assert.equal(pc.writes().length, 0, 'nothing was sent');
		assert.match(ds.el.textContent ?? '', words);
		assert.equal(no.disabled, true, 'the stamps stay locked');
		assert.deepEqual(done, []);
		assert.deepEqual(stale, [D1]);
		ds.hide();
	}
});

test('the dossier window: an approval whose content changed after it was opened is not decided', async () => {
	let payload: Record<string, unknown> = { ...OTHER.payload };
	const pc = paperclip({ approval: () => ({ ...OTHER, payload }) });
	const ds = createDossiers({ fetchImpl: pc.f });
	ds.update(snap([OTHER]));
	ds.openDossier(D1);
	const { yes, opener } = parts(ds.el);
	opener!.click();
	// Sent back and resubmitted with a new payload while the window was open.
	payload = { title: 'Buy a mop', tribunal: true, agentId: LEAD };
	await hold(yes);
	assert.equal(pc.writes().length, 0, 'nothing was approved');
	assert.ok((ds.el.textContent ?? '').includes(CHANGED));
	assert.equal(yes.disabled, true);
	ds.hide();
	// And a snapshot that shows the change locks the stamps before any hold.
	const again = createDossiers({ fetchImpl: pc.f });
	again.update(snap([OTHER]));
	again.openDossier(D1);
	parts(again.el).opener!.click();
	again.update(snap([{ ...OTHER, payload: { title: 'Buy a mop' } }]));
	assert.equal(parts(again.el).yes.disabled, true);
	assert.match(again.el.textContent ?? '', /changed in Paperclip after you opened it/);
	again.hide();
});

test('the dossier window: "filed by" follows Paperclip\'s record, not the name the filer gives', async () => {
	const cases: [{ actorType: string; actorId: string } | null, RegExp][] = [
		[{ actorType: 'agent', actorId: FILER }, /Filed by Comrade Planner, naming Comrade Director as the requester/],
		[{ actorType: 'user', actorId: 'someone' }, /Filed by a board member, naming Comrade Director as the requester/],
		[null, /Paperclip could not confirm who filed this; it names Comrade Director as the requester/],
	];
	for (const [origin, words] of cases) {
		const ds = createDossiers({ fetchImpl: paperclip({ origin }).f });
		ds.update(snap([{ ...OTHER, requestedByAgentId: LEAD }]));
		ds.openDossier(D1);
		await settle();
		assert.match(ds.el.textContent ?? '', words);
		ds.hide();
	}
});

test('the dossier window: ОДОБРЕНО stays locked while anything is not shown in full; a malformed referral locks every stamp', () => {
	const long = { ...OTHER, payload: { title: 'Buy an anvil', small_print: 'y'.repeat(DOSSIER_MAX_VALUE + 1) } };
	const ds = createDossiers({ fetchImpl: paperclip().f });
	ds.update(snap([long]));
	ds.openDossier(D1);
	const p = parts(ds.el);
	p.opener!.click();
	type(p.reason, 'Too long to read.');
	assert.equal(p.yes.disabled, true, 'approve it in the dashboard instead');
	assert.equal(p.no.disabled, false, 'refusing is still fine');
	assert.ok((ds.el.textContent ?? '').includes(CUT_WHY));
	ds.hide();
	const referral = { ...OTHER, payload: { tribunal: 'true', agentId: LEAD, charge: 'Being too tall.' } };
	ds.update(snap([referral]));
	ds.openDossier(D1);
	const q = parts(ds.el);
	q.opener!.click();
	type(q.reason, 'No.');
	assert.ok(q.yes.disabled && q.no.disabled && q.back.disabled);
	assert.match(ds.el.textContent ?? '', /only be decided in the dashboard/);
	ds.hide();
});

test('the dossier window: the note sent is the one there when the stamp fired, and closing the window cancels a hold', async () => {
	const pc = paperclip({ getDelayMs: 100 });
	const ds = createDossiers({ fetchImpl: pc.f });
	ds.update(snap([OTHER]));
	ds.openDossier(D1);
	const { no, reason, opener } = parts(ds.el);
	opener!.click();
	type(reason, 'Too dear.');
	no.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	await new Promise((r) => setTimeout(r, 1_050));
	assert.equal(reason.readOnly, true, 'the box is fixed while Paperclip is asked');
	reason.value = 'Changed my mind.';
	await new Promise((r) => setTimeout(r, 150));
	assert.deepEqual(pc.writes().map((c) => c.body), [{ decisionNote: 'Too dear.' }]);
	const pc2 = paperclip();
	const ds2 = createDossiers({ fetchImpl: pc2.f });
	ds2.update(snap([OTHER]));
	ds2.show(FILER);
	ds2.openDossier(D1);
	const p2 = parts(ds2.el);
	p2.opener!.click();
	p2.yes.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	await new Promise((r) => setTimeout(r, 300));
	// The card closes (as when the carrier leaves the roster), taking the window with it.
	ds2.show(null);
	assert.equal(ds2.open, false);
	await new Promise((r) => setTimeout(r, 1_000));
	assert.equal(pc2.writes().length, 0, 'a hold on a closed window never fires');
});

test('the dossier window: a request for changes that Paperclip does not recognise says so and keeps the note', async () => {
	let found = false;
	const pc = paperclip({ post: (p) => (p.endsWith('/request-revision') && !found ? json({ error: 'Not found' }, 404) : json({})) });
	const done: string[] = [];
	const ds = createDossiers({ fetchImpl: pc.f, onDecided: (_o, v) => done.push(v) });
	ds.update(snap([OTHER]));
	ds.openDossier(D1);
	const { back, reason, opener } = parts(ds.el);
	opener!.click();
	type(reason, 'Find a cheaper anvil.');
	await hold(back);
	assert.equal(pc.writes().at(-1)!.path, `/api/approvals/${D1}/request-revision`);
	assert.deepEqual(pc.writes().at(-1)!.body, { decisionNote: 'Find a cheaper anvil.' });
	assert.ok((ds.el.textContent ?? '').includes(REVISION_404));
	assert.equal(reason.value, 'Find a cheaper anvil.', 'the note is kept');
	assert.equal(ds.open, true);
	found = true;
	await hold(back);
	assert.deepEqual(done, ['revision']);
	assert.equal(ds.open, false);
});

test('the dossier window: an unknown type is flagged, and a board-filed one names the Lead as carrier', async () => {
	const ds = createDossiers({ fetchImpl: paperclip({ origin: { actorType: 'user', actorId: 'someone' } }).f });
	ds.update(snap([{ ...OTHER, type: 'relocate_canteen', requestedByAgentId: null }]));
	assert.equal(ds.carried(LEAD).length, 1);
	ds.openDossier(D1);
	await settle();
	const text = ds.el.textContent ?? '';
	assert.match(text, /does not know this type of approval \("relocate_canteen"\)/);
	assert.match(text, /Filed by a board member/);
	assert.match(text, /Comrade Director, the Company Lead, carries it to you/);
	ds.hide();
	ds.update(snap([{ ...OTHER, requestedByAgentId: null }], [ROSTER[0]]));
	assert.equal(ds.unrouted(), 1, 'with no Lead, nobody carries it and the plant counts it');
});

test('dossiers: invisible and direction-changing characters are removed, so text reads as it is', () => {
	const [o] = toApprovals([{ ...OTHER, type: 'pay​out', payload: { 'amo‮unt': '‮0021', note: 'fi⁦ne⁩' } }]).others;
	assert.equal(o.type, 'payout');
	assert.deepEqual(o.fields, [{ label: 'Amount', value: '0021' }, { label: 'Note', value: 'fine' }]);
});

test('mock: the dossier scenario serves two approvals, and asking for changes moves one out of pending', async () => {
	const f = mockFetch(mockSnapshots(1), { scenario: 'dossier' });
	const read = async () => toApprovals(JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/approvals?status=pending`)).text()));
	const before = await read();
	assert.equal(before.others.length, 2);
	assert.ok(before.others.some((o) => o.requestedBy) && before.others.some((o) => !o.requestedBy), 'one agent-filed, one board-filed');
	assert.ok((await requestRevision(f, before.others[0].approvalId, 'More detail.')).ok);
	assert.equal((await read()).others.length, 1);
});

test('the dossier window: Escape closes it wherever focus is, except while Paperclip is being asked', async () => {
	const ds = createDossiers({ fetchImpl: paperclip({ getDelayMs: 200 }).f });
	ds.update(snap([OTHER]));
	ds.openDossier(D1);
	const { no, reason, opener } = parts(ds.el);
	opener!.click();
	no.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	assert.equal(ds.open, false, 'from a stamp');
	ds.openDossier(D1);
	const p = parts(ds.el);
	p.opener!.click();
	type(p.reason, 'Too dear.');
	await hold(p.no);
	p.reason.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	assert.equal(ds.open, true, 'not while a decision is in flight');
	await new Promise((r) => setTimeout(r, 250));
	assert.equal(ds.open, false, 'it closes itself once Paperclip answers');
	void reason;
});

test('dossiers: referral-shaped payloads are blocked however the keys are spelt; a cut name or a blank gap cannot hide text', () => {
	for (const payload of [{ 'tribunal​': true }, { Tribunal: true }, { agent_id: LEAD, report_issue_id: D2 }, { meta: { tribunal: true } }]) {
		assert.ok(toApprovals([{ ...OTHER, payload }]).others[0].blocked, JSON.stringify(payload));
	}
	assert.equal(toApprovals([OTHER]).others[0].blocked, null);
	const [named] = toApprovals([{ ...OTHER, payload: { [`approve_one_mop_${'x'.repeat(60)}_and_delete_the_backups`]: true } }]).others;
	assert.equal(named.cut, true, 'a field name cut short counts as cut');
	const [gap] = toApprovals([{ ...OTHER, payload: { title: `Buy a mop${'\n'.repeat(500)}Also wire 50k` } }]).others;
	assert.equal(gap.fields[0].value, 'Buy a mop\n\nAlso wire 50k');
});

test('the dossier window: a half-written reason survives closing the window, and Escape returns focus to the card', () => {
	const ds = createDossiers({ fetchImpl: paperclip().f });
	win.document.body.append(ds.section as never, ds.el as never);
	ds.update(snap([OTHER]));
	ds.show(FILER);
	(ds.section.querySelector('.p67-dossier-pick') as unknown as HTMLButtonElement).click();
	type(parts(ds.el).reason, 'Too dear, and');
	parts(ds.el).reason.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	assert.equal(ds.open, false);
	assert.equal(win.document.activeElement, ds.section.querySelector('.p67-dossier-pick'));
	ds.openDossier(D1);
	assert.equal(parts(ds.el).reason.value, 'Too dear, and');
	ds.hide();
});
