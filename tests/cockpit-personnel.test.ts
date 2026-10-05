/**
 * The Personnel File: the stamp rules per status (and never on the owner's own seat),
 * reading only the named fields out of records that carry secrets, re-reading the agent before
 * any stamp acts, and the tab's refresh and in-flight lock.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import type { FetchLike, ResponseLike } from '../src/live/http';
import { OWN_SEAT, boardAct, readPersonnel, stampRules, toShift } from '../src/live/personnel';
import type { AgentState } from '../src/live/types';

const win = new Window();
Object.assign(globalThis, { document: win.document, localStorage: win.localStorage, requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number, cancelAnimationFrame: (h: number) => clearTimeout(h) });

const { budgetWords, createPersonnel, shiftLength } = await import('../src/cockpit/personnel');
const { agoWords } = await import('../src/cockpit/words');
const { MOCK_COMPANY_ID, MOCK_EXTRA, mockFetch, mockSnapshots } = await import('../src/live/mock');

const A = '22222222-2222-4333-8444-000000000001';
const B = '22222222-2222-4333-8444-000000000002';
const BOSS = '22222222-2222-4333-8444-000000000003';
const COMPANY = '33333333-2222-4333-8444-000000000001';

/**
 * A roster entry.
 *
 * @param id Id.
 * @param status Status.
 * @param name Name.
 * @returns Agent.
 */
const agent = (id: string, status: string, name = 'Shock Worker No. 3'): AgentState => ({ id, name, title: 'Generalist Executor', role: null, status, pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: BOSS, urlKey: null });

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
function fake(answer: (path: string, method: string) => ResponseLike | Promise<ResponseLike>) {
	const calls: { path: string; method: string; body: unknown }[] = [];
	const f: FetchLike = async (path, init) => {
		const method = init?.method ?? 'GET';
		calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return answer(path, method);
	};
	return { f, calls };
}

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
 * Wait for pending promises.
 *
 * @param ms How long.
 */
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('stamp rules: each status unlocks only the stamps that apply', () => {
	const on = (status: string) => Object.entries(stampRules(agent(A, status))).filter(([, why]) => why === null).map(([k]) => k);
	assert.deepEqual(on('idle'), ['pause', 'wake']);
	assert.deepEqual(on('running'), ['pause']);
	assert.deepEqual(on('paused'), ['resume']);
	assert.deepEqual(on('error'), ['pause', 'clear']);
	for (const s of ['pending_approval', 'terminated', 'on_holiday']) assert.deepEqual(on(s), [], s);
	// Every locked stamp says why, in a sentence.
	for (const why of Object.values(stampRules(agent(A, 'paused')))) if (why) assert.match(why, /\.$/);
});

test('stamp rules: the owner\'s manual seat is never stamped, whatever its status', () => {
	for (const s of ['idle', 'paused', 'error', 'running']) {
		assert.deepEqual(Object.values(stampRules(agent(A, s, 'Chairman (Manual Seat)'))), [OWN_SEAT, OWN_SEAT, OWN_SEAT, OWN_SEAT]);
	}
	// The lock is on the name alone: an agent that merely has "manual seat" in its title keeps its stamps.
	const engineer = { ...agent(A, 'running', 'Comrade Planner'), title: 'Engineer, Manual Seat Liaison' };
	assert.equal(stampRules(engineer).pause, null);
});

test('a run record keeps only status, times and a capped error line', () => {
	const s = toShift({ status: 'failed', startedAt: '2026-09-28T10:00:00Z', finishedAt: '2026-09-28T10:06:00Z', error: 'x'.repeat(500), stdoutExcerpt: 'SECRET', usageJson: { t: 1 } });
	assert.deepEqual(Object.keys(s ?? {}).sort(), ['error', 'finishedAt', 'startedAt', 'status']);
	assert.equal(s?.error?.length, 200);
	assert.equal(toShift({ status: 'queued', createdAt: '2026-09-28T10:00:00Z' })?.startedAt, '2026-09-28T10:00:00Z');
	assert.equal(toShift({ nope: 1 }), null);
	assert.equal(toShift('run'), null);
});

