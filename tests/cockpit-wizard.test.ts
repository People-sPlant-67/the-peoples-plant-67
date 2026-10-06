/**
 * The founding form: the pages each owner goes through, the name it insists on, an archetype
 * reaching the setup, the coffee shown once, the live Connect page (companies and the owner's
 * seat), the inspection's stamps landing once and staying, and the form's keys.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import type { FetchLike } from '../src/live/http';
import type { Inspection } from '../src/live/inspection';
import type { AgentState } from '../src/live/types';

const win = new Window({ url: 'https://paperclip.example.org/api/plant-67' });
Object.assign(globalThis, { document: win.document, location: win.location, HTMLElement: win.HTMLElement, getSelection: () => win.getSelection(), requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number });

const { ARCHETYPES } = await import('../src/art/archetypes');
const { DEFAULT_SETUP } = await import('../src/cockpit/setup-store');
const { createWizard, stepsFor } = await import('../src/cockpit/wizard');
type Setup = typeof DEFAULT_SETUP;

const A = '22222222-2222-4333-8444-000000000001';
const B = '22222222-2222-4333-8444-000000000002';
const C1 = '33333333-2222-4333-8444-000000000001';
const C2 = '33333333-2222-4333-8444-000000000002';

/**
 * A wizard over fake deps.
 *
 * @param mode Live or demo.
 * @param start Setup to start from.
 * @param o What Paperclip lists, the company the plant draws, and the roster drawn.
 * @returns The wizard and its world.
 */
