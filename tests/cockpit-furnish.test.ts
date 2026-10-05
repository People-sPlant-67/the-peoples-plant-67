/**
 * Furnishing in the cockpit under a fake DOM and real Pixi objects (no renderer): the
 * furniture follows a layout (props, walkability, the plant's own posters lifted off the wall),
 * the keyboard picks, moves, turns, puts down and takes away, nothing is put down where it does
 * not fit, the pointer drags a piece, Put everything back, the store keeps a layout per company,
 * and a comrade walking into a new piece goes round it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { Container, Sprite, Texture } from 'pixi.js';
import { renderPiece } from '../src/art/furniture';
import type { V3 } from '../src/art/sdf';
import { type Layout, emptyLayout } from '../src/world/layout';
import { segmentClear, tileCentre, tileOf } from '../src/world/path';
import { buildWorld } from '../src/world/zones';

const win = new Window({ width: 1200, height: 800 });
Object.assign(globalThis, { document: win.document, ImageData: class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} } });
const { createFurnishings } = await import('../src/cockpit/furnishings');
const { createFurnish } = await import('../src/cockpit/furnish');
const { createLayoutStore, LAYOUT_KEY } = await import('../src/cockpit/layout-store');
const { createCrew } = await import('../src/cockpit/crew');

/** A texture that needs no canvas. */
const tex = (): Texture => new Texture({ source: Texture.WHITE.source });

/**
 * The furniture and furnishing over a fresh world and a stand-in stage.
 *
 * @param standing Where comrades stand.
 * @returns The parts, and what was saved.
 */
function setup(standing: V3[] = []) {
	const world = buildWorld();
	const props = new Map(world.scene.props.map((p) => { const s = new Sprite(Texture.EMPTY); s.position.set(p.x, p.y); return [p.id, s] as const; }));
	let refreshed = 0, floors = 0;
	const stage = { layer: new Container(), wall: new Container(), props, refreshBase: () => { refreshed++; } };
	const fx = createFurnishings({
		world, stage: stage as never,
		piece: async (kind, facing) => { const f = renderPiece(kind, facing); return { w: f.w, h: f.h, rgba: f.rgba, top: { x: f.ax, y: f.ay } }; },
		refloor: () => { floors++; },
		makeTexture: tex,
	});
	const saved: Layout[] = [];
	const stageEl = win.document.createElement('div') as unknown as HTMLElement;
	win.document.body.append(stageEl as never);
	const cam = { x: 0, y: 0, zoom: 1 };
	let n = 0;
	const fu = createFurnish({
		world, stage: stage as never, stageEl, furnishings: fx,
		cam: () => cam, view: () => ({ w: 1200, h: 800 }),
		glideTo: () => {},
		standing: () => standing,
		save: (l) => saved.push(l),
		makeTexture: tex,
		newId: () => `n${n++}`,
	});
	for (const e of fu.els) win.document.body.append(e as never);
	const key = (k: string) => { const e = new win.KeyboardEvent('keydown', { key: k }) as unknown as KeyboardEvent; return fu.key(e); };
	/** An element of this furnishing's own (each test adds a drawer to the page). */
	const q = <T extends Element>(sel: string): T => {
		for (const e of fu.els) { if (e.matches(sel)) return e as unknown as T; const f = e.querySelector(sel); if (f) return f as unknown as T; }
		throw new Error(`no ${sel}`);
	};
	/** Press Enter on the tile cursor, as the keyboard does (a click with no pointer). */
	const enter = () => q<HTMLElement>('.p67-furnish-cursor').dispatchEvent(new win.MouseEvent('click', { detail: 0 }) as unknown as Event);
	/** Pick a drawer item with the keyboard. */
	const pick = (kind: string) => q<HTMLElement>(`.p67-furnish-item[data-kind="${kind}"]`).dispatchEvent(new win.MouseEvent('click', { detail: 0 }) as unknown as Event);
	/** Move the cursor to a tile with the arrow keys: right and left along x, down and up along y. */
	const goTo = (tx: number, ty: number) => {
		for (let k = 0; k < 80; k++) {
			const [cx, cy] = fu.state().cursor;
			if (cx === tx && cy === ty) return;
			key(cx < tx ? 'ArrowRight' : cx > tx ? 'ArrowLeft' : cy < ty ? 'ArrowDown' : 'ArrowUp');
		}
		throw new Error(`the cursor never reached ${tx},${ty}`);
	};
	/**
	 * A point on a placed thing's own pixels.
	 *
	 * @param id Thing.
	 * @returns Base-layer point.
	 */
	const on = (id: string): { x: number; y: number } => {
		const b = fx.boxOf(id)!;
		for (let j = Math.floor(b.h / 2); j < b.h; j++) for (let i = 0; i < b.w; i++) if (fx.thingAt(b.x + i + 0.5, b.y + j + 0.5) === id) return { x: b.x + i + 0.5, y: b.y + j + 0.5 };
		throw new Error(`nothing of ${id} to press`);
	};
	return { world, stage, fx, fu, saved, key, q, enter, pick, goTo, on, stageEl, cam, refreshed: () => refreshed, floors: () => floors };
}

