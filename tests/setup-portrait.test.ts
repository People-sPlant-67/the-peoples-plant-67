/**
 * Founding the plant, the parts with no screen: the setup record (read field by field, junk
 * falls back on its own), the six archetypes and the portrait frame, the photo pixelator's
 * palette snap and crop, and the painter's fill and mirror.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCHETYPES, CHAIRMAN, PORTRAIT_BG, PORTRAIT_H, PORTRAIT_PALETTE, PORTRAIT_W, SEPIA_PALETTE, blankPortrait, isPortrait } from '../src/art/archetypes';
import { applyTool, floodFill, mirrorX } from '../src/cockpit/painter';
import { coverCrop, snapToPalette } from '../src/cockpit/pixelate';
import { DEFAULT_SETUP, SETUP_KEY, addressOf, cleanText, loadSetup, readSetup, saveSetup } from '../src/cockpit/setup-store';
import { MINISTRY_AT, ministrySign, ownerPortrait } from '../src/world/zones';

const ID = '22222222-2222-4333-8444-000000000001';

test('a fresh plant: no record, junk, or storage that throws all read as the defaults', () => {
	assert.deepEqual(readSetup(null), DEFAULT_SETUP);
	assert.deepEqual(readSetup('nonsense'), DEFAULT_SETUP);
	assert.deepEqual(loadSetup({ getItem: () => '{not json' }), DEFAULT_SETUP);
	assert.deepEqual(loadSetup({ getItem: () => { throw new Error('denied'); } }), DEFAULT_SETUP);
	assert.deepEqual(loadSetup(null), DEFAULT_SETUP);
});

test('one bad field falls back alone; the rest of the choices are kept', () => {
	const s = readSetup({ name: 'Sasha', title: 'Premier', regime: 'tyranny', companyId: '../../admin', seatAgentId: ID, portrait: [['#fff']], step: 'ministry', done: true, coffeeSeen: true, founded: true });
	assert.equal(s.name, 'Sasha');
	assert.equal(s.title, 'Premier');
	assert.equal(s.regime, 'standard', 'an unknown regime is dropped');
	assert.equal(s.companyId, null, 'only a UUID is a company id');
	assert.equal(s.seatAgentId, ID);
	assert.equal(s.portrait, null, 'a portrait of the wrong size is dropped');
	assert.equal(s.step, 'ministry');
	assert.equal(s.done, true);
	assert.equal(s.coffeeSeen, true);
	assert.equal(s.founded, true);
});

test('names and titles: one line, no control characters, cut to length, an empty title keeps the default', () => {
	assert.equal(cleanText('  Sasha\n\u0007 the\tGreat  ', 32), 'Sasha the Great');
	assert.equal(cleanText('x'.repeat(50), 32)?.length, 32);
	assert.equal(cleanText(42, 32), null);
	assert.equal(readSetup({ title: '   ' }).title, DEFAULT_SETUP.title);
	assert.equal(addressOf({ name: 'Sasha', title: 'General Secretary' }), 'General Secretary Sasha');
	assert.equal(addressOf({ name: '', title: 'General Secretary' }), 'General Secretary');
});

test('saving and loading round-trips, portrait and all; a refusing store is ignored', () => {
	const store = new Map<string, string>();
	const s = { ...DEFAULT_SETUP, name: 'Sasha', portrait: ARCHETYPES[2].pixels, archetype: 'marshal', regime: 'purge' as const };
	saveSetup(s, { setItem: (k, v) => store.set(k, v) });
	assert.ok(store.has(SETUP_KEY));
	assert.deepEqual(loadSetup({ getItem: (k) => store.get(k) ?? null }), s);
	assert.doesNotThrow(() => saveSetup(s, { setItem: () => { throw new Error('quota'); } }));
});

test('six archetypes, all well formed and all different; the first is the Chairman', () => {
	assert.equal(ARCHETYPES.length, 6);
	assert.deepEqual(ARCHETYPES.map((a) => a.name), ['The Moustache', 'The Bald Visionary', 'The Marshal', 'The Iron Lady of the Steppe', 'The Bureaucrat', 'The Babushka Supreme']);
	for (const a of ARCHETYPES) assert.ok(isPortrait(a.pixels), a.id);
	assert.equal(new Set(ARCHETYPES.map((a) => JSON.stringify(a.pixels))).size, 6);
	assert.equal(CHAIRMAN, ARCHETYPES[0].pixels);
	assert.ok(isPortrait(blankPortrait()));
	assert.equal(isPortrait(ARCHETYPES[0].pixels.map((r) => r.map(() => 'red'))), false, 'only #rrggbb colours');
});

test('the portrait hangs in a two-pixel gold frame around exactly the chosen picture', () => {
	const inside = ARCHETYPES[4].pixels;
	const b = ownerPortrait(inside).b;
	assert.equal(b.length, PORTRAIT_H + 4);
	assert.equal(b[0].length, PORTRAIT_W + 4);
	for (let y = 0; y < PORTRAIT_H; y++) assert.deepEqual(b[y + 2].slice(2, -2), inside[y]);
	assert.equal(b[0][0], '#8a6a10');
	assert.equal(b[1][5], b[b.length - 2][5], 'the inner gold band all round');
	assert.deepEqual(ownerPortrait().b, ownerPortrait(CHAIRMAN).b, 'the default is the Chairman');
	assert.ok(b.every((r) => r.every((c) => c !== null)), 'solid, so it covers the old one when hung over it');
});

test("the Ministry's poster and plaque are the same size and solid; the notice hangs on the director's wall", () => {
	const poster = ministrySign(false).b, plaque = ministrySign(true).b;
	assert.equal(poster.length, plaque.length);
	assert.equal(poster[0].length, plaque[0].length);
	assert.ok([...poster, ...plaque].every((r) => r.every((c) => c !== null)));
	assert.notDeepEqual(poster, plaque);
	assert.equal(MINISTRY_AT.wall, 'nw');
});

test('the pixelator snaps to the palette: palette colours stay, see-through is the ground, sepia uses only browns', () => {
	const rgba = new Uint8ClampedArray(PORTRAIT_W * PORTRAIT_H * 4);
	const hex = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
	for (let k = 0; k < PORTRAIT_W * PORTRAIT_H; k++) {
		const c = PORTRAIT_PALETTE[k % PORTRAIT_PALETTE.length];
		rgba.set([...hex(c), k === 0 ? 0 : 255], k * 4);
	}
	const p = snapToPalette(rgba, false);
	assert.ok(isPortrait(p));
	assert.equal(p[0][0], PORTRAIT_BG, 'a see-through pixel is the dark ground');
	for (let k = 1; k < 40; k++) assert.equal(p[Math.floor(k / PORTRAIT_W)][k % PORTRAIT_W], PORTRAIT_PALETTE[k % PORTRAIT_PALETTE.length]);
	const s = snapToPalette(rgba, true);
	assert.ok(s.flat().every((c) => SEPIA_PALETTE.includes(c)));
	assert.equal(snapToPalette(new Uint8ClampedArray(PORTRAIT_W * PORTRAIT_H * 4).fill(255), true)[5][5], SEPIA_PALETTE.at(-1), 'white is the palest brown');
});

test('the crop covers the frame, centred across and a little high', () => {
	const wide = coverCrop(400, 100);
	assert.equal(wide.h, PORTRAIT_H);
	assert.ok(wide.w >= PORTRAIT_W);
	assert.ok(Math.abs(wide.x * 2 + wide.w - PORTRAIT_W) < 1e-9, 'centred across');
	const tall = coverCrop(100, 1000);
	assert.equal(tall.w, PORTRAIT_W);
	assert.ok(tall.y < 0 && tall.y > (PORTRAIT_H - tall.h) / 2, 'shifted up from the middle');
});

test('the bucket fills one patch only, and a fill with the same colour changes nothing', () => {
	const g = blankPortrait();
	for (let y = 0; y < PORTRAIT_H; y++) g[y][10] = '#b02a22';
	assert.ok(floodFill(g, 2, 2, '#e6b92e'));
	assert.equal(g[5][9], '#e6b92e');
	assert.equal(g[5][11], PORTRAIT_BG, 'the wall stops it');
	assert.equal(g[5][10], '#b02a22');
	assert.equal(floodFill(g, 2, 2, '#e6b92e'), false);
	assert.equal(floodFill(g, -1, 2, '#000000'), false);
});

test('mirror paints both halves; off the canvas is ignored', () => {
	const g = blankPortrait();
	applyTool(g, 'pencil', 3, 4, '#b02a22', true);
	assert.equal(g[4][3], '#b02a22');
	assert.equal(g[4][mirrorX(3)], '#b02a22');
	assert.equal(mirrorX(3), PORTRAIT_W - 4);
	applyTool(g, 'pencil', 5, 6, '#b02a22', false);
	assert.equal(g[6][mirrorX(5)], PORTRAIT_BG);
	assert.doesNotThrow(() => applyTool(g, 'pencil', 99, 99, '#b02a22', true));
});

test('a photo\'s size is read from its header before decoding: PNG, GIF, WebP and JPEG', async () => {
	const { headerSize } = await import('../src/cockpit/pixelate');
	const png = new Uint8Array(24);
	png.set([0x89, 0x50, 0x4e, 0x47]);
	png.set([0, 0, 0x75, 0x30, 0, 0, 0x75, 0x30], 16);
	assert.deepEqual(headerSize(png), { w: 30000, h: 30000 });
	// GIF: a 320 × 240 screen, no colour table, one extension, then a frame inside the screen.
	const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00, 0x00, 0, 0, 0x21, 0xf9, 0x04, 0, 0, 0, 0, 0x00, 0x2c, 0, 0, 0, 0, 0x10, 0x00, 0x10, 0x00, 0]);
	assert.deepEqual(headerSize(gif), { w: 320, h: 240 });
	// The same 1 × 1 screen with a 16000 × 16000 first frame: the frame's size counts.
	const bomb = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 1, 0, 1, 0, 0x00, 0, 0, 0x2c, 0, 0, 0, 0, 0x80, 0x3e, 0x80, 0x3e, 0]);
	assert.deepEqual(headerSize(bomb), { w: 16000, h: 16000 });
	const webp = new Uint8Array(30);
	webp.set([...'RIFF'].map((c) => c.charCodeAt(0)));
	webp.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
	webp.set([0x3f, 0x1f, 0x00, 0xdf, 0x0e, 0x00], 24);
	assert.deepEqual(headerSize(webp), { w: 8000, h: 3808 });
	// A JPEG with an APP0 segment before its frame header.
	const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x1f, 0x40, 0x03, 0, 0, 0, 0, 0, 0]);
	assert.deepEqual(headerSize(jpeg), { w: 8000, h: 4000 });
	assert.equal(headerSize(new Uint8Array([1, 2, 3, 4])), null, 'an unknown format reads as unreadable (and is refused)');
	const zero = new Uint8Array(24);
	zero.set([0x89, 0x50, 0x4e, 0x47]);
	assert.equal(headerSize(zero), null, 'a zero size is no size');
	assert.equal(headerSize(new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff, 0xc0, 0x00])), null, 'a JPEG cut short after its fill bytes');
});
