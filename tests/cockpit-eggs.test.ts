/**
 * The easter eggs on the real world and crew, under a fake DOM and real Pixi objects (no
 * renderer): the Konami code; the parade (who marches, the column on its lap, a scene taking a
 * marcher, everyone let go at the end, marking time when no lap is clear); the bust's wink (five
 * quick clicks, not four or slow ones); the plan watch (the fall to zero, once a day, not on opening,
 * not on a failed check); the medal; and Sputnik's and the bear's visits.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { Container, Texture } from 'pixi.js';
import type { V3 } from '../src/art/sdf';
import type { AgentState, Snapshot } from '../src/live/types';
import { DIRS } from '../src/art/avatar';
import { type AmbientRequest, ambientKey } from '../src/art/sprite-job';
import { segmentClear } from '../src/world/path';
import { buildWorld } from '../src/world/zones';
import type { World } from '../src/world/types';

const win = new Window();
Object.assign(globalThis, { document: win.document, ImageData: win.ImageData });
const { createCrew, PARADE_HOLD, MEDAL_HOLD, inScene } = await import('../src/cockpit/crew');
const { FILE_HALF, GATHER_MAX_MS, LAPS, READY_MS, ROW_GAP, axisOf, createKonami, createParade, lapClear, trackOf } = await import('../src/cockpit/parade');
const { WINK_CLICKS, WINK_GAP_MS, createWink } = await import('../src/cockpit/wink');
const { createPlanWatch, createCelebration, dayOf, MEDAL_WALK_MS, PIN_MS, SALUTE_MS } = await import('../src/cockpit/plan-met');
const { BEAR_GAP, BEAR_IN, BEAR_VISIT, SPUTNIK_GAP, SPUTNIK_S, createVisitors } = await import('../src/cockpit/visitors');
const { WALK_SPEED } = await import('../src/cockpit/walk');

const world = buildWorld();
const L = world.tile;
const tex = (): Texture => new Texture({ source: Texture.WHITE.source });
const pixels = async () => ({ w: 2, h: 2, rgba: new Uint8ClampedArray(16), top: { x: 1, y: 1 } });

/**
 * A fictional agent.
 *
 * @param id Id.
 * @param status Status.
 * @param title Title (a persona's, to send them somewhere).
 * @returns Agent.
 */
function agent(id: string, status = 'idle', title = 'Generalist Executor'): AgentState {
	return { id, name: `Comrade ${id}`, title, role: null, status, pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null };
}

/**
 * A good snapshot.
 *
 * @param agents Roster.
 * @returns Snapshot.
 */
function snap(agents: AgentState[]): Snapshot {
	return { at: 1_000_000, session: 'ok', message: null, companyId: null, companyName: 'Test Works', agents, badges: null, badgesStale: false, approvals: null };
}

test('the Konami code: the whole of it fires once; a slip starts it again; B and A in either case', () => {
	const k = createKonami();
	const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'B', 'A'];
	assert.deepEqual(code.map((c) => k(c)), [...Array(9).fill(false), true]);
	assert.equal(code.map((c) => k(c)).some(Boolean), true, 'and again');
	// An extra ↑ before it still counts: the last ten keys are what matter.
	assert.equal(['ArrowUp', ...code].map((c) => k(c)).at(-1), true);
	// A wrong key in the middle does not.
	assert.equal([...code.slice(0, 5), 'x', ...code.slice(5)].map((c) => k(c)).some(Boolean), false);
	// On a Russian layout B and A type И and Ф: the key's place on the keyboard counts.
	const ru = createKonami();
	assert.equal([...code.slice(0, 8).map((c) => ru(c)), ru('и', 'KeyB'), ru('ф', 'KeyA')].at(-1), true);
	// Nine keys are not ten.
	assert.equal(code.slice(0, 9).map((c) => k(c)).some(Boolean), false);
});

