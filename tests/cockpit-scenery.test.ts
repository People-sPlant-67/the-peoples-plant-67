/**
 * The fixtures on the stage under a fake DOM and real Pixi objects (no renderer): the
 * keyboard's buttons follow the camera, Tab outlines a fixture and Enter opens it, the pointer and
 * the keyboard each outline what they last touched, a comrade in front takes the pointer, the
 * wobble runs once per arrival, the counts swap the board's picture, the telephone rings, and
 * focus coming back from a note never moves the camera.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { Container, Sprite, Texture } from 'pixi.js';
import { buildWorld, fixturePatches } from '../src/world/zones';
import type { FixtureId } from '../src/world/zones';

const win = new Window({ width: 1200, height: 800 });
Object.assign(globalThis, { document: win.document });
const { createScenery } = await import('../src/cockpit/scenery');
const { WOBBLE_STEP_MS, WOBBLE } = await import('../src/cockpit/fixtures');

const world = buildWorld();
const patches = fixturePatches(world.scene);

/**
 * The scenery over a stand-in stage, with the camera and calls to hand.
 *
 * @returns Scenery and its parts.
 */
function setup() {
	const props = new Map(world.scene.props.map((p) => { const s = new Sprite(Texture.EMPTY); s.position.set(p.x, p.y); return [p.id, s] as const; }));
	const stage = { layer: new Container(), wall: new Container(), props } as never;
	const stageEl = win.document.createElement('div') as unknown as HTMLElement;
	win.document.body.append(stageEl as never);
	const cam = { x: 0, y: 0, zoom: 2 };
	const opened: [FixtureId, HTMLElement | null][] = [];
	const glides: { x: number; y: number }[] = [];
	let comrade: string | null = null;
	const sc = createScenery({
		stage, scene: world.scene, stageEl,
		cam: () => cam, view: () => ({ w: 1200, h: 800 }),
		comradeAt: () => comrade,
		label: (id) => `Label ${id}`,
		open: (id, opener) => opened.push([id, opener]),
		glideTo: (p) => glides.push(p),
		reducedMotion: () => false,
		makeTexture: () => new Texture({ source: Texture.WHITE.source }),
	});
	for (const e of sc.els) win.document.body.append(e as never);
	/**
	 * Move the pointer over a world point.
	 *
	 * @param x World x.
	 * @param y World y.
	 * @param buttons Mouse buttons held.
	 */
	const point = (x: number, y: number, buttons = 0) => stageEl.dispatchEvent(new win.PointerEvent('pointermove', { clientX: (x - cam.x) * cam.zoom, clientY: (y - cam.y) * cam.zoom, buttons }) as unknown as Event);
	/**
	 * The middle of a fixture, in world pixels.
	 *
	 * @param id Fixture.
	 * @returns Point.
	 */
	const mid = (id: FixtureId) => ({ x: patches[id].x + patches[id].w / 2, y: patches[id].y + patches[id].h / 2 });
	return { sc, cam, opened, glides, stageEl, point, mid, stage: stage as unknown as { layer: Container; wall: Container }, setComrade: (c: string | null) => { comrade = c; } };
}

test('the keyboard\'s buttons sit over their fixtures and follow the camera; Tab outlines, Enter opens', () => {
	const s = setup();
	s.cam.x = patches.radiogram.x - 100; s.cam.y = patches.radiogram.y - 100;
	s.sc.tick(16);
	const b = s.sc.button('radiogram');
	assert.equal(b.style.transform, 'translate(200px, 200px)');
	assert.equal(b.style.width, `${Math.round(patches.radiogram.w * 2)}px`);
	assert.equal(b.getAttribute('aria-label'), 'Label radiogram');
	s.cam.x += 10;
	s.sc.tick(16);
	assert.equal(b.style.transform, 'translate(180px, 200px)', 'it moves with the plant');
	b.focus();
	assert.equal(s.sc.active, 'radiogram');
	assert.equal(s.glides.length, 0, 'on screen already: the camera stays');
	b.click();
	assert.deepEqual(s.opened, [['radiogram', b]], 'opened, with the button to come back to');
	s.cam.x = -5000;
	s.sc.button('plaque').focus();
	assert.equal(s.glides.length, 1, 'off screen: the camera goes to it');
	s.sc.els.forEach((e) => e.remove());
});