/** Let the stand-in workers answer. */
const settle = () => new Promise((r) => setTimeout(r, 0));

test('the furniture follows a layout: props, walkability, the plant\'s own props and posters', async () => {
	const s = setup();
	const { world, fx } = s;
	const tile: [number, number] = [21, 10];
	const k = tile[1] * world.grid.w + tile[0];
	assert.equal(world.grid.walkable[k], 1);
	const crates = world.scene.props.find((p) => p.id === 'crates')!;
	const was = { x: crates.x, y: crates.y, x0: crates.foot.x0 };
	const base = world.scene.base, plan = world.walls.posters.find((h) => h.id === 'poster-plan')!;
	const pixel = ((plan.over.y + 20) * base.w + plan.over.x + 20) * 4;
	fx.set({ ...emptyLayout(), pieces: [{ id: 'g', kind: 'globe', tile, facing: 0 }], moved: { crates: [0, 1] }, hung: { 'poster-plan': { wall: 'nw', at: 14 * world.tile, zTop: 122 } } });
	await settle();
	assert.ok(world.scene.props.some((p) => p.id === 'g'), 'the piece is a prop');
	assert.ok(s.stage.props.get('g'), 'with a sprite in the depth sort');
	assert.equal(world.grid.walkable[k], 0, 'nobody stands on it');
	assert.equal(s.floors(), 1, 'the crew are told');
	assert.equal(crates.foot.x0, was.x0, 'one tile along y keeps x');
	assert.equal(crates.x, was.x - 32);
	assert.equal(crates.y, was.y + 16);
	assert.deepEqual([...base.rgba.subarray(pixel, pixel + 4)], [...plan.under.rgba.subarray(((20 * plan.under.w) + 20) * 4, ((20 * plan.under.w) + 20) * 4 + 4)], 'the plan poster is lifted off the wall');
	assert.equal(s.refreshed(), 1);
	assert.equal(s.stage.wall.children.length, 1, 'and hangs as a sprite where it went');
	assert.ok(s.on('g'), 'the piece can be pressed');
	fx.set(emptyLayout());
	assert.ok(!world.scene.props.some((p) => p.id === 'g'));
	assert.equal(world.grid.walkable[k], 1);
	assert.deepEqual([...base.rgba.subarray(pixel, pixel + 4)], [...plan.over.rgba.subarray(((20 * plan.over.w) + 20) * 4, ((20 * plan.over.w) + 20) * 4 + 4)], 'and back exactly');
	assert.equal(crates.x, was.x);
	assert.equal(s.stage.wall.children.length, 0);
});