test('every picture of the life around the plant has a cache key of its own (a flag is never the far train)', () => {
	const base = world.scene.base;
	const reqs: AmbientRequest[] = [
		{ ambient: 'puff', k: 0 }, { ambient: 'puff', k: 1 }, { ambient: 'pigeon', f: 0, yaw: 0 }, { ambient: 'pigeon', f: 1, yaw: 0 },
		{ ambient: 'farTrain', base }, { ambient: 'landmark', id: 'a', base }, { ambient: 'sputnik' },
		...DIRS.map((dir): AmbientRequest => ({ ambient: 'flag', dir })),
		...(['SE', 'SW', 'NW', 'NE'] as const).map((dir): AmbientRequest => ({ ambient: 'banner', dir })),
		...[0, 1, 4, 5].flatMap((f) => [0, 90].map((yaw): AmbientRequest => ({ ambient: 'bear', f, yaw }))),
	];
	assert.equal(new Set(reqs.map(ambientKey)).size, reqs.length);
});

test('the laps: the first is clear as the plant is built; the files keep abreast, also round the corners', () => {
	const feet = world.scene.props.map((p) => p.foot);
	assert.equal(lapClear(trackOf(LAPS[0], L), feet), true);
	for (const lap of LAPS) {
		const t = trackOf(lap, L);
		for (let s = 0; s < t.length; s += 7) {
			const a = t.at(s, -1), b = t.at(s, 1);
			assert.ok(Math.abs(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) - 2 * FILE_HALF) < 0.01, 'two files, a fixed gap apart');
			assert.equal(a.heading, b.heading);
		}
		assert.equal(axisOf(t.at(1, 0).heading), 'SE', 'off along the back lane');
	}
	// A table across the lap: not clear.
	assert.equal(lapClear(trackOf(LAPS[0], L), [...feet, { x0: 12 * L, y0: 14 * L, x1: 13 * L, y1: 14.6 * L, z0: 0 }]), false);
});

/**
 * A crew and a parade, run along together.
 *
 * @param agents Roster.
 * @param w The parade's world (a crowded one, to leave no lap clear).
 * @returns Everything.
 */
function paradeSetup(agents: AgentState[], w: World = world) {
	const crew = createCrew(world, { rng: () => 0.5 });
	crew.apply(snap(agents));
	const played: string[] = [];
	const layer = new Container();
	const glides: { x: number; y: number }[] = [];
	const parade = createParade({
		crew, world: w, stage: { layer } as never, render: pixels, zOf: () => 1, prefetch: () => {},
		glideTo: (p) => glides.push(p), screenX: () => 0.5, play: (v) => played.push(v), makeTexture: tex,
	});
	/**
	 * Run for a while in 100 ms steps, or until a condition holds.
	 *
	 * @param ms Longest.
	 * @param until Condition.
	 * @returns Time taken, or -1.
	 */
	const run = async (ms: number, until: () => boolean = () => false): Promise<number> => {
		for (let t = 0; t <= ms; t += 100) {
			if (until()) return t;
			crew.step(100);
			parade.tick(100);
			parade.draw();
			if (t % 1000 === 0) await Promise.resolve();
		}
		return -1;
	};
	return { crew, parade, played, run, glides, layer };
}

