/**
 * The life around the plant under a fake DOM and real Pixi objects (no renderer):
 * pigeons scatter from someone walking below and come back, the far train comes round on its
 * schedule and whistles once when it shows, smoke rises, and with less motion asked for there is
 * no smoke or train and the pigeons sit still.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { Container, Texture } from 'pixi.js';
import type { V3 } from '../src/art/sdf';
import { buildWorld } from '../src/world/zones';

const win = new Window();
Object.assign(globalThis, { document: win.document });
const { AWAY_S, FIRST_TRAIN, FLIGHT_S, PERCHES, PUFF_LIFE, createAmbient } = await import('../src/cockpit/ambient');

const world = buildWorld();
const L = world.tile;

/**
 * The life around the plant over a stand-in stage, with walkers to hand.
 *
 * @param reduced Less motion asked for.
 * @returns Ambient, the walkers, and what played.
 */
function setup(reduced = false) {
	const walkers: { pos: V3; path: V3[]; hidden: boolean }[] = [];
	const played: string[] = [];
	const a = createAmbient({
		stage: { far: new Container(), wall: new Container() } as never,
		world,
		render: async () => ({ w: 2, h: 2, rgba: new Uint8ClampedArray(16), top: { x: 1, y: 1 } }),
		crew: { list: () => walkers as never },
		screenX: () => 0.5,
		play: (v) => played.push(v),
		reducedMotion: () => reduced,
		rng: () => 0.5,
		makeTexture: () => new Texture({ source: Texture.WHITE.source }),
	});
	/**
	 * Run for a while.
	 *
	 * @param s Seconds.
	 */
	const run = async (s: number) => { for (let t = 0; t < s; t += 0.1) { a.tick(100); if (Math.round(t * 10) % 50 === 0) await Promise.resolve(); } };
	return { a, walkers, played, run };
}

test('pigeons peck about, scatter from someone walking below their stretch of wall, and come back', async () => {
	const s = setup();
	await s.run(1);
	assert.equal(s.a.state().sat, PERCHES.length);
	const perch = PERCHES.find((p) => p.wall === 'ne')!;
	s.walkers.push({ pos: [perch.at * L, 0.5 * L, 0], path: [[perch.at * L + 50, 0.5 * L, 0]], hidden: false });
	await s.run(0.2);
	assert.ok(s.a.state().away >= 1, 'off it goes');
	assert.ok(s.played.includes('wings'), 'with a flutter');
	s.walkers.length = 0;
	await s.run(FLIGHT_S + AWAY_S[1] + FLIGHT_S + 1);
	assert.equal(s.a.state().sat, PERCHES.length, 'and back again');
	// Someone standing still below does not scare them.
	s.walkers.push({ pos: [perch.at * L, 0.5 * L, 0], path: [], hidden: false });
	await s.run(2);
	assert.equal(s.a.state().away, 0);
});

test('the far train comes round on its schedule and whistles once; smoke rises and fades', async () => {
	const s = setup();
	await s.run(FIRST_TRAIN[0] - 1);
	assert.equal(s.a.state().train, null, 'not yet');
	assert.ok(s.a.state().puffs > 0 && s.a.state().puffs < 2 * (PUFF_LIFE / 0.7 + 2), 'smoke from both chimneys, and it fades');
	await s.run(FIRST_TRAIN[1] - FIRST_TRAIN[0] + 2);
	assert.notEqual(s.a.state().train, null, 'a train');
	await s.run(5);
	assert.equal(s.played.filter((v) => v === 'whistle').length, 1, 'one whistle');
});

test('with less motion asked for: no smoke, no train, and the pigeons sit still', async () => {
	const s = setup(true);
	await s.run(FIRST_TRAIN[1] + 5);
	assert.equal(s.a.state().puffs, 0);
	assert.equal(s.a.state().train, null);
	const perch = PERCHES[0];
	s.walkers.push({ pos: [perch.at * L, 0.5 * L, 0], path: [[perch.at * L + 50, 0.5 * L, 0]], hidden: false });
	await s.run(1);
	assert.equal(s.a.state().away, 0);
});