function make(mode: 'live' | 'demo', start: Partial<Setup> = {}, o: { companies?: unknown[]; drawn?: string | null; roster?: AgentState[] } = {}) {
	let setup: Setup = { ...DEFAULT_SETUP, ...start };
	const saves: Setup[] = [];
	let inspection: Inspection | null = null;
	const watches: boolean[] = [];
	const roster: AgentState[] = o.roster ?? [
		{ id: A, name: 'Sasha', title: 'Manual seat', role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null },
		{ id: B, name: 'Chairman (Manual Seat)', title: null, role: null, status: 'paused', pauseReason: 'manual', errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null },
	];
	const companies = o.companies ?? [{ id: C1, name: 'Alpha' }, { id: C2, name: 'Beta' }];
	const fetchImpl: FetchLike = async (p) => ({ type: 'basic', status: 200, ok: true, text: async () => JSON.stringify(p === '/api/companies' ? companies : []) });
	const w = createWizard({
		mode, fetchImpl,
		setup: () => setup,
		save: (n) => { setup = n; saves.push(n); },
		roster: () => roster,
		inspection: () => inspection,
		drawn: () => ('drawn' in o ? o.drawn ?? null : C1),
		watch: (on) => watches.push(on),
	});
	document.body.replaceChildren(w.el);
	const q = <T extends Element>(sel: string): T => w.el.querySelector(sel) as T;
	const next = (): void => q<HTMLButtonElement>('.p67-wiz-foot .p67-red').click();
	const page = (): string => q('.p67-wiz-h')?.textContent ?? '';
	const selects = (): HTMLSelectElement[] => Array.from(w.el.querySelectorAll('.p67-wiz-two select')) as HTMLSelectElement[];
	const pick = (sel: HTMLSelectElement, v: string): void => { sel.value = v; sel.dispatchEvent(new win.Event('change') as unknown as Event); };
	return {
		w, q, next, page, saves, watches, selects, pick,
		get setup() { return setup; },
		setInspection(i: Inspection | null) { inspection = i; w.update(); },
	};
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test('who goes through which pages: the demo has no Ministry; the coffee shows once', () => {
	assert.deepEqual(stepsFor('live', false, 'party'), ['party', 'dictator', 'connect', 'coffee', 'ministry', 'inspection']);
	assert.deepEqual(stepsFor('demo', false, 'party'), ['party', 'dictator', 'connect', 'coffee']);
	assert.deepEqual(stepsFor('live', true, 'party'), ['party', 'dictator', 'connect', 'ministry', 'inspection']);
	assert.deepEqual(stepsFor('demo', true, 'coffee'), ['party', 'dictator', 'connect', 'coffee'], 'the page shown now stays');
});

test('the party card will not go on without a name, and the name and title are kept', () => {
	const t = make('demo');
	t.w.open();
	assert.equal(t.page(), 'Your Party card');
	const next = t.q<HTMLButtonElement>('.p67-wiz-foot .p67-red');
	assert.equal(next.disabled, true);
	assert.match(t.q('.p67-wiz-footnote').textContent!, /name, please/);
	const name = t.q<HTMLInputElement>('.p67-wiz-party input');
	name.value = '  Sasha \n';
	name.dispatchEvent(new win.Event('input') as unknown as Event);
	assert.equal(t.setup.name, 'Sasha');
	assert.equal(next.disabled, false);
	assert.match(t.q('.p67-wiz-booklet').textContent!, /Sasha/);
	t.next();
	assert.equal(t.page(), 'Choose your dictator');
	assert.equal(t.setup.step, 'dictator');
});

test('picking an archetype puts its portrait in the setup', () => {
	const t = make('demo', { name: 'Sasha', step: 'dictator' });
	t.w.open();
	const cards = Array.from(t.w.el.querySelectorAll('.p67-wiz-arch')) as HTMLButtonElement[];
	assert.equal(cards.length, 6);
	cards[2].click();
	assert.equal(t.setup.archetype, 'marshal');
	assert.deepEqual(t.setup.portrait, ARCHETYPES[2].pixels);
	assert.notEqual(t.setup.portrait, ARCHETYPES[2].pixels, 'a copy, so painting never changes the archetype');
	assert.equal(cards[2].getAttribute('aria-checked'), 'true');
	assert.match(t.q('.p67-wiz-caption').textContent!, /Chairman of the Board Sasha/);
});

test('the demo: "Just show me", the coffee once, then into the plant; reopening skips the coffee', () => {
	const t = make('demo', { name: 'Sasha', step: 'connect' });
	t.w.open();
	assert.equal(t.q('.p67-wiz-foot .p67-red').textContent, 'Just show me');
	t.next();
	assert.match(t.w.el.textContent!, /spot me my next coffee/);
	const buy = t.q<HTMLAnchorElement>('.p67-wiz-coffee a');
	assert.equal(buy.href, 'https://buymeacoffee.com/thechiefengineer');
	assert.equal(buy.rel, 'noopener noreferrer');
	t.next();
	assert.equal(t.w.isOpen, false);
	assert.equal(t.setup.done, true);
	assert.equal(t.setup.coffeeSeen, true);
	t.w.open();
	assert.equal(t.page(), 'Your Party card', 'the coffee page does not come back');
	assert.equal(Array.from(t.w.el.querySelectorAll('.p67-wiz-pip')).some((p) => /Coffee/.test(p.textContent!)), false);
});

test('live Connect: the seat comes from the company drawn; Next keeps the company and the seat in one change', async () => {
	const t = make('live', { name: 'Sasha', step: 'connect' }, { companies: [{ id: C1, name: 'Alpha' }, { id: C2, name: 'Beta' }, { id: '../x', name: 'Forged' }] });
	t.w.open();
	await flush();
	const [company, seat] = t.selects();
	assert.deepEqual(Array.from(company.options).map((o) => o.textContent), ['Alpha', 'Beta'], 'only ids Paperclip could give out');
	assert.equal(seat.value, B, 'until chosen, the agent the old name rule counts is offered');
	assert.match(t.w.el.textContent!, /paperclip\.example\.org/);
	t.pick(seat, A);
	assert.equal(t.setup.seatAgentId, A, 'a seat picked from the drawn roster is kept at once, so closing the form keeps it');
	t.next();
	assert.equal(t.setup.companyId, C1);
	assert.equal(t.setup.seatAgentId, A);
	assert.ok(t.saves.some((x) => x.companyId === C1 && x.seatAgentId === A && x.step === 'coffee'), 'company, seat and the page to come back to, in one change');
});

test('another company in the list: the seat waits for its roster, and Next keeps only the company', async () => {
	const t = make('live', { name: 'Sasha', step: 'connect', seatAgentId: A });
	t.w.open();
	await flush();
	const [company, seat] = t.selects();
	t.pick(company, C2);
	assert.equal(seat.disabled, true);
	assert.match(seat.options[0].textContent!, /after the switch/);
	assert.equal(t.q('.p67-wiz-foot .p67-red').textContent, 'Use this company');
	t.next();
	assert.equal(t.setup.companyId, C2);
	assert.equal(t.setup.seatAgentId, A, 'the wizard keeps no seat from another company (the setup forgets the old one on the switch)');
});

test('"No, none of them is me" is kept as none; an empty roster keeps nothing about the seat', async () => {
	const t = make('live', { name: 'Sasha', step: 'connect' });
	t.w.open();
	await flush();
	t.pick(t.selects()[1], 'none');
	t.next();
	assert.equal(t.setup.seatAgentId, 'none');
	const e = make('live', { name: 'Sasha', step: 'connect', seatAgentId: A }, { roster: [] });
	e.w.open();
	await flush();
	assert.equal(e.selects()[1].disabled, true);
	e.next();
	assert.equal(e.setup.seatAgentId, A, 'a roster not read yet never turns the seat into none');
});

test('a company that has gone: the one left is offered, and Next keeps it, so the owner is never stuck', async () => {
	const gone = '33333333-2222-4333-8444-0000000000ff';
	const t = make('live', { name: 'Sasha', done: true, companyId: gone }, { companies: [{ id: C1, name: 'Alpha' }], drawn: null, roster: [] });
	t.w.open('connect', 'The company this plant was set up for is no longer listed in Paperclip.');
	await flush();
	assert.match(t.q('.p67-wiz-err').textContent!, /no longer listed/);
	assert.equal(t.selects()[0].closest('label')!.hidden, false, 'the choice shows, though only one is left');
	assert.equal(t.q('.p67-wiz-foot .p67-red').textContent, 'Use this company');
	t.next();
	assert.equal(t.setup.companyId, C1);
});

test('the companies list fails: the reason in words, Next waits, and Try again reads it again', async () => {
	let ok = false;
	let setup: Setup = { ...DEFAULT_SETUP, name: 'Sasha', step: 'connect' };
	const fetchImpl: FetchLike = async () => (ok ? { type: 'basic', status: 200, ok: true, text: async () => JSON.stringify([{ id: C1, name: 'Alpha' }]) } : { type: 'basic', status: 503, ok: false, text: async () => '{}' });
	const w = createWizard({ mode: 'live', fetchImpl, setup: () => setup, save: (n) => { setup = n; }, roster: () => [], inspection: () => null, drawn: () => C1, watch: () => {} });
	document.body.replaceChildren(w.el);
	w.open('connect');
	await flush();
	const err = w.el.querySelector('.p67-wiz-failed') as HTMLElement;
	assert.equal(err.hidden, false);
	assert.match(err.textContent!, /did not list your companies just now/);
	assert.equal((w.el.querySelector('.p67-wiz-foot .p67-red') as HTMLButtonElement).disabled, true, 'Next waits for a company to keep');
	ok = true;
	(Array.from(w.el.querySelectorAll('button')).find((b) => b.textContent === 'Try again') as HTMLButtonElement).click();
	await flush();
	assert.equal(err.hidden, true);
	assert.deepEqual(Array.from((w.el.querySelector('.p67-wiz-two select') as HTMLSelectElement).options).map((o) => o.textContent), ['Alpha']);
});

test('the Ministry: the order carries the regime picked', () => {
	const t = make('live', { name: 'Sasha', step: 'ministry' });
	t.w.open();
	assert.equal(t.q('.p67-wiz-prompt mark').textContent, 'Tribunal threshold: 3 live strikes');
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-regime')) as HTMLButtonElement[])[2].click();
	assert.equal(t.setup.regime, 'purge');
	assert.equal(t.q('.p67-wiz-prompt mark').textContent, 'Tribunal threshold: 1 live strike');
});

test('a founded Ministry: the order is folded away, and a new regime is confirmed before it is kept', () => {
	const t = make('live', { name: 'Sasha', step: 'ministry', founded: true });
	t.w.open();
	assert.match(t.page() + t.w.el.textContent!, /Your Ministry is founded/);
	assert.ok(t.q('details.p67-wiz-fold'), 'the order sits behind "Show the order again"');
	assert.equal(t.q('.p67-wiz-foot .p67-red').textContent, 'See the inspection');
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-regime')) as HTMLButtonElement[])[0].click();
	assert.equal(t.setup.regime, 'standard', 'not yet');
	assert.match(t.q('.p67-wiz-confirm').textContent!, /first line reads "Tribunal threshold: 3 live strikes"\. For Lenient it must read "Tribunal threshold: 5 live strikes"/);
	assert.ok(t.q('.p67-wiz-foot .p67-ghost'), 'the confirm holds the main choice meanwhile');
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-confirm button')).find((b) => /Keep/.test(b.textContent!)) as HTMLButtonElement).click();
	assert.equal(t.setup.regime, 'standard');
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-regime')) as HTMLButtonElement[])[0].click();
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-confirm button')).find((b) => /Change/.test(b.textContent!)) as HTMLButtonElement).click();
	assert.equal(t.setup.regime, 'lenient');
});

test('the inspection: watched while it shows; a stamp thuds once when it lands, then stays still; wrong is amber with the reason', () => {
	const t = make('live', { name: 'Sasha', step: 'inspection' });
	t.w.open();
	assert.deepEqual(t.watches, [true], 'the setup is told to watch');
	assert.match(t.w.el.textContent!, /Waiting for the plant to draw your company/);
	const ok = { state: 'ok' as const, note: null };
	const missing = { state: 'missing' as const, note: 'No issue titled "Strike Ledger" yet.' };
	t.setInspection({ director: ok, routine: ok, ledger: missing, threshold: missing, lessons: ok });
	const stamps = () => Array.from(t.w.el.querySelectorAll('.p67-wiz-st')).map((e) => e.className.replace('p67-wiz-st ', ''));
	// In the order the CEO sets them up: Lessons, Director, ledger, threshold, routine.
	assert.deepEqual(stamps(), ['p67-ok p67-fresh', 'p67-ok p67-fresh', 'p67-no', 'p67-no', 'p67-ok p67-fresh']);
	assert.equal(t.w.el.querySelector('.p67-wiz-st')!.getAttribute('aria-label'), 'Accepted');
	t.setInspection({ director: ok, routine: ok, ledger: ok, threshold: { state: 'wrong', note: 'The ledger says 5, but your regime says 3.' }, lessons: ok });
	assert.deepEqual(stamps(), ['p67-ok', 'p67-ok', 'p67-ok p67-fresh', 'p67-bad', 'p67-ok']);
	assert.match(t.w.el.textContent!, /says 5, but your regime says 3/);
	assert.equal(t.q('.p67-wiz-foot .p67-red').textContent, 'Enter the plant, finish later');
	t.setInspection({ director: ok, routine: ok, ledger: ok, threshold: ok, lessons: ok });
	assert.equal(t.q('.p67-wiz-foot .p67-red').textContent, 'Enter the plant');
	t.w.close();
	assert.deepEqual(t.watches.at(-1), false, 'closing stops the watching');
});

test('Escape closes the form where it stands and goes no further; the ★ button opens it again on the same page', () => {
	const t = make('demo', { name: 'Sasha', step: 'dictator' });
	t.w.open();
	let reached = false;
	const behind = (): void => { reached = true; };
	document.addEventListener('keydown', behind);
	t.q('.p67-wiz').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	document.removeEventListener('keydown', behind);
	assert.equal(reached, false, 'nothing behind the form hears it');
	assert.equal(t.w.isOpen, false);
	assert.equal(t.w.el.hidden, true);
	assert.equal(t.setup.done, true, 'closing counts as "finish later": it no longer opens by itself');
	t.w.button.click();
	assert.equal(t.w.isOpen, true);
	assert.equal(t.page(), 'Choose your dictator');
});

test('closed on the coffee page, the form reopens past it', () => {
	const t = make('live', { name: 'Sasha', step: 'coffee' });
	t.w.open();
	t.w.close();
	assert.equal(t.setup.coffeeSeen, true);
	assert.equal(t.setup.step, 'ministry');
	t.w.open();
	assert.equal(t.page(), 'Found the Ministry');
});

test('the nag says what is wrong in words, until the Ministry is founded', () => {
	const t = make('live', { name: 'Sasha' });
	t.w.update();
	assert.equal(t.w.button.textContent, '★ Ministry not yet founded');
	assert.ok(t.w.button.classList.contains('p67-nag'));
	const f = make('live', { name: 'Sasha', founded: true });
	f.w.update();
	assert.equal(f.w.button.textContent, '★ Ministry');
	const d = make('demo', { name: 'Sasha' });
	d.w.update();
	assert.equal(d.w.button.textContent, '★ Founding form', 'the demo has no Ministry to nag about');
});

test('the painter: one stroke is one undo step, even one that starts on a pixel already that colour', async () => {
	const { createPainter } = await import('../src/cockpit/painter');
	const { blankPortrait, PORTRAIT_BG } = await import('../src/art/archetypes');
	let pic = blankPortrait();
	const p = createPainter({ get: () => pic, set: (g) => { pic = g; } });
	document.body.replaceChildren(p.el);
	const canvas = p.el.querySelector('canvas') as unknown as HTMLCanvasElement & { setPointerCapture?: (id: number) => void };
	canvas.setPointerCapture = () => {};
	canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 260, right: 200, bottom: 260, x: 0, y: 0, toJSON: () => ({}) });
	const ptr = (type: string, x: number, y: number): void => { canvas.dispatchEvent(new win.PointerEvent(type, { clientX: x, clientY: y, pointerId: 1 }) as unknown as Event); };
	const swatch = Array.from(p.el.querySelectorAll('.p67-swatch')).find((b) => b.getAttribute('title') === PORTRAIT_BG) as HTMLButtonElement;
	swatch.click();
	const undo = Array.from(p.el.querySelectorAll('button')).find((b) => b.textContent === '↶ Undo') as HTMLButtonElement;
	// Start on the ground colour (nothing changes there), then cross onto a red pixel to paint over it.
	pic[2][5] = '#b02a22';
	pic[2][14] = '#b02a22';
	ptr('pointerdown', 5, 5);
	ptr('pointermove', 55, 25);
	ptr('pointerup', 55, 25);
	assert.equal(pic[2][5], PORTRAIT_BG, 'the stroke painted');
	assert.equal(undo.disabled, false, 'and can be undone');
	undo.click();
	assert.equal(pic[2][5], '#b02a22', 'undo brings back what was there');
});