test('the keyboard: pick from the drawer, move, turn, put down; Escape lets go, then closes and gives focus back', async () => {
	const s = setup();
	const opener = win.document.createElement('button') as unknown as HTMLButtonElement;
	win.document.body.append(opener as never);
	s.fu.open(opener);
	assert.equal((win.document.activeElement as unknown as HTMLElement).className, 'p67-furnish-cursor');
	s.goTo(21, 10);
	s.pick('chess');
	await settle();
	assert.equal(s.fu.state().held, 'n0');
	s.key('ArrowDown');
	s.key('ArrowRight');
	assert.deepEqual(s.fu.state().cursor, [22, 11]);
	s.key('r');
	s.enter();
	assert.deepEqual(s.fx.layout.pieces, [{ id: 'n0', kind: 'chess', tile: [22, 11], facing: 1 }]);
	assert.equal(s.saved.length, 1, 'kept');
	assert.equal(s.fu.state().selected, 'n0');
	// Picked up again from the cursor, held, then let go: nothing changes.
	s.enter();
	assert.equal(s.fu.state().held, 'n0');
	s.key('ArrowUp');
	assert.equal(s.key('Escape'), true);
	assert.equal(s.fu.state().held, null);
	assert.deepEqual(s.fx.layout.pieces[0].tile, [22, 11]);
	s.key('Escape');
	assert.equal(s.fu.active, false);
	assert.equal(win.document.activeElement, opener as never, 'focus goes back to the tool wall');
});

test('nothing is put down where it does not fit, and the reason is said', () => {
	const s = setup();
	s.fu.open(null);
	const station = s.world.zones.production.stations[0];
	s.goTo(...tileOf(s.world, station));
	s.pick('palm');
	assert.equal(s.fu.state().misfit, 'workplace');
	s.enter();
	assert.deepEqual(s.fx.layout.pieces, []);
	assert.equal(s.saved.length, 0);
	assert.match(s.q<HTMLElement>('.p67-furnish .p67-sr').textContent ?? '', /Comrades work or stand there\. It was not put down\./);
});

test('nobody has a piece put down on them', () => {
	const s = setup([tileCentre(buildWorld(), 21, 10)]);
	s.fu.open(null);
	s.goTo(21, 10);
	s.pick('globe');
	assert.equal(s.fu.state().misfit, 'someone');
});

test('the plant\'s own props move by keyboard and Delete sends them home; Put everything back clears all', () => {
	const s = setup();
	s.fu.open(null);
	const crates = s.world.scene.props.find((p) => p.id === 'crates')!.foot;
	const [cx, cy] = [Math.floor((crates.x0 + crates.x1) / 2 / s.world.tile), Math.floor((crates.y0 + crates.y1) / 2 / s.world.tile)];
	s.goTo(cx, cy);
	s.enter();
	assert.equal(s.fu.state().held, 'crates');
	s.key('ArrowDown');
	s.enter();
	assert.deepEqual(s.fx.layout.moved, { crates: [0, 1] });
	s.goTo(cx, cy + 1);
	s.key('Delete');
	assert.deepEqual(s.fx.layout.moved, {}, 'home again');
	s.pick('globe');
	s.goTo(21, 10);
	s.enter();
	assert.equal(s.fx.layout.pieces.length, 1);
	s.q<HTMLButtonElement>('.p67-furnish-reset').click();
	assert.deepEqual(s.fx.layout, emptyLayout());
	assert.deepEqual(s.saved.at(-1), emptyLayout());
});