test('the parade: everyone free falls in two abreast, marches a lap to the drum, and is let go where they were', async () => {
	const roster = [...['a', 'b', 'c', 'd', 'e'].map((id) => agent(id)), agent('w', 'running'), agent('rep', 'idle', 'The Commissar'), agent('cold', 'paused'), agent('busy')];
	const { crew, parade, played, run, glides, layer } = paradeSetup(roster);
	await run(3000);
	// Someone at the cloakroom stays out of it, and so does anyone in Siberia.
	assert.ok(crew.hold('busy', 'changing'));
	assert.equal(crew.get('cold')!.place.zone, 'siberia');
	const slots = new Map(crew.list().map((c) => [c.id, c.slot?.pos ?? null]));
	assert.equal(parade.start(), true);
	assert.equal(parade.start(), false, 'one at a time');
	assert.equal(glides.length, 1, 'the camera goes to watch');
	const s0 = parade.state();
	assert.equal(s0.stage, 'gather');
	// Each flag goes up as its bearer falls in.
	await run(GATHER_MAX_MS, () => crew.list().some((c) => c.held === PARADE_HOLD && !c.path.length));
	assert.ok(layer.children.length > 1, 'a flag up before the column has formed');
	assert.equal(s0.lap, 0);
	assert.deepEqual(new Set(s0.marchers), new Set(['a', 'b', 'c', 'd', 'e', 'w', 'rep']));
	for (const id of s0.marchers) assert.equal(crew.get(id)!.held, PARADE_HOLD);
	assert.equal(inScene(crew.get('a')!), false, 'held lightly');
	assert.ok(await run(GATHER_MAX_MS, () => parade.state().stage !== 'gather') >= 0);
	assert.equal(parade.state().stage, 'ready');
	assert.equal(parade.state().marchers.length, 7, 'everyone fell in in time');
	// Flags for all but the front pair, who carry the banner.
	await run(READY_MS + 200, () => parade.state().stage === 'march');
	assert.equal(parade.state().stage, 'march');
	assert.equal(parade.extras().length, 1, 'the banner, at the head');
	assert.ok(played.includes('snare'));
	await run(1000);
	// Two abreast, ROW_GAP apart, and all in step.
	const marching = parade.state().marchers.map((id) => crew.get(id)!);
	assert.ok(marching.every((c) => c.anim === 'walk' && c.path.length === 0));
	assert.equal(new Set(marching.map((c) => c.frame)).size, 1, 'in step');
	const near = marching.map((c) => Math.min(...marching.filter((o) => o !== c).map((o) => Math.hypot(o.pos[0] - c.pos[0], o.pos[1] - c.pos[1]))));
	// A lone marcher at the back walks in the middle, behind the last pair.
	assert.ok(near.every((n) => n > 2 * FILE_HALF - 1 && n < Math.hypot(ROW_GAP, FILE_HALF) + 1), `neighbours ${near.map(Math.round)}`);
	// A trial takes a marcher at once; the parade carries on without them.
	assert.ok(crew.hold('e', 'trial:e'));
	await run(200);
	assert.ok(!parade.state().marchers.includes('e'));
	crew.release('e', 'trial:e');
	// The lap done, everyone is let go and walks back to their place.
	const lap = trackOf(LAPS[0], L).length / WALK_SPEED;
	assert.ok(await run(lap + 1000, () => parade.state().stage === 'off') >= 0);
	assert.equal(parade.extras().length, 0);
	for (const id of ['a', 'b', 'c', 'd', 'w', 'rep']) assert.equal(crew.get(id)!.held, null);
	await run(30_000);
	for (const id of ['a', 'b', 'c', 'd', 'w']) {
		const c = crew.get(id)!, home = slots.get(id)!;
		assert.ok(Math.hypot(c.pos[0] - home[0], c.pos[1] - home[1]) < 1, `${id} is back`);
	}
	assert.equal(crew.get('busy')!.held, 'changing', 'the cloakroom never let go');
});

test('the parade marks time where they stand when no lap round the Canteen is clear', async () => {
	const blocked: World = { ...world, scene: { ...world.scene, props: [...world.scene.props, { id: 'junk', foot: { x0: 9 * L, y0: 13 * L, x1: 24 * L, y1: 20 * L, z0: 0 } } as never] } };
	const { crew, parade, run } = paradeSetup(['a', 'b', 'c'].map((id) => agent(id)), blocked);
	await run(1000);
	const before = crew.list().map((c) => c.pos.slice());
	assert.equal(parade.start(), true);
	assert.equal(parade.state().stage, 'mark');
	assert.equal(parade.state().lap, null);
	await run(3000);
	crew.list().forEach((c, k) => {
		assert.equal(c.anim, 'walk');
		assert.ok(Math.hypot(c.pos[0] - before[k][0], c.pos[1] - before[k][1]) < 1, 'on the spot');
	});
	parade.stop();
	assert.equal(parade.state().stage, 'off');
	assert.ok(crew.list().every((c) => c.held === null));
});

