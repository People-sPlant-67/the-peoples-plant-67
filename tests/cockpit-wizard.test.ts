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
 * @param companies What Paperclip lists.
 * @returns The wizard and its world.
 */
function make(mode: 'live' | 'demo', start: Partial<Setup> = {}, companies: unknown[] = [{ id: C1, name: 'Alpha' }, { id: C2, name: 'Beta' }]) {
	let setup: Setup = { ...DEFAULT_SETUP, ...start };
	const saves: Setup[] = [];
	let inspection: Inspection | null = null;
	let reinspects = 0;
	const roster: AgentState[] = [
		{ id: A, name: 'Sasha', title: 'Manual seat', role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null },
		{ id: B, name: 'Chairman (Manual Seat)', title: null, role: null, status: 'paused', pauseReason: 'manual', errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null },
	];
	const fetchImpl: FetchLike = async (p) => ({ type: 'basic', status: 200, ok: true, text: async () => JSON.stringify(p === '/api/companies' ? companies : []) });
	const w = createWizard({
		mode, fetchImpl,
		setup: () => setup,
		save: (n) => { setup = n; saves.push(n); },
		roster: () => roster,
		inspection: () => inspection,
		reinspect: () => { reinspects++; },
	});
	document.body.replaceChildren(w.el);
	const q = <T extends Element>(sel: string): T => w.el.querySelector(sel) as T;
	const next = (): void => q<HTMLButtonElement>('.p67-wiz-foot .p67-red').click();
	const page = (): string => q('.p67-wiz-h')?.textContent ?? '';
	return {
		w, q, next, page, saves,
		get setup() { return setup; },
		setInspection(i: Inspection | null) { inspection = i; w.update(); },
		get reinspects() { return reinspects; },
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

test('live Connect: the list is only browsed until Next, which keeps the company, the seat and the page in one change', async () => {
	const t = make('live', { name: 'Sasha', step: 'connect' }, [{ id: C1, name: 'Alpha' }, { id: C2, name: 'Beta' }, { id: '../x', name: 'Forged' }]);
	t.w.open();
	await flush();
	const [company, seat] = Array.from(t.w.el.querySelectorAll('.p67-wiz-two select')) as HTMLSelectElement[];
	assert.deepEqual(Array.from(company.options).map((o) => o.textContent), ['Alpha', 'Beta'], 'only ids Paperclip could give out');
	assert.equal(seat.value, B, 'until chosen, the agent the old name rule counts is offered');
	assert.match(t.w.el.textContent!, /paperclip\.example\.org/);
	company.value = C2;
	company.dispatchEvent(new win.Event('change') as unknown as Event);
	assert.equal(t.setup.companyId, null, 'browsing the list changes nothing');
	t.next();
	assert.equal(t.setup.companyId, C2);
	assert.equal(t.setup.seatAgentId, B, 'the seat shown is now the owner\'s own choice');
	assert.equal(t.saves.find((x) => x.companyId === C2)?.step, 'coffee', 'the page to come back to is kept with the company');
});

test('"No, none of them is me" is kept as none, so no agent is the seat by name', async () => {
	const t = make('live', { name: 'Sasha', step: 'connect' });
	t.w.open();
	await flush();
	const seat = (Array.from(t.w.el.querySelectorAll('.p67-wiz-two select')) as HTMLSelectElement[])[1];
	seat.value = 'none';
	seat.dispatchEvent(new win.Event('change') as unknown as Event);
	assert.equal(t.setup.seatAgentId, 'none');
	t.next();
	assert.equal(t.setup.seatAgentId, 'none');
});

test('a company that has gone: the one left is kept on Next, so the owner is never stuck', async () => {
	const gone = '33333333-2222-4333-8444-0000000000ff';
	const t = make('live', { name: 'Sasha', done: true, companyId: gone }, [{ id: C1, name: 'Alpha' }]);
	t.w.open('connect', 'The company this plant was set up for is no longer listed in Paperclip.');
	await flush();
	assert.equal(t.page(), 'Connect the plant');
	assert.match(t.q('.p67-wiz-err').textContent!, /no longer listed/);
	const company = t.q<HTMLSelectElement>('.p67-wiz-two select');
	assert.equal(company.closest('label')!.hidden, false, 'the choice shows, though only one is left');
	t.next();
	assert.equal(t.setup.companyId, C1);
});

test('the companies list fails: the reason, and a button to try again', async () => {
	let ok = false;
	const t = make('live', { name: 'Sasha', step: 'connect' });
	// Swap the fetch: the first read fails.
	const fetchImpl: FetchLike = async () => (ok ? { type: 'basic', status: 200, ok: true, text: async () => JSON.stringify([{ id: C1, name: 'Alpha' }]) } : { type: 'basic', status: 503, ok: false, text: async () => '{}' });
	const w = createWizard({ mode: 'live', fetchImpl, setup: () => t.setup, save: () => {}, roster: () => [], inspection: () => null, reinspect: () => {} });
	document.body.replaceChildren(w.el);
	w.open('connect');
	await flush();
	assert.match(w.el.textContent!, /did not list the companies just now/);
	const retry = Array.from(w.el.querySelectorAll('button')).find((b) => b.textContent === 'Try again') as HTMLButtonElement;
	assert.equal(retry.hidden, false);
	ok = true;
	retry.click();
	await flush();
	assert.deepEqual(Array.from((w.el.querySelector('.p67-wiz-two select') as HTMLSelectElement).options).map((o) => o.textContent), ['Alpha']);
});

test('the Ministry: the order carries the regime picked; choosing a regime asks for a fresh inspection', () => {
	const t = make('live', { name: 'Sasha', step: 'ministry' });
	t.w.open();
	assert.equal(t.q('.p67-wiz-prompt mark').textContent, 'Tribunal threshold: 3 live strikes');
	const before = t.reinspects;
	(Array.from(t.w.el.querySelectorAll('.p67-wiz-regime')) as HTMLButtonElement[])[2].click();
	assert.equal(t.setup.regime, 'purge');
	assert.equal(t.q('.p67-wiz-prompt mark').textContent, 'Tribunal threshold: 1 live strike');
	assert.equal(t.reinspects, before + 1);
});

test('the inspection: a stamp thuds once when it lands, then stays still; wrong is amber with the reason', async () => {
	const t = make('live', { name: 'Sasha', step: 'inspection' });
	t.w.open();
	assert.ok(t.reinspects >= 1, 'opening the page inspects at once');
	const ok = { state: 'ok' as const, note: null };
	const missing = { state: 'missing' as const, note: 'No issue titled "Strike Ledger" yet.' };
	t.setInspection({ director: ok, routine: ok, ledger: missing, threshold: missing, lessons: ok });
	const stamps = () => Array.from(t.w.el.querySelectorAll('.p67-wiz-st')).map((e) => e.className.replace('p67-wiz-st ', ''));
	assert.deepEqual(stamps(), ['p67-ok p67-fresh', 'p67-ok p67-fresh', 'p67-no', 'p67-no', 'p67-ok p67-fresh']);
	t.setInspection({ director: ok, routine: ok, ledger: ok, threshold: { state: 'wrong', note: 'The ledger says 5, but your regime says 3.' }, lessons: ok });
	assert.deepEqual(stamps(), ['p67-ok', 'p67-ok', 'p67-ok p67-fresh', 'p67-bad', 'p67-ok']);
	assert.match(t.w.el.textContent!, /says 5, but your regime says 3/);
	assert.equal(t.q('.p67-wiz-foot .p67-red').textContent, 'Enter the plant, finish later');
	t.setInspection({ director: ok, routine: ok, ledger: ok, threshold: ok, lessons: ok });
	assert.equal(t.q('.p67-wiz-foot .p67-red').textContent, 'Enter the plant');
	t.w.close();
	const asked = t.reinspects;
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(t.reinspects, asked, 'closing stops the watching');
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
	const red = Array.from(p.el.querySelectorAll('.p67-swatch')).find((b) => b.getAttribute('title') === '#b02a22') as HTMLButtonElement;
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
	assert.ok(red);
});