test('the pointer drags a piece to a new tile; a short press selects it and its buttons turn and take it away', async () => {
	const s = setup();
	s.fx.set({ ...emptyLayout(), pieces: [{ id: 'g', kind: 'globe', tile: [21, 10], facing: 0 }] });
	await settle();
	s.fx.set(s.fx.layout);
	s.fu.open(null);
	const from = s.on('g');
	const ev = (type: string, p: { x: number; y: number }) => s.stageEl.dispatchEvent(new win.PointerEvent(type, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1, bubbles: true }) as unknown as Event);
	ev('pointerdown', from);
	// One tile up to the right: −y.
	ev('pointermove', { x: from.x + 16, y: from.y - 8 });
	ev('pointermove', { x: from.x + 32, y: from.y - 16 });
	assert.equal(s.fu.state().held, 'g');
	ev('pointerup', { x: from.x + 32, y: from.y - 16 });
	assert.deepEqual(s.fx.layout.pieces[0].tile, [21, 9]);
	const at = s.on('g');
	ev('pointerdown', at);
	ev('pointerup', at);
	assert.equal(s.fu.state().selected, 'g');
	s.fu.tick(16);
	assert.equal(s.q<HTMLElement>('.p67-furnish-controls').hidden, false);
	s.q<HTMLButtonElement>('.p67-furnish-turn').click();
	assert.equal(s.fx.layout.pieces[0].facing, 1);
	s.q<HTMLButtonElement>('.p67-furnish-remove').click();
	assert.deepEqual(s.fx.layout.pieces, []);
});

test('letting go mid-drag (Escape, Delete, a cancelled pointer) really lets go; Ctrl+R is left to the browser', async () => {
	const s = setup();
	s.fx.set({ ...emptyLayout(), pieces: [{ id: 'g', kind: 'globe', tile: [21, 10], facing: 0 }] });
	await settle();
	s.fx.set(s.fx.layout);
	s.fu.open(null);
	const ev = (type: string, p: { x: number; y: number }) => s.stageEl.dispatchEvent(new win.PointerEvent(type, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1, bubbles: true }) as unknown as Event);
	for (const how of ['Escape', 'cancel'] as const) {
		const from = s.on('g');
		ev('pointerdown', from);
		ev('pointermove', { x: from.x + 32, y: from.y - 16 });
		assert.equal(s.fu.state().held, 'g');
		if (how === 'Escape') s.key('Escape'); else ev('pointercancel', from);
		assert.equal(s.fu.state().held, null, how);
		ev('pointermove', { x: from.x + 48, y: from.y - 24 });
		ev('pointerup', { x: from.x + 48, y: from.y - 24 });
		assert.equal(s.fu.state().held, null, `${how}: not picked up again`);
		assert.deepEqual(s.fx.layout.pieces[0].tile, [21, 10], `${how}: it stays`);
	}
	const from = s.on('g');
	ev('pointerdown', from);
	ev('pointermove', { x: from.x + 32, y: from.y - 16 });
	s.key('Delete');
	ev('pointermove', { x: from.x + 48, y: from.y - 24 });
	ev('pointerup', { x: from.x + 48, y: from.y - 24 });
	assert.deepEqual(s.fx.layout.pieces, [], 'taken away, and stays away');
	const ctrl = new win.KeyboardEvent('keydown', { key: 'r', ctrlKey: true }) as unknown as KeyboardEvent;
	assert.equal(s.fu.key(ctrl), false, 'the browser reloads');
});

test('one of the plant\'s own posters comes off the wall while it is held; Put everything back can be undone', () => {
	const s = setup();
	const base = s.world.scene.base, glory = s.world.walls.posters.find((h) => h.id === 'poster-glory')!;
	const k = ((glory.over.y + 30) * base.w + glory.over.x + 30) * 4;
	const at = (p: typeof glory.over) => [...p.rgba.subarray(((30 * p.w) + 30) * 4, ((30 * p.w) + 30) * 4 + 3)];
	s.fu.open(null);
	s.goTo(12, 0);
	s.enter();
	assert.equal(s.fu.state().held, 'poster-glory');
	assert.deepEqual([...base.rgba.subarray(k, k + 3)], at(glory.under), 'the wall shows through while it is held');
	s.key('Escape');
	assert.deepEqual([...base.rgba.subarray(k, k + 3)], at(glory.over), 'back up when let go');
	s.pick('globe');
	s.goTo(21, 10);
	s.enter();
	const furnished = s.fx.layout;
	const reset = s.q<HTMLButtonElement>('.p67-furnish-reset');
	reset.click();
	assert.deepEqual(s.fx.layout, emptyLayout());
	assert.equal(reset.textContent, 'Undo putting everything back');
	reset.click();
	assert.deepEqual(s.fx.layout, furnished, 'undone');
	assert.equal(reset.textContent, 'Put everything back');
});