test('the bust winks at five quick clicks; not at four, nor at slow ones, nor across two busts', () => {
	let now = 0;
	const played: string[] = [];
	const box = { x: 10, y: 10, w: 20, h: 40 };
	const w = createWink({
		stage: { bubbles: new Container() } as never,
		bustAt: (x) => (x < 50 ? { id: 'pal-lenin', box } : x < 100 ? { id: 'piece-1', box } : null),
		screenX: () => 0.5, play: (v) => played.push(v), now: () => now, makeTexture: tex,
	});
	const clicks = (n: number, gap: number, x = 20) => { for (let k = 0; k < n; k++) { now += gap; w.click({ x, y: 20 }); } };
	clicks(WINK_CLICKS - 1, 200);
	assert.equal(w.state().winking, null);
	clicks(1, WINK_GAP_MS + 1);
	assert.equal(w.state().winking, null, 'too slow: counting starts again');
	clicks(WINK_CLICKS - 1, 200);
	assert.equal(w.state().winking, 'pal-lenin');
	assert.deepEqual(played, ['ding']);
	w.tick(3000);
	assert.equal(w.state().winking, null, 'and it passes');
	clicks(3, 200);
	clicks(2, 200, 70);
	assert.equal(w.state().winking, null, 'two busts do not add up');
	clicks(2, 200, 70);
	clicks(1, 200, 500);
	assert.equal(w.state().clicks, 0, 'the floor resets it');
	clicks(3, 200);
	w.reset();
	clicks(2, 200);
	assert.equal(w.state().winking, null, 'so does a comrade');
});