test('the Ministry page follows the inspection: a Director at work keeps the order folded, and a change redraws the page', () => {
	const t = make('live', { name: 'Sasha', step: 'ministry' });
	t.w.open();
	assert.ok(!t.q('details.p67-wiz-fold'), 'nothing set up yet: the order is offered');
	const ok = { state: 'ok' as const, note: null };
	const wrong = { state: 'wrong' as const, note: 'The ledger says 5, but your regime says 3.' };
	t.setInspection({ director: ok, routine: ok, ledger: ok, threshold: wrong, lessons: ok });
	assert.match(t.w.el.textContent!, /set up but needs a fix/);
	assert.ok(t.q('details.p67-wiz-fold'), 'a Director at work: sending the order again would hire a second');
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-regime')) as HTMLButtonElement[])[2].click();
	assert.ok(t.q('.p67-wiz-confirm'), 'a regime change is confirmed first here too');
	assert.ok(t.w.el.contains(document.activeElement), 'focus is given back to the form after the page is redrawn');
	(document.activeElement as HTMLElement).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	assert.equal(t.w.isOpen, false, 'so Escape still reaches it');
});

test('a confirm left open does not come back after leaving the page', () => {
	const t = make('live', { name: 'Sasha', step: 'ministry', founded: true });
	t.w.open();
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-regime')) as HTMLButtonElement[])[0].click();
	assert.ok(t.q('.p67-wiz-confirm'));
	t.q<HTMLButtonElement>('.p67-wiz-foot .p67-ghost').click();
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-pip')).find((p) => /Ministry/.test(p.textContent!)) as HTMLButtonElement).click();
	assert.equal(t.q('.p67-wiz-confirm'), null);
});