test('reading a file asks for five of this comrade\'s runs, copies only named fields, and survives a runs failure', async () => {
	const { f, calls } = fake((path) => path.includes('heartbeat-runs')
		? json({ error: 'boom' }, 500)
		: json({ id: A, budgetMonthlyCents: 5000, spentMonthlyCents: 1420, pausedAt: null, lastHeartbeatAt: '2026-09-28T10:00:00Z', reportsTo: BOSS, adapterConfig: { apiKey: 'SECRET' } }));
	const r = await readPersonnel(f, COMPANY, A);
	assert.ok(r.ok);
	assert.deepEqual(calls.map((c) => c.path), [`/api/agents/${A}`, `/api/companies/${COMPANY}/heartbeat-runs?agentId=${A}&limit=5`]);
	assert.equal(r.file.shifts, null);
	assert.equal(r.file.spentMonthlyCents, 1420);
	assert.ok(!JSON.stringify(r.file).includes('SECRET'));
	// A reportsTo that is not a UUID is dropped rather than looked up.
	const odd = fake(() => json({ reportsTo: '../x' }));
	const r2 = await readPersonnel(odd.f, COMPANY, A);
	assert.ok(r2.ok && r2.file.reportsTo === null);
	// Ids that are not UUIDs never reach a request path.
	const none = fake(() => json({}));
	assert.equal((await readPersonnel(none.f, COMPANY, '../../x')).ok, false);
	assert.equal(none.calls.length, 0);
});

test('a stamp reads the agent again first, and sends nothing when the status moved on', async () => {
	const { f, calls } = fake(() => json({ id: A, name: 'Shock Worker No. 3', status: 'paused' }));
	const r = await boardAct(f, A, 'pause');
	assert.equal(r.ok, false);
	assert.match(r.words, /^Nothing was sent, because Paperclip has them as "paused" now\. They are already paused\.$/);
	assert.deepEqual(calls.map((c) => c.method), ['GET']);
	// The seat check runs on Paperclip's own record too, not just the plant's roster.
	const seat = fake(() => json({ id: A, name: 'Chairman (Manual Seat)', status: 'idle' }));
	assert.equal((await boardAct(seat.f, A, 'wake')).ok, false);
	assert.equal(seat.calls.length, 1);
});

