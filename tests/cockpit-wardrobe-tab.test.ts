/**
 * The Wardrobe tab under a fake DOM: it opens on what the comrade wears, the arrows
 * and cloth pickers change the draft and the preview, focus stays on the control used, Keep is
 * offered only for something new, Back to their own only when a look is kept, Surprise me gives a
 * real look; and the name card's three tabs move with the arrow keys.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { PAPERCLIP } from '../src/cockpit/host';

const win = new Window();
Object.assign(globalThis, { document: win.document, ImageData: class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} } });
const { createWardrobeTab } = await import('../src/cockpit/wardrobe-tab');
const { randomOutfit } = await import('../src/art/outfits');
const { validLook } = await import('../src/cockpit/wardrobe');
const { createCard } = await import('../src/cockpit/card');
const { buildWorld } = await import('../src/world/zones');
type Look = import('../src/cockpit/wardrobe').Look;
type Outfit = import('../src/art/outfits').Outfit;

const A = '00000000-0000-4000-8000-0000000000a1';

/**
 * The tab over stand-ins, and what it asked for.
 *
 * @param kept A look already kept, or null.
 * @returns Tab and calls.
 */
function setup(kept: Look | null = null, reduced = false) {
	const own = randomOutfit(11);
	const rendered: Outfit[] = [];
	const forgotten: string[] = [];
	const keeps: (Look | null)[] = [];
	let store = kept;
	const tab = createWardrobeTab({
		render: async (o) => { rendered.push(o); return { w: 84, h: 112, rgba: new Uint8ClampedArray(84 * 112 * 4), top: { x: 0, y: 0 } }; },
		forget: (id) => forgotten.push(id),
		own: () => own,
		kept: () => store,
		keep: (_id, l) => { keeps.push(l); store = l; },
		reset: () => { keeps.push(null); store = null; },
		random: () => 0.37,
		reducedMotion: () => reduced,
	});
	(win.document.body as unknown as HTMLElement).append(tab.el as never);
	const q = <T extends Element>(sel: string) => tab.el.querySelector(sel) as unknown as T;
	const value = (part: string) => q<HTMLElement>(`[data-key="${part}"] .p67-wardrobe-value`).textContent;
	const next = (part: string) => q<HTMLButtonElement>(`[data-key="${part}"] .p67-wardrobe-arrow:last-of-type`);
	const button = (text: string) => Array.from(tab.el.querySelectorAll('.p67-wardrobe-actions button')).find((b) => b.textContent === text) as unknown as HTMLButtonElement;
	return { tab, own, rendered, forgotten, keeps, value, next, button, q };
}

test('opens on what they wear; the arrows change the draft and the preview; focus stays on the arrow', async () => {
	const s = setup();
	s.tab.open(A);
	await Promise.resolve();
	assert.equal(s.tab.draft?.headwear, s.own.headwear);
	assert.equal(s.button('Keep').disabled, true, 'nothing new to keep');
	assert.equal(s.button('Back to their own').disabled, true, 'nothing kept');
	const before = s.value('Hat');
	const arrow = s.next('Hat');
	arrow.focus();
	arrow.click();
	assert.notEqual(s.value('Hat'), before);
	assert.equal((win.document.activeElement as unknown as HTMLElement).getAttribute('aria-label'), 'Next hat', 'focus is still on the arrow after the redraw');
	assert.equal(s.button('Keep').disabled, false);
	await Promise.resolve();
	assert.equal(s.rendered.at(-1)!.headwear, s.tab.draft!.headwear, 'the preview wears the draft');
	assert.ok(s.rendered.at(-1)!.id.startsWith(s.own.id), 'over their own skin and hair');
	s.tab.el.remove();
});

test('overalls hide the legs row; a lab coat shows the shirt; extras switch on and off, one bag at a time', () => {
	const s = setup();
	s.tab.open(A);
	for (let k = 0; k < 20 && s.value('Top') !== 'Overalls'; k++) s.next('Top').click();
	assert.equal(s.q('[data-key="Legs"]'), null);
	assert.ok(s.q('[data-key="Shirt"]'));
	for (let k = 0; k < 20 && s.value('Top') !== 'Lab coat'; k++) s.next('Top').click();
	assert.ok(s.q('[data-key="Legs"]') && s.q('[data-key="Shirt"]'));
	const satchel = s.q<HTMLInputElement>('[data-key="extra-satchel"]');
	satchel.checked = true;
	satchel.dispatchEvent(new win.Event('change') as unknown as Event);
	const brief = s.q<HTMLInputElement>('[data-key="extra-briefcase"]');
	brief.checked = true;
	brief.dispatchEvent(new win.Event('change') as unknown as Event);
	assert.deepEqual(s.tab.draft!.extras, ['briefcase'], 'the briefcase replaced the satchel');
	s.tab.el.remove();
});

test('Keep keeps the draft; Back to their own forgets it; Surprise me gives a real look and keeps nothing', () => {
	const s = setup();
	s.tab.open(A);
	s.next('Face').click();
	s.button('Keep').click();
	assert.equal(s.keeps.length, 1);
	assert.equal(s.keeps[0]!.face, s.tab.draft!.face);
	assert.equal(s.button('Keep').disabled, true, 'kept: nothing new now');
	assert.equal(s.button('Back to their own').disabled, false);
	s.button('Back to their own').click();
	assert.equal(s.keeps.at(-1), null);
	assert.equal(s.tab.draft!.headwear, s.own.headwear);
	s.button('Surprise me').click();
	assert.ok(validLook(s.tab.draft));
	assert.equal(s.keeps.length, 2, 'nothing kept until Keep');
	s.tab.open(null);
	assert.ok(s.forgotten.length > 0, 'the last preview is let go');
	s.tab.el.remove();
});

test('the name card has a Wardrobe tab, and the arrow keys go round all three', () => {
	const seen: string[] = [];
	const card = createCard(buildWorld(), PAPERCLIP, () => {}, (t) => seen.push(t));
	const tabs = Array.from(card.el.querySelectorAll('[role=tab]')) as unknown as HTMLButtonElement[];
	assert.deepEqual(tabs.map((t) => t.textContent), ['Directives', 'Personnel File', 'Wardrobe']);
	tabs[0].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }) as unknown as Event);
	assert.equal(card.tab, 'wardrobe', 'left from the first goes round to the last');
	assert.equal(card.wardrobe.hidden, false);
	tabs[2].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }) as unknown as Event);
	assert.equal(card.tab, 'directives');
	assert.deepEqual(seen, ['wardrobe', 'directives']);
});

test('each choice is said aloud; a change nobody could see is not worth a trip; less motion keeps the preview still', async () => {
	const s = setup(null, true);
	s.tab.open(A);
	s.next('Hat').click();
	for (let k = 0; k < 20 && s.value('Hat') !== 'No hat'; k++) s.next('Hat').click();
	assert.match(s.q<HTMLElement>('.p67-sr').textContent ?? '', /^Hat: No hat\.$/);
	const own = s.own;
	if (own.headwear === 'none') {
		assert.equal(s.button('Keep').disabled, true, 'back to no hat, as they were: nothing to keep');
	}
	await Promise.resolve();
	const n = s.rendered.length;
	s.tab.tick(5000);
	assert.equal(s.rendered.length, n, 'the preview does not turn');
	s.tab.el.remove();
});