test('the pointer outlines what it rests on, unless a comrade stands in front or a drag is under way; the latest input wins', () => {
	const s = setup();
	s.cam.x = patches.radiogram.x - 100; s.cam.y = patches.radiogram.y - 100;
	s.sc.tick(16);
	const m = s.mid('radiogram');
	s.point(m.x, m.y);
	assert.equal(s.sc.active, 'radiogram');
	assert.equal(s.stageEl.style.cursor, 'pointer');
	s.point(m.x + 1, m.y, 1);
	assert.equal(s.sc.active, null, 'a drag is not a hover');
	s.setComrade('c1');
	s.point(m.x, m.y);
	assert.equal(s.sc.active, null, 'a comrade in front is pointed at, not the set behind');
	s.setComrade(null);
	s.sc.button('noticeboard').focus();
	assert.equal(s.sc.active, 'noticeboard');
	s.point(m.x, m.y);
	assert.equal(s.sc.active, 'radiogram', 'the pointer moved last');
	s.sc.els.forEach((e) => e.remove());
});

test('one wobble per arrival, a pixel each way; the ring hops the telephone and shows its marks', () => {
	const s = setup();
	s.cam.x = patches.radiogram.x - 100; s.cam.y = patches.radiogram.y - 100;
	const copies = () => s.stage.layer.children.filter((c) => c.visible) as Sprite[];
	const m = s.mid('radiogram');
	s.point(m.x, m.y);
	const xs: number[] = [];
	for (let k = 0; k < WOBBLE.length + 3; k++) {
		s.sc.tick(WOBBLE_STEP_MS);
		// The radiogram's copy wears its live sprite's picture (here the stand-in's empty one).
		xs.push(copies().some((c) => c.texture === Texture.EMPTY) ? 1 : 0);
	}
	assert.ok(xs.slice(0, WOBBLE.length - 1).some(Boolean), 'it wobbles');
	assert.deepEqual(xs.slice(-3), [0, 0, 0], 'once, then still');
	s.sc.setRinging(true);
	assert.equal(s.sc.ringing, true);
	s.sc.tick(16);
	assert.ok(copies().length >= 2, 'the glow and the marks are up');
	s.sc.setRinging(false);
	s.sc.tick(16);
	assert.equal(s.sc.ringing, false);
	s.sc.els.forEach((e) => e.remove());
});

test('the counts swap the board\'s picture and blank it again; the old picture is let go', () => {
	const s = setup();
	const board = () => s.stage.wall.children[0] as Sprite;
	assert.equal(board().visible, false);
	s.sc.setCounts([1, 2, 3]);
	assert.equal(board().visible, true);
	const first = board().texture;
	s.sc.setCounts([1, 2, 3]);
	assert.equal(board().texture, first, 'the same counts are not redrawn');
	let destroyed = false;
	first.destroy = () => { destroyed = true; };
	s.sc.setCounts([1, 2, 4]);
	assert.ok(destroyed, 'the old picture is destroyed');
	s.sc.setCounts(null);
	assert.equal(board().visible, false);
	s.sc.els.forEach((e) => e.remove());
});

test('the note opens beside its fixture; closed from the keyboard, focus comes back without moving the camera; closed by the pointer, it stays put', () => {
	const s = setup();
	s.cam.x = patches.telephone.x - 100; s.cam.y = patches.telephone.y - 100;
	s.sc.tick(16);
	const b = s.sc.button('telephone');
	b.focus();
	s.sc.showNote('telephone', 'Telephone', ['Last checked at noon.'], b);
	const note = s.sc.els[2];
	assert.equal(note.hidden, false);
	assert.equal(s.sc.noteFor, 'telephone');
	assert.match(note.textContent ?? '', /Last checked at noon\./);
	assert.equal(win.document.activeElement, note, 'focus goes into the note');
	s.cam.x += 5000;
	s.glides.length = 0;
	note.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	assert.equal(note.hidden, true);
	assert.equal(win.document.activeElement, b, 'focus is back on the telephone\'s button');
	assert.equal(s.glides.length, 0, 'and the camera did not go back to the office');
	s.sc.showNote('telephone', 'Telephone', ['Again.'], b);
	assert.equal(s.sc.closeNote(), true);
	assert.notEqual(win.document.activeElement, b, 'closed by the pointer: focus is not pulled back');
	s.sc.els.forEach((e) => e.remove());
});

test('while the line is down the emergency lamp flashes once a second; lit and still with less motion; dark again after', () => {
	const s = setup();
	const lamp = () => s.stage.wall.children.at(-1)!;
	assert.equal(lamp().visible, false);
	s.sc.setRinging(true);
	const seen: boolean[] = [];
	for (let k = 0; k < 8; k++) { s.sc.tick(250); seen.push(lamp().visible); }
	assert.ok(seen.includes(true) && seen.includes(false), 'it flashes');
	assert.equal(seen.filter(Boolean).length, 4, 'on half the time');
	s.sc.setRinging(false);
	s.sc.tick(16);
	assert.equal(lamp().visible, false);
	s.sc.els.forEach((e) => e.remove());
});
