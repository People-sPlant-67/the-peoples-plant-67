/**
 * Approvals: tribunal referrals and hires are read strictly (UUIDs or nothing), the verdict
 * calls send what Paperclip expects and nothing without a UUID, and a departed agent's fate is
 * told apart. Plus the verdict window under happy-dom: never blind, reason required, approve
 * before terminate, and a failed termination retried without approving twice.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { approve, fate, reject, terminate, toApprovals } from '../src/live/approvals';
import type { FetchLike, ResponseLike } from '../src/live/http';
import { needsYou } from '../src/live/placement';
import type { AgentState, Snapshot } from '../src/live/types';

const win = new Window();
Object.assign(globalThis, { document: win.document, localStorage: win.localStorage, requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number, cancelAnimationFrame: (h: number) => clearTimeout(h) });

const A1 = '11111111-2222-4333-8444-000000000001';
const A2 = '11111111-2222-4333-8444-000000000002';
const AG = '22222222-2222-4333-8444-000000000001';
const REP = '33333333-2222-4333-8444-000000000001';

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
function fake(answer: (path: string) => ResponseLike) {
	const calls: { path: string; method: string; body: unknown }[] = [];
	const f: FetchLike = async (path, init) => {
		calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return answer(path);
	};
	return { f, calls };
}

const TRIBUNAL = {
	id: A1, type: 'request_board_approval', status: 'pending',
	payload: { tribunal: true, agentId: AG, agentName: 'Alexei', strikes: 3, charge: 'Wrecking the Plan.', reportIssueId: REP, probation: true,
		strikeList: [{ date: '2026-09-01', finding: 'Broke the build.', serious: false }, { date: '2026-09-02', finding: 'Broke it again.', serious: true }, 'junk'] },
};

test('a tribunal referral is read in full; malformed ones are skipped, and one trial per comrade', () => {
	const a = toApprovals([
		TRIBUNAL,
		{ ...TRIBUNAL, id: A2 },
		{ ...TRIBUNAL, id: 'not-a-uuid' },
		{ ...TRIBUNAL, id: '44444444-2222-4333-8444-000000000009', payload: { ...TRIBUNAL.payload, agentId: '../admin' } },
		{ ...TRIBUNAL, id: '44444444-2222-4333-8444-000000000008', payload: { ...TRIBUNAL.payload, tribunal: 'yes' } },
		{ ...TRIBUNAL, id: '44444444-2222-4333-8444-000000000007', status: 'approved' },
		{ id: '44444444-2222-4333-8444-000000000006', type: 'budget_override_required', status: 'pending', payload: { agentId: AG } },
	]);
	assert.equal(a.tribunals.length, 1);
	const t = a.tribunals[0];
	assert.equal(t.approvalId, A1);
	assert.equal(t.agentId, AG);
	assert.equal(t.strikes, 3);
	assert.equal(t.probation, true);
	assert.equal(t.reportIssueId, REP);
	assert.deepEqual(t.strikeList.map((s) => s.serious), [false, true]);
	assert.equal(a.hires.length, 0);
});

test('a referral with a bad report id keeps the case but no link; missing text gets a sentence', () => {
	const a = toApprovals({ data: [{ ...TRIBUNAL, payload: { tribunal: true, agentId: AG, reportIssueId: 'javascript:alert(1)' } }] });
	assert.equal(a.tribunals[0].reportIssueId, null);
	assert.match(a.tribunals[0].charge, /^The Director .+\.$/);
	assert.equal(a.tribunals[0].strikes, 0);
});

test('a hire request is read; one without a UUID agent is skipped', () => {
	const a = toApprovals([
		{ id: A2, type: 'hire_agent', status: 'pending', payload: { agentId: AG, name: 'Nadia', title: 'Executor', role: 'engineer', capabilities: 'x'.repeat(900) } },
		{ id: A1, type: 'hire_agent', status: 'pending', payload: { name: 'No id' } },
	]);
	assert.equal(a.hires.length, 1);
	assert.equal(a.hires[0].name, 'Nadia');
	assert.equal(a.hires[0].about!.length, 400);
});

test('needsYou: error, awaiting a hire, or on trial', () => {
	const ag = (over: Partial<AgentState> = {}): AgentState => ({ id: AG, name: 'x', title: null, role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null, ...over });
	const s = (approvals: Snapshot['approvals']): Snapshot => ({ at: 0, session: 'ok', message: null, companyId: null, companyName: null, agents: [], badges: null, badgesStale: false, approvals });
	assert.equal(needsYou(ag(), s(null)), false);
	assert.equal(needsYou(ag({ status: 'pending_approval' }), s(null)), true);
	assert.equal(needsYou(ag(), s(toApprovals([TRIBUNAL]))), true);
});

test('verdict calls: the right paths and bodies, and nothing sent without a UUID or a reason', async () => {
	const { f, calls } = fake(() => json({}));
	assert.ok((await approve(f, A1, 'Guilty.')).ok);
	assert.ok((await reject(f, A1, '  Not proven.  ')).ok);
	assert.ok((await terminate(f, AG)).ok);
	assert.deepEqual(calls, [
		{ path: `/api/approvals/${A1}/approve`, method: 'POST', body: { decisionNote: 'Guilty.' } },
		{ path: `/api/approvals/${A1}/reject`, method: 'POST', body: { decisionNote: 'Not proven.' } },
		{ path: `/api/agents/${AG}/terminate`, method: 'POST', body: {} },
	]);
	assert.equal((await reject(f, A1, '   ')).ok, false);
	assert.equal((await approve(f, '../x', 'n')).ok, false);
	assert.equal((await terminate(f, 'abc')).ok, false);
	assert.equal(calls.length, 3);
});

test('fate: terminated, gone (404), another status, or unknown when the check fails', async () => {
	assert.equal(await fate(fake(() => json({ status: 'terminated' })).f, AG), 'terminated');
	assert.equal(await fate(fake(() => json({ error: 'no' }, 404)).f, AG), 'gone');
	assert.equal(await fate(fake(() => json({ status: 'paused' })).f, AG), 'paused');
	assert.equal(await fate(fake(() => json({}, 500)).f, AG), null);
	assert.equal(await fate(fake(() => json({})).f, 'nope'), null);
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

test('the verdict window: locked until the report is opened; guilty approves, then terminates; a failed termination retries alone', async () => {
	const { createBoard } = await import('../src/cockpit/verdict');
	let terminateOk = false;
	const { f, calls } = fake((p) => (p.endsWith('/terminate') && !terminateOk ? json({ error: 'Busy' }, 500) : json({})));
	const done: string[] = [];
	const board = createBoard({ fetchImpl: f, onTribunal: (id, v) => done.push(`${id}:${v}`), onHire: () => {} });
	board.showTribunal(toApprovals([TRIBUNAL]).tribunals[0], { name: 'Alexei', title: 'Executor' }, async () => null);
	await new Promise((r) => setTimeout(r, 10));
	const [guilty, pardon] = Array.from(board.el.querySelectorAll('.p67-stamp')) as unknown as HTMLButtonElement[];
	assert.equal(guilty.disabled, true, 'never blind');
	assert.equal(pardon.disabled, true);
	await hold(guilty);
	assert.equal(calls.length, 0);
	(board.el.querySelector('.p67-report') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('click') as unknown as Event);
	assert.equal(guilty.disabled, false);
	assert.equal(pardon.disabled, true, 'a pardon needs a reason');
	// A quick click is not a hold.
	guilty.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	guilty.dispatchEvent(new win.PointerEvent('pointerup') as unknown as Event);
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(calls.length, 0);
	await hold(guilty);
	assert.deepEqual(calls.map((c) => c.path), [`/api/approvals/${A1}/approve`, `/api/agents/${AG}/terminate`]);
	assert.ok(board.unfinished(A1), 'the verdict is on record but not carried out');
	assert.match(board.el.textContent ?? '', /termination did not go through/);
	assert.equal(done.length, 0);
	terminateOk = true;
	await hold(guilty);
	assert.deepEqual(calls.map((c) => c.path).slice(2), [`/api/agents/${AG}/terminate`], 'the retry does not approve twice');
	assert.deepEqual(done, [`${A1}:guilty`]);
	assert.equal(board.open, false);
	assert.equal(board.unfinished(A1), false);
});

test('the verdict window: a pardon sends the written reason', async () => {
	const { createBoard } = await import('../src/cockpit/verdict');
	const { f, calls } = fake(() => json({}));
	const done: string[] = [];
	const board = createBoard({ fetchImpl: f, onTribunal: (_id, v) => done.push(v), onHire: () => {} });
	board.showTribunal(toApprovals([TRIBUNAL]).tribunals[0], { name: 'Alexei', title: null }, async () => null);
	await new Promise((r) => setTimeout(r, 10));
	(board.el.querySelector('.p67-report') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('auxclick') as unknown as Event);
	const pardon = board.el.querySelectorAll('.p67-stamp')[1] as unknown as HTMLButtonElement;
	const reason = board.el.querySelector('.p67-reason') as unknown as HTMLTextAreaElement;
	assert.equal(pardon.disabled, true, 'a pardon needs a reason');
	reason.value = 'The tests were flaky, not the comrade.';
	reason.dispatchEvent(new win.Event('input') as unknown as Event);
	assert.equal(pardon.disabled, false, 'a middle-click on the report counts as opening it');
	await hold(pardon);
	assert.deepEqual(calls, [{ path: `/api/approvals/${A1}/reject`, method: 'POST', body: { decisionNote: 'The tests were flaky, not the comrade.' } }]);
	assert.deepEqual(done, ['pardoned']);
});

test('the verdict window: a failed check keeps ВИНОВЕН locked, and names the roster\'s comrade', async () => {
	const { createBoard } = await import('../src/cockpit/verdict');
	const { f, calls } = fake(() => json({}));
	const board = createBoard({ fetchImpl: f, onTribunal: () => {}, onHire: () => {} });
	const forged = toApprovals([{ ...TRIBUNAL, payload: { ...TRIBUNAL.payload, agentName: 'Shock Worker' } }]).tribunals[0];
	board.showTribunal(forged, { name: 'Comrade Director', title: 'Company Lead' }, async () => 'The report was not filed by the Director of Operational Hygiene, so the plant will not act on this referral.');
	await new Promise((r) => setTimeout(r, 10));
	(board.el.querySelector('.p67-report') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('click') as unknown as Event);
	const guilty = board.el.querySelector('.p67-stamp') as unknown as HTMLButtonElement;
	assert.equal(guilty.disabled, true);
	assert.equal(board.el.querySelector('h2')!.textContent, 'Comrade Director', 'the window names who would really be terminated');
	assert.match(board.el.textContent ?? '', /the referral calls them "Shock Worker"/);
	assert.match(board.el.textContent ?? '', /not filed by the Director/);
	await hold(guilty);
	assert.equal(calls.length, 0);
	board.hide();
});

test('the verdict window: a decision in flight cannot be replaced or closed, and an unfinished verdict survives a reload', async () => {
	const { createBoard, UNFINISHED_KEY } = await import('../src/cockpit/verdict');
	win.localStorage.removeItem(UNFINISHED_KEY);
	let release: () => void = () => {};
	const f: FetchLike = async (path) => {
		if (path.endsWith('/terminate')) { await new Promise<void>((r) => { release = r; }); return json({ error: 'Busy' }, 500); }
		return json({});
	};
	const board = createBoard({ fetchImpl: f, onTribunal: () => {}, onHire: () => {} });
	const c = toApprovals([TRIBUNAL]).tribunals[0];
	board.showTribunal(c, { name: 'Alexei', title: null }, async () => null);
	await new Promise((r) => setTimeout(r, 10));
	(board.el.querySelector('.p67-report') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('click') as unknown as Event);
	const guilty = board.el.querySelector('.p67-stamp') as unknown as HTMLButtonElement;
	guilty.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	await new Promise((r) => setTimeout(r, 1_150));
	assert.equal(board.deciding, A1);
	board.showHire({ approvalId: A2, agentId: AG, name: 'Nadia', title: null, role: null, about: null, replaces: null, rule: null });
	board.hide();
	assert.equal(board.el.querySelector('h2')!.textContent, 'Alexei', 'still the verdict window');
	assert.equal(board.open, true);
	assert.match(board.el.textContent ?? '', /Waiting for Paperclip/);
	release();
	await new Promise((r) => setTimeout(r, 20));
	assert.match(board.el.textContent ?? '', /termination did not go through/, 'the failure is shown, not lost');
	const again = createBoard({ fetchImpl: f, onTribunal: () => {}, onHire: () => {} });
	assert.ok(again.unfinished(A1), 'a reload still knows the verdict needs finishing');
	assert.equal(again.unfinishedCases()[0].agentId, AG);
	win.localStorage.removeItem(UNFINISHED_KEY);
});

test('the verdict window: an approve that got no answer is checked with Paperclip before giving up', async () => {
	const { createBoard, UNFINISHED_KEY } = await import('../src/cockpit/verdict');
	win.localStorage.removeItem(UNFINISHED_KEY);
	for (const applied of [true, false]) {
		const calls: string[] = [];
		const f: FetchLike = async (path, init) => {
			calls.push(`${init?.method ?? 'GET'} ${path}`);
			if (path.endsWith('/approve')) throw new TypeError('network down');
			if (path === `/api/approvals/${A1}`) return json({ id: A1, type: 'request_board_approval', status: applied ? 'approved' : 'pending', payload: { tribunal: true, agentId: AG } });
			return json({});
		};
		const done: string[] = [];
		const board = createBoard({ fetchImpl: f, onTribunal: (_id, v) => done.push(v), onHire: () => {} });
		board.showTribunal(toApprovals([TRIBUNAL]).tribunals[0], { name: 'Alexei', title: null }, async () => null);
		await new Promise((r) => setTimeout(r, 10));
		(board.el.querySelector('.p67-report') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('click') as unknown as Event);
		await hold(board.el.querySelector('.p67-stamp') as unknown as HTMLButtonElement);
		if (applied) {
			assert.deepEqual(calls, [`POST /api/approvals/${A1}/approve`, `GET /api/approvals/${A1}`, `POST /api/agents/${AG}/terminate`], 'recorded after all, so it is carried out');
			assert.deepEqual(done, ['guilty']);
		} else {
			assert.deepEqual(calls, [`POST /api/approvals/${A1}/approve`, `GET /api/approvals/${A1}`]);
			assert.match(board.el.textContent ?? '', /may not have been recorded/);
			assert.equal(done.length, 0);
			board.hide();
		}
	}
	win.localStorage.removeItem(UNFINISHED_KEY);
});

test("the last word before a termination: a refused accused (the owner's own seat) is never approved or terminated", async () => {
	const { createBoard } = await import('../src/cockpit/verdict');
	const { SEAT_REFUSAL } = await import('../src/cockpit/ceremonies');
	const { f, calls } = fake(() => json({}));
	const board = createBoard({ fetchImpl: f, onTribunal: () => {}, onHire: () => {}, refuse: (id) => (id === AG ? SEAT_REFUSAL : null) });
	board.showTribunal(toApprovals([TRIBUNAL]).tribunals[0], { name: 'Alexei', title: null }, async () => null);
	await new Promise((r) => setTimeout(r, 10));
	(board.el.querySelector('.p67-report') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('click') as unknown as Event);
	await hold(board.el.querySelector('.p67-stamp') as unknown as HTMLButtonElement);
	assert.equal(calls.length, 0, 'nothing is sent');
	assert.match(board.el.textContent ?? '', /your own seat/);
});