test('a piece dragged from the drawer follows the pointer and is put down where it is let go', async () => {
	const s = setup();
	s.fu.open(null);
	const item = s.q<HTMLElement>('.p67-furnish-item[data-kind="globe"]');
	const [ax, ay] = (await import('../src/art/render')).project(s.world.scene.base, tileCentre(s.world, 21, 10));
	const ev = (type: string, x: number, y: number) => item.dispatchEvent(new win.PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 2, bubbles: true }) as unknown as Event);
	ev('pointerdown', 5, 790);
	ev('pointermove', 15, 780);
	ev('pointermove', ax, ay - 18);
	assert.equal(s.fu.state().misfit, null);
	ev('pointerup', ax, ay - 18);
	assert.deepEqual(s.fx.layout.pieces.map((p) => p.tile), [[21, 10]]);
	assert.equal(s.fu.state().held, null);
});

test('the store keeps one layout per company and shrugs off junk', () => {
	const mem = new Map<string, string>();
	const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
	const store = createLayoutStore(storage);
	const l: Layout = { ...emptyLayout(), pieces: [{ id: 'fa-1', kind: 'palm', tile: [3, 4], facing: 0 }] };
	store.save('co1', l);
	assert.deepEqual(store.load('co1'), l);
	assert.deepEqual(store.load('co2'), emptyLayout());
	store.save('co1', emptyLayout());
	assert.equal(mem.get(LAYOUT_KEY), '{}', 'an empty layout is forgotten');
	mem.set(LAYOUT_KEY, '{not json');
	assert.deepEqual(store.load('co1'), emptyLayout());
	mem.set(LAYOUT_KEY, JSON.stringify({ co1: { pieces: 'lots' } }));
	assert.deepEqual(store.load('co1'), emptyLayout());
	assert.deepEqual(createLayoutStore(null).load('co1'), emptyLayout(), 'no storage, no layout');
	for (let k = 0; k < 25; k++) store.save(`c${k}`, l);
	assert.equal(Object.keys(JSON.parse(mem.get(LAYOUT_KEY)!)).length, 20, 'only the latest twenty companies');
});

test('a comrade walking into a new piece goes round it to the same place', () => {
	const world = buildWorld();
	const crew = createCrew(world, { rng: () => 0.5 });
	const a = { id: 'a1', name: 'Shock Worker', title: 'Generalist Executor', role: null, status: 'running', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null };
	const snap = (status: string, at: number) => ({ at, session: 'ok' as const, message: null, companyId: null, companyName: 'Test Works', agents: [{ ...a, status, errorReason: status === 'error' ? 'Out of rivets.' : null }], badges: null, badgesStale: false, approvals: null });
	crew.apply(snap('running', 1_000_000));
	crew.apply(snap('error', 1_020_000));
	const c = crew.get('a1')!;
	const goal = c.path.at(-1)!;
	// Something new stands on a tile in the middle of the walk.
	const mid = c.path[Math.floor(c.path.length / 2)];
	const [tx, ty] = tileOf(world, mid);
	const L = world.tile;
	const foot = { x0: tx * L + 8, x1: (tx + 1) * L - 8, y0: ty * L + 8, y1: (ty + 1) * L - 8, z0: 0 };
	world.scene.props.push({ id: 'in-the-way', sprite: world.scene.base, x: 0, y: 0, foot });
	world.grid.walkable[ty * world.grid.w + tx] = 0;
	const pts = [c.pos, ...c.path];
	assert.ok(!pts.slice(1).every((p, k) => segmentClear(pts[k], p, [foot])), 'the old walk runs into it');
	crew.refloor();
	const now = [c.pos, ...c.path];
	assert.ok(now.slice(1).every((p, k) => segmentClear(now[k], p, [foot])), 'the new walk goes round');
	assert.deepEqual(c.path.at(-1), goal, 'to the same place');
});
