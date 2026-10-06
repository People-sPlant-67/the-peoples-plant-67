/**
 * The roster: it folds into one COMRADES chip that counts who needs the owner and who
 * has replied, opens and folds on a click, and puts whoever needs the owner first, then whoever
 * has replied, then everyone else by name.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { PAPERCLIP } from '../src/cockpit/host';

const win = new Window();
Object.assign(globalThis, { document: win.document });
const { FAN_MAX_MS, SLIDE_MS, createRoster, rosterOrder, rosterSummary } = await import('../src/cockpit/roster');

/**
 * A comrade as far as the roster reads one.
 *
 * @param id Id.
 * @param name Name.
 * @param needsYou True when they carry a "!".
 * @returns Comrade.
 */
const comrade = (id: string, name: string, needsYou = false) => ({ id, needsYou, agent: { id, name, status: 'idle' } }) as never;

test('roster order: needs you, then replied, then everyone else, each by name', () => {
	const cs = [comrade('z', 'Zoya'), comrade('b', 'Boris', true), comrade('a', 'Anya'), comrade('v', 'Vasily', true), comrade('m', 'Misha')];
	const names = rosterOrder(cs, new Set(['m', 'v'])).map((c: { agent: { name: string } }) => c.agent.name);
	assert.deepEqual(names, ['Boris', 'Vasily', 'Misha', 'Anya', 'Zoya'], 'a "!" outranks a reply; a comrade with both counts once');
	assert.equal((cs[0] as { agent: { name: string } }).agent.name, 'Zoya', 'the input is left alone');
});

test('roster summary: counts in whole sentences', () => {
	assert.equal(rosterSummary(1, 0, 0, false), '1 comrade. Click to show them.');
	assert.equal(rosterSummary(12, 2, 1, true), '12 comrades. 2 need you. 1 has replied to a directive. Click to fold them away.');
	assert.equal(rosterSummary(3, 1, 2, false), '3 comrades. 1 needs you. 2 have replied to a directive. Click to show them.');
});

test('the roster starts folded with counts on its chip, opens and folds on a click, and a chip still picks', async () => {
	const picked: string[] = [];
	const roster = createRoster((id) => picked.push(id), PAPERCLIP);
	win.document.body.append(roster.el as never);
	roster.update([comrade('a', 'Anya'), comrade('b', 'Boris', true), comrade('c', 'Chekov')], null, new Set(['c']));
	const head = roster.el.querySelector('.p67-roster-head') as unknown as HTMLButtonElement;
	const chips = () => Array.from(roster.el.querySelectorAll('.p67-chip:not(.p67-roster-head)')) as unknown as HTMLButtonElement[];
	assert.equal(roster.open, false);
	assert.match(head.textContent!, /COMRADES \(3\)!1✉︎1/);
	assert.equal(head.getAttribute('aria-expanded'), 'false');
	assert.ok(chips().every((c) => c.hidden), 'folded: every comrade chip is hidden');
	assert.deepEqual(chips().map((c) => c.textContent!.replace(/[!✉︎]/g, '')), ['Boris', 'Chekov', 'Anya']);

	head.click();
	assert.equal(roster.open, true);
	assert.ok(roster.el.classList.contains('p67-open'));
	assert.ok(chips().every((c) => !c.hidden && !c.hasAttribute('inert')));
	assert.equal(head.getAttribute('aria-expanded'), 'true');
	assert.match(head.title, /fold them away/);
	chips()[1].click();
	assert.deepEqual(picked, ['c']);

	head.click();
	assert.equal(roster.open, false);
	assert.ok(!roster.el.classList.contains('p67-open'));
	assert.ok(chips().every((c) => !c.hidden), 'they slide in before they are hidden');
	assert.ok(chips().every((c) => c.hasAttribute('inert')), 'but leave the tab order at once');
	await new Promise((r) => setTimeout(r, FAN_MAX_MS + SLIDE_MS + 100));
	assert.ok(chips().every((c) => c.hidden), 'then hidden, out of the tab order');

	// Opened and folded again before the slide finishes: the late timer must not hide them.
	head.click();
	head.click();
	head.click();
	await new Promise((r) => setTimeout(r, FAN_MAX_MS + SLIDE_MS + 100));
	assert.equal(roster.open, true);
	assert.ok(chips().every((c) => !c.hidden));

	// A new "!" mid-flight: the order waits until the chips have landed, then catches up.
	head.click();
	roster.update([comrade('a', 'Anya', true), comrade('b', 'Boris'), comrade('c', 'Chekov')], null, new Set());
	assert.deepEqual(chips().map((c) => c.textContent!.replace(/[!✉\uFE0E]/g, '')), ['Boris', 'Chekov', 'Anya'], 'not reordered in flight');
	await new Promise((r) => setTimeout(r, FAN_MAX_MS + SLIDE_MS + 100));
	assert.deepEqual(chips().map((c) => c.textContent!.replace(/[!✉\uFE0E]/g, '')), ['Anya', 'Boris', 'Chekov'], 'reordered once landed');
	head.click();
	await new Promise((r) => setTimeout(r, FAN_MAX_MS + SLIDE_MS + 100));

	roster.update([comrade('a', 'Anya'), comrade('b', 'Boris')], 'a', new Set());
	assert.equal(chips().length, 2, 'a leaver\'s chip goes');
	assert.match(head.textContent!, /COMRADES \(2\)/);
	assert.equal((head.querySelector('.p67-flag') as unknown as HTMLElement).hidden, true, 'no "!" count when nobody needs you');
	assert.equal((head.querySelector('.p67-reply') as unknown as HTMLElement).hidden, true);
	assert.equal(chips().find((c) => c.getAttribute('aria-pressed') === 'true')?.textContent!.replace(/[!✉\uFE0E]/g, ''), 'Anya');
});