test('each stamp posts to its own path; a wake-up names itself and carries a fresh idempotency key', async () => {
	const bodies: unknown[] = [];
	for (const [action, status, path] of [['pause', 'running', 'pause'], ['resume', 'paused', 'resume'], ['clear', 'error', 'clear-error'], ['wake', 'idle', 'wakeup']] as const) {
		const { f, calls } = fake((_p, m) => m === 'GET' ? json({ id: A, name: 'Comrade Planner', status }) : json({ id: 'r', status: 'queued' }, action === 'wake' ? 202 : 200));
		const r = await boardAct(f, A, action);
		assert.ok(r.ok, action);
		bodies.push(calls[1].body);
		assert.equal(calls[1].path, `/api/agents/${A}/${path}`);
	}
	const wake = bodies[3] as Record<string, unknown>;
	assert.equal(wake.source, 'on_demand');
	assert.match(String(wake.reason), /People's Plant/);
	assert.ok(typeof wake.idempotencyKey === 'string' && wake.idempotencyKey.length >= 16);
	assert.deepEqual(bodies.slice(0, 3), [{}, {}, {}]);
});

test('a skipped wake-up and a refusal both say so, quoting Paperclip', async () => {
	const skip = fake((_p, m) => m === 'GET' ? json({ name: 'Comrade Planner', status: 'idle' }) : json({ status: 'skipped', message: 'Wakeup was skipped.' }, 202));
	const r = await boardAct(skip.f, A, 'wake');
	assert.equal(r.ok, false);
	assert.equal(r.words, 'Paperclip skipped the wake-up. It said: "Wakeup was skipped".');
	const no = fake((_p, m) => m === 'GET' ? json({ name: 'Comrade Planner', status: 'error' }) : json({ error: "Repair this agent's reporting chain before clearing its error" }, 409));
	const r2 = await boardAct(no.f, A, 'clear');
	assert.equal(r2.ok, false);
	assert.match(r2.words, /^Nothing changed.*Repair this agent's reporting chain/);
});

test('words: heartbeat age, budget and shift length', () => {
	const now = Date.parse('2026-09-28T12:00:00Z');
	assert.equal(agoWords(null, now), 'Never.');
	assert.equal(agoWords('2026-09-28T11:59:40Z', now), 'Just now.');
	assert.equal(agoWords('2026-09-28T11:48:00Z', now), '12 minutes ago.');
	assert.equal(agoWords('2026-09-28T11:00:00Z', now), '1 hour ago.');
	assert.equal(agoWords('2026-09-24T12:00:00Z', now), '4 days ago.');
	const f = { budgetMonthlyCents: 5000, spentMonthlyCents: 1420, pausedAt: null, lastHeartbeatAt: null, reportsTo: null, shifts: [] };
	assert.deepEqual(budgetWords(f), { words: '$14.20 of $50.00 this month.', share: 0.284 });
	assert.deepEqual(budgetWords({ ...f, budgetMonthlyCents: 0 }), { words: '$14.20 spent this month, with no monthly budget set.', share: null });
	assert.deepEqual(budgetWords({ ...f, spentMonthlyCents: 9000 }), { words: '$90.00 of $50.00 this month, which is over budget.', share: 1 });
	assert.deepEqual(budgetWords({ ...f, spentMonthlyCents: null }), { words: 'Paperclip did not say what they have spent of $50.00 this month.', share: null });
	assert.equal(shiftLength({ status: 'succeeded', startedAt: '2026-09-28T10:00:00Z', finishedAt: '2026-09-28T11:05:00Z', error: null }, now), '1 h 5 min');
	assert.equal(shiftLength({ status: 'running', startedAt: '2026-09-28T11:54:00Z', finishedAt: null, error: null }, now), '6 min');
	assert.equal(shiftLength({ status: 'queued', startedAt: null, finishedAt: null, error: null }, now), '');
});

test('the tab reads nothing until it shows, then stamps, reports, and locks while in flight', async () => {
	let status = 'idle';
	let release: (() => void) | null = null;
	const { f, calls } = fake(async (path, method) => {
		if (method === 'POST') {
			await new Promise<void>((r) => { release = r; });
			status = 'running';
			return json({ id: 'r', status: 'queued' }, 202);
		}
		if (path.includes('heartbeat-runs')) return json([{ status: 'succeeded', startedAt: '2026-09-28T10:00:00Z', finishedAt: '2026-09-28T10:06:00Z', stdoutExcerpt: 'SECRET' }]);
		return json({ id: A, name: 'Shock Worker No. 3', status, budgetMonthlyCents: 5000, spentMonthlyCents: 100, reportsTo: BOSS, adapterConfig: { k: 'SECRET' } });
	});
	const acted: string[] = [];
	const p = createPersonnel({ fetchImpl: f, companyId: () => COMPANY, nameOf: (id) => id === BOSS ? 'Comrade Director' : null, onActed: (id, a) => acted.push(`${id}:${a}`) });
	p.show(agent(A, 'idle'), false);
	await tick();
	assert.equal(calls.length, 0);
	p.show(agent(A, 'idle'), true);
	await tick();
	assert.equal(calls.length, 2);
	const text = (): string => p.el.textContent ?? '';
	assert.match(text(), /Comrade Director\./);
	assert.match(text(), /\$1\.00 of \$50\.00 this month\./);
	assert.ok(!text().includes('SECRET'));
	const stamps = Array.from(p.el.querySelectorAll('.p67-stamp')) as unknown as HTMLButtonElement[];
	assert.deepEqual(stamps.map((s) => s.disabled), [false, true, false, true]);
	const wake = stamps[2];
	const holding = hold(wake);
	await new Promise((r) => setTimeout(r, 1_200));
	// In flight: all four are locked, so a second hold cannot race the first.
	assert.equal(p.busy, true);
	assert.deepEqual(stamps.map((s) => s.disabled), [true, true, true, true]);
	release!();
	await holding;
	await tick(30);
	assert.equal(p.busy, false);
	assert.deepEqual(acted, [`${A}:wake`]);
	assert.match(text(), /Woken\. Paperclip has queued a new shift for them\./);
	p.show(null, false);
});

test('an answer for a comrade the owner has left does not land on the next one\'s file', async () => {
	let release: (() => void) | null = null;
	const { f } = fake(async (path, method) => {
		if (method === 'POST') { await new Promise<void>((r) => { release = r; }); return json({ id: A, status: 'paused' }); }
		if (path.includes('heartbeat-runs')) return json([]);
		return json({ id: path.includes(A) ? A : B, name: 'Comrade Planner', status: 'idle' });
	});
	const p = createPersonnel({ fetchImpl: f, companyId: () => COMPANY, nameOf: () => null });
	p.show(agent(A, 'idle', 'Comrade Planner'), true);
	await tick();
	const pause = p.el.querySelector('.p67-stamp') as unknown as HTMLButtonElement;
	const holding = hold(pause);
	await new Promise((r) => setTimeout(r, 1_200));
	p.show(agent(B, 'idle', 'Comrade Critic'), true);
	release!();
	await holding;
	await tick(30);
	assert.ok(!(p.el.textContent ?? '').includes('Paused.'));
	assert.match(p.el.textContent ?? '', /No shifts on record yet\./);
	p.show(null, false);
});

test('the mock: clearing the stuck comrade\'s error puts them back to idle, and the seat stays locked', async () => {
	const f = mockFetch(mockSnapshots(67), { scenario: 'personnel' });
	const roster = async (): Promise<AgentState[]> => JSON.parse(await (await f(`/api/companies/${MOCK_COMPANY_ID}/agents`)).text()) as AgentState[];
	const first = await roster();
	const stuck = first.find((a) => a.name === 'Shock Worker No. 3')!;
	assert.equal(stuck.status, 'error');
	const seat = first.find((a) => a.id === MOCK_EXTRA.seat)!;
	assert.ok(Object.values(stampRules(seat)).every((w) => w === OWN_SEAT));
	assert.equal((await boardAct(f, seat.id, 'resume')).ok, false);
	const r = await boardAct(f, stuck.id, 'clear');
	assert.ok(r.ok, r.words);
	assert.equal((await roster()).find((a) => a.id === stuck.id)?.status, 'idle');
	const file = await readPersonnel(f, MOCK_COMPANY_ID, stuck.id);
	assert.ok(file.ok && file.file.shifts && file.file.shifts.length === 5);
	assert.ok(!JSON.stringify(file).includes('MOCK_SECRET'));
});

/**
 * A fetch serving one comrade whose answers can be held back.
 *
 * @param status Their status, read on every GET.
 * @returns Fetch, call log, and a way to release held answers.
 */
function slow(status: () => string, onPost: () => void = () => {}) {
	const held: (() => void)[] = [];
	let holdNext = 0;
	const { f, calls } = fake(async (path, method) => {
		if (holdNext > 0) { holdNext--; await new Promise<void>((r) => held.push(r)); }
		if (method === 'POST') { onPost(); return json({ id: 'r', status: 'queued' }, 202); }
		if (path.includes('heartbeat-runs')) return json([]);
		const id = path.split('/').pop();
		return json({ id, name: 'Comrade Planner', status: status(), budgetMonthlyCents: 5000, spentMonthlyCents: calls.length * 100, reportsTo: null });
	});
	return { f, calls, hold: (n: number) => { holdNext = n; }, release: () => held.splice(0).forEach((r) => r()) };
}

test('reads stop when the tab or the card closes, and skip a hidden browser tab', async (t) => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	let hidden = false;
	const { f, calls } = slow(() => 'idle');
	const p = createPersonnel({ fetchImpl: f, companyId: () => COMPANY, nameOf: () => null, isHidden: () => hidden });
	p.show(agent(A, 'idle'), true);
	await tick();
	assert.equal(calls.length, 2);
	t.mock.timers.tick(10_000);
	await tick();
	assert.equal(calls.length, 4);
	hidden = true;
	t.mock.timers.tick(10_000);
	await tick();
	assert.equal(calls.length, 4, 'nothing is read while the browser tab is hidden');
	hidden = false;
	p.show(agent(A, 'idle'), false);
	t.mock.timers.tick(30_000);
	await tick();
	assert.equal(calls.length, 4, 'nothing is read on the Directives tab');
	p.show(agent(A, 'idle'), true);
	await tick();
	p.show(null, false);
	const after = calls.length;
	t.mock.timers.tick(30_000);
	await tick();
	assert.equal(calls.length, after, 'nothing is read once the card is closed');
});

test('a slow read never paints over a fresher one', async () => {
	const { f, hold, release } = slow(() => 'idle');
	const p = createPersonnel({ fetchImpl: f, companyId: () => COMPANY, nameOf: () => null });
	hold(2);
	p.show(agent(A, 'idle'), true);
	await tick();
	// A status change starts a second read, which answers first.
	p.update(agent(A, 'running'));
	await tick(20);
	const fresh = p.el.textContent;
	release();
	await tick(20);
	assert.equal(p.el.textContent, fresh);
	p.show(null, false);
});

test('after moving on mid-stamp, the next comrade gets their stamps back and a plain line', async () => {
	const { f, hold, release } = slow(() => 'idle');
	const p = createPersonnel({ fetchImpl: f, companyId: () => COMPANY, nameOf: () => null });
	p.show(agent(A, 'idle', 'Comrade Planner'), true);
	await tick();
	const stampsOf = () => Array.from(p.el.querySelectorAll('.p67-stamp')) as unknown as HTMLButtonElement[];
	hold(1);
	const holding = hold2(stampsOf()[0]);
	await new Promise((r) => setTimeout(r, 1_200));
	p.show(agent(B, 'idle', 'Comrade Critic'), true);
	await tick();
	assert.match(p.el.querySelector('.p67-file-why')?.textContent ?? '', /A stamp on Comrade Planner is still being applied\./);
	release();
	await holding;
	await tick(30);
	assert.deepEqual(stampsOf().map((s) => s.disabled), [false, true, false, true]);
	p.show(null, false);
});

/**
 * Hold a stamp (the shared helper, under a name that does not clash with fake's hold).
 *
 * @param b Stamp.
 */
const hold2 = (b: HTMLButtonElement): Promise<void> => hold(b);

test('after a stamp works, the stamps wait for the roster to show it, and focus stays in the file', async () => {
	let status = 'idle';
	const { f } = slow(() => status, () => { status = 'paused'; });
	const p = createPersonnel({ fetchImpl: f, companyId: () => COMPANY, nameOf: () => null });
	(win.document.body as unknown as HTMLElement).append(p.el);
	p.show(agent(A, 'idle', 'Comrade Planner'), true);
	await tick();
	const stampsOf = () => Array.from(p.el.querySelectorAll('.p67-stamp')) as unknown as HTMLButtonElement[];
	stampsOf()[0].focus();
	await hold(stampsOf()[0]);
	await tick(30);
	assert.equal(win.document.activeElement, p.el.querySelector('.p67-file-result'));
	assert.match(p.el.textContent ?? '', /Paused\. Any shift in progress was stopped\./);
	// The roster still says idle: nothing unlocks yet.
	p.update(agent(A, 'idle', 'Comrade Planner'));
	assert.deepEqual(stampsOf().map((s) => s.disabled), [true, true, true, true]);
	assert.match(p.el.querySelector('.p67-file-why')?.textContent ?? '', /Waiting for Paperclip/);
	p.update(agent(A, 'paused', 'Comrade Planner'));
	assert.deepEqual(stampsOf().map((s) => s.disabled), [true, false, true, true]);
	p.show(null, false);
	p.el.remove();
});

test('the card: tabs by click and arrow keys, the chosen tab stays, and the Directives flag', async () => {
	const { createCard } = await import('../src/cockpit/card');
	const { buildWorld } = await import('../src/world/zones');
	const seen: string[] = [];
	const card = createCard(buildWorld(), () => {}, (t) => seen.push(t));
	const [dir, file] = Array.from(card.el.querySelectorAll('[role=tab]')) as unknown as HTMLButtonElement[];
	assert.equal(card.tab, 'directives');
	assert.equal(card.file.hidden, true);
	file.click();
	assert.equal(card.tab, 'file');
	assert.equal(card.directives.hidden, true);
	assert.equal(file.getAttribute('aria-selected'), 'true');
	dir.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }) as unknown as Event);
	assert.equal(card.tab, 'directives');
	card.setTab('file');
	card.setTab('file');
	assert.deepEqual(seen, ['file', 'directives', 'file']);
	card.flagDirectives(true);
	assert.ok(dir.classList.contains('p67-tab-flag'));
	assert.match(dir.getAttribute('aria-label') ?? '', /needs you/);
	card.flagDirectives(false);
	assert.ok(!dir.classList.contains('p67-tab-flag'));
});

test('the wait after a stamp holds for that comrade even after looking at someone else', async () => {
	const { f, calls } = slow(() => 'idle');
	const p = createPersonnel({ fetchImpl: f, companyId: () => COMPANY, nameOf: () => null });
	p.show(agent(A, 'idle', 'Comrade Planner'), true);
	await tick();
	const stampsOf = () => Array.from(p.el.querySelectorAll('.p67-stamp')) as unknown as HTMLButtonElement[];
	await hold(stampsOf()[2]);
	await tick(30);
	p.show(agent(B, 'idle', 'Comrade Critic'), true);
	await tick();
	assert.deepEqual(stampsOf().map((s) => s.disabled), [false, true, false, true], 'the other comrade is not held up');
	p.show(null, false);
	p.show(agent(A, 'idle', 'Comrade Planner'), true);
	await tick();
	assert.deepEqual(stampsOf().map((s) => s.disabled), [true, true, true, true], 'back on the stamped comrade, still waiting');
	assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
	p.update(agent(A, 'running', 'Comrade Planner'));
	assert.deepEqual(stampsOf().map((s) => s.disabled), [false, true, true, true]);
	p.show(null, false);
});
