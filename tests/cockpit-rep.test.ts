/**
 * The Commissar: he picks the busiest comrade, stands on a walkable tile about two
 * tiles behind them facing their back, lurks or scribbles by the crew's seeded dice, and moves
 * on when they stop running. With nobody running he falls back to wandering.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { YAW } from '../src/art/avatar';
import { type Comrade, NOTICE_MS, PERSONAL_SPACE, SHADOW_TILES, busiest, createCrew, shadowSpot } from '../src/cockpit/crew';
import type { AgentState, Snapshot } from '../src/live/types';
import { isWalkable, tileOf } from '../src/world/path';
import { buildWorld, zoneAt } from '../src/world/zones';

const world = buildWorld();

/**
 * An agent.
 *
 * @param id Id.
 * @param name Name.
 * @param title Title.
 * @param status Status.
 * @param beat Last heartbeat (ISO) or null.
 * @returns Agent.
 */
function agent(id: string, name: string, title: string | null, status: string, beat: string | null = null): AgentState {
	return { id, name, title, role: null, status, pauseReason: null, errorReason: null, lastHeartbeatAt: beat, reportsTo: null, urlKey: null };
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

/**
 * Step a crew until a condition holds or time runs out.
 *
 * @param crew Crew.
 * @param ms Longest time to run.
 * @param done Condition.
 * @returns Milliseconds taken, or -1 if it never held.
 */
function runUntil(crew: ReturnType<typeof createCrew>, ms: number, done: () => boolean): number {
	for (let t = 0; t <= ms; t += 16) {
		if (done()) return t;
		crew.step(16);
	}
	return -1;
}

const REP = agent('rep', 'The Commissar', 'Representative of the State', 'idle');

test('busiest: running only, the latest heartbeat breaks a tie, never himself', () => {
	const crew = createCrew(world, { rng: () => 0.3 });
	crew.apply(snap([
		agent('a', 'Anna', 'Generalist Executor', 'running', '2026-09-24T09:00:00Z'),
		agent('b', 'Boris', 'Delivery Lead', 'running', '2026-09-24T09:05:00Z'),
		agent('c', 'Comrade Critic', 'Independent Reviewer', 'idle', '2026-09-24T09:10:00Z'),
		{ ...REP, status: 'running', lastHeartbeatAt: '2026-09-24T10:00:00Z' },
	]));
	assert.equal(busiest(crew.list(), 'rep')?.id, 'b');
	const quiet = createCrew(world);
	quiet.apply(snap([agent('c', 'Comrade Critic', 'Independent Reviewer', 'idle'), REP]));
	assert.equal(busiest(quiet.list(), 'rep'), null);
});

test('shadowSpot: a walkable tile about two tiles behind the mark, in their room, facing them, clear of everyone', () => {
	const crew = createCrew(world);
	crew.apply(snap([
		agent('a', 'Anna', 'Generalist Executor', 'running'), agent('b', 'Comrade Critic', 'Independent Reviewer', 'running'), agent('c', 'Comrade Planner', 'Delivery Lead', 'running'),
		agent('d', 'Comrade Director', 'Company Lead', 'running'), agent('e', 'Comrade Spanner', 'Expert Unblocker', 'running'), agent('f', 'Keeper', 'Operational Hygiene', 'running'),
		agent('g', 'Comrade Scribe', 'Summarizer', 'running'), agent('h', 'Night Shift Welder', null, 'running'),
	]));
	let found = 0;
	for (const m of crew.list()) {
		const mark = { pos: m.slot!.pos, facing: m.slot!.facing };
		const taken = crew.list().map((c) => c.slot!.pos);
		const s = shadowSpot(world, mark, taken, world.spawn);
		// A desk against a wall may leave no room behind; the crew then tries the next busiest.
		if (!s) continue;
		found++;
		assert.ok(isWalkable(world, ...tileOf(world, s.pos)), 'walkable');
		assert.equal(zoneAt(...tileOf(world, s.pos)), zoneAt(...tileOf(world, mark.pos)), 'in the same room, never through a wall');
		for (const p of taken) assert.ok(Math.hypot(p[0] - s.pos[0], p[1] - s.pos[1]) >= PERSONAL_SPACE, 'not on anyone\'s place');
		const a = (YAW[mark.facing] * Math.PI) / 180;
		const back = -((s.pos[0] - mark.pos[0]) * Math.cos(a) + (s.pos[1] - mark.pos[1]) * Math.sin(a)) / world.tile;
		assert.ok(back >= SHADOW_TILES - 1.5 && back <= SHADOW_TILES + 1.5, `${m.agent.name}: ${back.toFixed(2)} tiles behind`);
		const toMark = (Math.atan2(mark.pos[1] - s.pos[1], mark.pos[0] - s.pos[0]) * 180) / Math.PI;
		assert.ok(Math.abs(((toMark - YAW[s.facing] + 540) % 360) - 180) <= 22.5, 'facing the mark');
	}
	assert.ok(found >= 5, `room behind most workplaces (${found} of 8)`);
});

test('The Commissar shadows the busiest comrade, lurking or scribbling, and moves on when they stop running', () => {
	const crew = createCrew(world, { rng: () => 0.2 });
	const worker = agent('a', 'Anna', 'Generalist Executor', 'running', '2026-09-24T09:00:00Z');
	crew.apply(snap([worker, agent('b', 'Comrade Critic', 'Independent Reviewer', 'idle'), REP]));
	const rep = crew.get('rep') as Comrade;
	assert.equal(rep.shadow, 'a');
	assert.ok(runUntil(crew, 60_000, () => rep.path.length === 0) >= 0, 'he gets there');
	assert.equal(rep.anim, 'lurk', 'the dice said lurk');
	const mark = crew.get('a')!;
	assert.ok(Math.hypot(rep.pos[0] - mark.pos[0], rep.pos[1] - mark.pos[1]) >= world.tile, 'at a distance');
	crew.apply(snap([{ ...worker, status: 'idle' }, agent('b', 'Comrade Critic', 'Independent Reviewer', 'idle'), REP]));
	const stood = rep.roam!.pos;
	crew.step(16);
	assert.equal(rep.shadow, null, 'his mark stopped running, so he moves on at once');
	assert.notDeepEqual(rep.roam?.pos, stood, 'to somewhere else');
	assert.ok(rep.path.length > 0, 'and is walking there');
});

test('The Commissar\'s choice of lurk or scribble follows the crew\'s seeded dice', () => {
	const run = (seed: number): string[] => {
		let a = seed >>> 0;
		const crew = createCrew(world, { rng: () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; } });
		crew.apply(snap([agent('a', 'Anna', 'Generalist Executor', 'running'), REP]));
		const rep = crew.get('rep')!;
		const seen: string[] = [];
		for (let k = 0; k < 4; k++) {
			runUntil(crew, 60_000, () => rep.path.length === 0 && (rep.anim === 'lurk' || rep.anim === 'scribble'));
			seen.push(rep.anim);
			runUntil(crew, 45_000, () => rep.path.length > 0);
		}
		return seen;
	};
	assert.deepEqual(run(7), run(7), 'the same seed plays the same');
	assert.ok(run(7).every((x) => x === 'lurk' || x === 'scribble'));
	const scribbler = createCrew(world, { rng: () => 0.9 });
	scribbler.apply(snap([agent('a', 'Anna', 'Generalist Executor', 'running'), REP]));
	runUntil(scribbler, 60_000, () => scribbler.get('rep')!.path.length === 0);
	assert.equal(scribbler.get('rep')!.anim, 'scribble');
});

test('The Commissar, idling on a wander, goes to watch someone who starts work within a few seconds', () => {
	const crew = createCrew(world, { rng: () => 0.4 });
	const anna = agent('a', 'Anna', 'Generalist Executor', 'idle');
	crew.apply(snap([anna, REP]));
	const rep = crew.get('rep')!;
	runUntil(crew, 60_000, () => rep.path.length === 0);
	assert.equal(rep.shadow, null);
	crew.apply(snap([{ ...anna, status: 'running' }, REP]));
	const took = runUntil(crew, 30_000, () => rep.shadow === 'a');
	assert.ok(took >= 0 && took <= NOTICE_MS + 100, `he noticed in ${took} ms`);
});