test('a regime the ledger already says is kept without a confirm', () => {
	const t = make('live', { name: 'Sasha', step: 'ministry', founded: true, regime: 'lenient' });
	const ok = { state: 'ok' as const, note: null };
	t.setInspection({ director: ok, routine: ok, ledger: ok, lessons: ok, threshold: { state: 'wrong', note: 'The ledger says 3, but your regime says 5.' }, ledgerSays: 3 });
	t.w.open();
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-regime')) as HTMLButtonElement[])[1].click();
	assert.equal(t.setup.regime, 'standard', 'Standard matches the ledger: nothing to ask the CEO');
	assert.equal(t.q('.p67-wiz-confirm'), null);
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-regime')) as HTMLButtonElement[])[2].click();
	assert.match(t.q('.p67-wiz-confirm').textContent!, /reads "Tribunal threshold: 3 live strikes"/, 'the box quotes what the ledger really says');
});

test('before the first inspection, a ledger found on an earlier visit keeps the order folded', () => {
	const t = make('live', { name: 'Sasha', step: 'ministry', known: { ledger: '44444444-2222-4333-8444-000000000001', lessons: null } });
	t.w.open();
	assert.ok(t.q('details.p67-wiz-fold'));
	assert.equal(t.q('.p67-wiz-foot .p67-red').textContent, 'See the inspection');
});

