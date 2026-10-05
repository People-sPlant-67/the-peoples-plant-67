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
 * @returns The wizard and its world.
 */
function make(mode: 'live' | 'demo', start: Partial<Setup> = {}) {
	let setup: Setup = { ...DEFAULT_SETUP, ...start };
	const saves: Setup[] = [];
	let inspection: Inspection | null = null;
	let reinspects = 0;
	const roster: AgentState[] = [
		{ id: A, name: 'Sasha', title: 'Manual seat', role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null },
		{ id: B, name: 'Chairman (Manual Seat)', title: null, role: null, status: 'paused', pauseReason: 'manual', errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null },
	];
	const fetchImpl: FetchLike = async (p) => ({ type: 'basic', status: 200, ok: true, text: async () => JSON.stringify(p === '/api/companies' ? [{ id: C1, name: 'Alpha' }, { id: C2, name: 'Beta' }] : []) });
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

test('live Connect: the companies listed, the seat offered from the roster, and a choice changes the setup', async () => {
	const t = make('live', { name: 'Sasha', step: 'connect' });
	t.w.open();
	await flush();
	const [company, seat] = Array.from(t.w.el.querySelectorAll('.p67-wiz-two select')) as HTMLSelectElement[];
	assert.deepEqual(Array.from(company.options).map((o) => o.textContent), ['Alpha', 'Beta']);
	assert.equal(company.closest('label')!.hidden, false, 'two companies: the choice shows');
	assert.equal(seat.value, B, 'the agent the old name rule counts as the seat is offered first');
	seat.value = A;
	seat.dispatchEvent(new win.Event('change') as unknown as Event);
	assert.equal(t.setup.seatAgentId, A);
	company.value = C2;
	company.dispatchEvent(new win.Event('change') as unknown as Event);
	assert.equal(t.setup.companyId, C2);
	assert.equal(t.setup.seatAgentId, null, 'a new company forgets the seat');
	assert.match(t.w.el.textContent!, /paperclip\.example\.org/);
});

test('a company that has gone: the form opens on Connect with the warning at the top', () => {
	const t = make('live', { name: 'Sasha', done: true });
	t.w.open('connect', 'The company this plant was set up for is no longer listed in Paperclip.');
	assert.equal(t.page(), 'Connect the plant');
	assert.match(t.q('.p67-wiz-err').textContent!, /no longer listed/);
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

test('the inspection: a stamp thuds once when it lands, then stays still; wrong is amber with the reason', () => {
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
});

test('Escape closes the form where it stands; the ★ button opens it again on the same page', () => {
	const t = make('demo', { name: 'Sasha', step: 'dictator' });
	t.w.open();
	t.q('.p67-wiz').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	assert.equal(t.w.isOpen, false);
	assert.equal(t.w.el.hidden, true);
	t.w.button.click();
	assert.equal(t.w.isOpen, true);
	assert.equal(t.page(), 'Choose your dictator');
});