test('the plan watch: fires on the fall to zero, once a day; not on opening at zero, nor on a failed or stale check', () => {
	let kept: string | null = null, today = '2026-10-01', met = 0;
	const watch = createPlanWatch({ today: () => today, load: () => kept, save: (d) => { kept = d; }, onMet: () => met++ });
	watch.see([0, 0, 0], true);
	assert.equal(met, 0, 'opening at zero');
	watch.see([2, 1, 0], true);
	watch.see([0, 0, 0], false);
	assert.equal(met, 0, 'a stale read');
	watch.see(null, false);
	assert.equal(met, 0, 'a failed check');
	watch.see([0, 0, 0], true);
	assert.equal(met, 1);
	assert.equal(kept, '2026-10-01');
	watch.see([1, 0, 0], true);
	watch.see([0, 0, 0], true);
	assert.equal(met, 1, 'once a day');
	today = '2026-10-02';
	watch.see([0, 0, 1], true);
	watch.see([0, 0, 0], true);
	assert.equal(met, 2, 'and again tomorrow');
	assert.equal(dayOf(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('the plan met: the Company Lead walks round the desk, the star is pinned on by The Commissar, they salute; fireworks and the banner', async () => {
	const crew = createCrew(world, { rng: () => 0.5 });
	crew.apply(snap([agent('boss', 'running', 'BOSS, Company Lead'), agent('rep', 'idle', 'The Commissar'), agent('x')]));
	const root = win.document.createElement('div');
	const played: string[] = [];
	const c = createCelebration({
		crew, world, stage: { bubbles: new Container() } as never, root: root as never,
		cam: () => ({ x: 0, y: 0, zoom: 2 }), view: () => ({ w: 1440, h: 900 }), glideTo: () => {}, prefetch: () => {},
		screenX: () => 0.5, play: (v) => played.push(v), reducedMotion: () => false, rng: () => 0.5, makeTexture: tex,
	});
	for (let t = 0; t < 2000; t += 100) crew.step(100);
	c.start();
	assert.ok(root.querySelector('.p67-planmet canvas'), 'the banner is up');
	const m = c.state().medal;
	assert.deepEqual(m && [m.stage, m.lead, m.pinner], ['walk', 'boss', 'rep']);
	assert.equal(crew.get('boss')!.held, MEDAL_HOLD);
	let pinned = false, saluted = false;
	for (let t = 0; t < MEDAL_WALK_MS + PIN_MS + SALUTE_MS + 1000; t += 100) {
		crew.step(100);
		c.tick(100);
		if (c.state().medal?.stage === 'salute') { saluted ||= crew.get('boss')!.anim === 'salute'; pinned ||= !!crew.get('boss')!.outfit.extras?.includes('heroStar'); }
	}
	assert.ok(pinned && saluted);
	assert.ok(played.includes('crackle') && played.includes('ding'));
	assert.equal(c.state().medal, null);
	assert.equal(crew.get('boss')!.held, null);
	assert.ok(crew.get('boss')!.outfit.extras?.includes('heroStar'), 'the star stays on');
	for (let t = 0; t < 14_000; t += 100) c.tick(100);
	assert.equal(root.querySelector('.p67-planmet'), null, 'and the banner rolls away');
	assert.equal(c.state().bursts, 0);
});

test('Sputnik and the bear come on their timers; the bear sniffs at the hut and goes; neither with less motion', async () => {
	let reduced = false;
	const played: string[] = [];
	const v = createVisitors({
		stage: { far: new Container(), layer: new Container() } as never, world, render: pixels,
		screenX: () => 0.5, play: (x) => played.push(x), reducedMotion: () => reduced, rng: () => 0, makeTexture: tex,
	});
	assert.equal(v.state().next.sputnik, SPUTNIK_GAP[0]);
	assert.equal(v.state().next.bear, BEAR_GAP[0]);
	// The bear's way keeps clear of the pines and the hut.
	const feet = world.scene.props.map((p) => p.foot);
	let at: V3 = [BEAR_IN[0] * L, BEAR_IN[1] * L, 0];
	for (const leg of BEAR_VISIT) {
		if (!('to' in leg)) continue;
		const to: V3 = [leg.to[0] * L, leg.to[1] * L, 0];
		assert.ok(segmentClear(at, to, feet), `clear to ${leg.to}`);
		at = to;
	}
	// Twenty minutes in, the bear; it sniffs, and is gone within about half a minute.
	for (let t = 0; t < BEAR_GAP[0] * 1000; t += 1000) v.tick(1000);
	let sniffed = false, gone = -1;
	for (let t = 0; t < 60_000 && gone < 0; t += 100) {
		v.tick(100);
		await Promise.resolve();
		sniffed ||= !!v.state().bear?.sniffing;
		if (v.state().bear === null) gone = t;
	}
	assert.ok(sniffed);
	assert.ok(gone > 20_000 && gone < 40_000, `the bear stayed ${gone} ms`);
	assert.ok(played.includes('huff'));
	// Half an hour in, Sputnik crosses, beeping.
	for (let t = 0; t < (SPUTNIK_GAP[0] - BEAR_GAP[0]) * 1000; t += 1000) v.tick(1000);
	assert.ok(v.state().sputnik !== null);
	for (let t = 0; t < SPUTNIK_S * 1000 + 1000; t += 100) v.tick(100);
	assert.equal(v.state().sputnik, null);
	assert.ok(played.includes('beep'));
	// With less motion asked for, nobody comes.
	reduced = true;
	for (let t = 0; t < SPUTNIK_GAP[1] * 1000; t += 1000) v.tick(1000);
	assert.deepEqual([v.state().sputnik, v.state().bear], [null, null]);
});

test('the parade and the medal: a parade leaves the medal\'s two alone; a medal takes the Company Lead out of a parade', async () => {
	const roster = [agent('boss', 'running', 'BOSS, Company Lead'), agent('rep', 'idle', 'The Commissar'), agent('x'), agent('y')];
	for (const order of ['medal first', 'parade first']) {
		const { crew, parade, run } = paradeSetup(roster);
		const c = createCelebration({
			crew, world, stage: { bubbles: new Container() } as never, root: win.document.createElement('div') as never,
			cam: () => ({ x: 0, y: 0, zoom: 2 }), view: () => ({ w: 1440, h: 900 }), glideTo: () => {}, prefetch: () => {},
			screenX: () => 0.5, play: () => {}, reducedMotion: () => true, rng: () => 0.5, makeTexture: tex,
		});
		await run(1000);
		if (order === 'medal first') { c.start(); parade.start(); } else { parade.start(); c.start(); }
		parade.tick(100);
		// Either way, the Company Lead and The Commissar are the medal's, not the column's.
		assert.deepEqual(new Set(parade.state().marchers), new Set(['x', 'y']), order);
		let starred = false;
		for (let t = 0; t < 40_000; t += 100) {
			crew.step(100);
			parade.tick(100);
			c.tick(100);
			starred ||= !!crew.get('boss')!.outfit.extras?.includes('heroStar');
		}
		assert.ok(starred, `${order}: the star is pinned on`);
	}
});

test('a very large crew: the column never laps itself; the rest stay put', async () => {
	const roster = Array.from({ length: 80 }, (_, k) => agent(`c${k}`));
	const { crew, parade } = paradeSetup(roster);
	assert.equal(parade.start(), true);
	const rows = Math.floor(trackOf(LAPS[0], L).length / ROW_GAP) - 2;
	assert.equal(parade.state().marchers.length, rows * 2);
	assert.equal(crew.list().filter((c) => c.held === null).length, 80 - rows * 2);
	parade.stop();
});