test('Connect: the button label follows the company drawn; one read of the companies at a time; none usable is said', async () => {
	let drawn: string | null = null;
	let reads = 0;
	let list: unknown[] = [{ id: C1, name: 'Alpha' }];
	let setup: Setup = { ...DEFAULT_SETUP, name: 'Sasha', step: 'connect' };
	const fetchImpl: FetchLike = async () => { reads++; await flush(); return { type: 'basic', status: 200, ok: true, text: async () => JSON.stringify(list) }; };
	const w = createWizard({ mode: 'live', fetchImpl, setup: () => setup, save: (n) => { setup = n; }, roster: () => [], inspection: () => null, drawn: () => drawn, watch: () => {} });
	document.body.replaceChildren(w.el);
	w.open('connect');
	w.open('connect');
	await flush(); await flush();
	assert.equal(reads, 1, 'opening twice reads once');
	const next = w.el.querySelector('.p67-wiz-foot .p67-red') as HTMLButtonElement;
	assert.equal(next.textContent, 'Use this company');
	drawn = C1;
	w.update();
	assert.equal(next.textContent, 'Next', 'once the plant draws it, it is just Next');
	w.close();
	list = [];
	w.open('connect');
	await flush(); await flush();
	assert.match((w.el.querySelector('.p67-wiz-failed') as HTMLElement).textContent!, /lists no company this sign-in can use/);
});

test('the gone-company notice offers "Choose a company" and drops the sign-in advice that would not help', async () => {
	const { createOverlay } = await import('../src/cockpit/overlay');
	let chose = 0;
	const o = createOverlay(() => { chose++; });
	const snap = (session: 'company-gone' | 'signed-out') => ({ at: 0, session, message: 'Gone.', companyId: null, companyName: null, agents: [], badges: null, badgesStale: false, approvals: null });
	o.update(snap('company-gone'));
	assert.equal(o.open, true);
	const choose = Array.from(o.el.querySelectorAll('button')).find((b) => b.textContent === 'Choose a company') as HTMLButtonElement;
	assert.equal(choose.hidden, false);
	assert.equal((o.el.querySelector('a') as HTMLElement).hidden, true);
	choose.click();
	assert.equal(chose, 1);
	o.update(snap('signed-out'));
	assert.equal(choose.hidden, true, 'a lapsed sign-in gets the usual advice');
	assert.equal((o.el.querySelector('a') as HTMLElement).hidden, false);
});
