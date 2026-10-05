/**
 * The cockpit's behaviour on the real world, with no drawing: who gets which station or
 * spot, walking to Siberia when an agent errors, arrivals from the platform, leavers, and
 * The Commissar's wandering. Run with: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { V3 } from '../src/art/sdf';
import { type Slot, assignSlots, slotKey, slotTable } from '../src/cockpit/assign';
import { type Comrade, WANDER_MAX_MS, atAnvil, createCrew } from '../src/cockpit/crew';
import type { AgentState, Snapshot } from '../src/live/types';
import { tileOf } from '../src/world/path';
import { buildWorld, zoneAt } from '../src/world/zones';

const world = buildWorld();
const slots = slotTable(world);

/**
 * A fictional agent.
 *
 * @param id Id.
 * @param name Name.
 * @param title Title.
 * @param status Status.
 * @returns Agent.
 */
function agent(id: string, name: string, title: string | null, status: string): AgentState {
	return { id, name, title, role: null, status, pauseReason: null, errorReason: status === 'error' ? 'Out of rivets.' : null, lastHeartbeatAt: null, reportsTo: null, urlKey: null };
}

/**
 * A good snapshot.
 *
 * @param agents Roster.
 * @param at Time.
 * @returns Snapshot.
 */
function snap(agents: AgentState[], at = 1_000_000): Snapshot {
	return { at, session: 'ok', message: null, companyId: null, companyName: 'Test Works', agents, badges: null, badgesStale: false, approvals: null };
}

/**
 * Seeded random numbers, so wandering is repeatable.
 *
 * @param seed Seed.
 * @returns Generator of [0, 1).
 */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
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

/**
 * The zone a comrade is standing in.
 *
 * @param c Comrade.
 * @returns Zone id or null.
 */
const zoneOf = (c: Comrade) => zoneAt(...tileOf(world, c.pos));

test('stations go out in order within a zone, and nobody shares a slot', () => {
	const wants = ['c', 'a', 'b'].map((id) => ({ id, zone: 'production' as const }));
	const got = assignSlots(slots, wants, new Map());
	assert.deepEqual(['a', 'b', 'c'].map((id) => got.get(id)!.index), [0, 1, 2]);
	assert.ok(['a', 'b', 'c'].every((id) => got.get(id)!.kind === 'station'));
	assert.deepEqual(got.get('a')!.pos, world.zones.production.stations[0]);
	assert.equal(got.get('a')!.facing, world.zones.production.stationFacing[0]);
});

test('spots for canteen and Siberia are handed out without doubling up, overflowing onto free tiles', () => {
	for (const zone of ['canteen', 'siberia'] as const) {
		const n = world.zones[zone].spots.length + 3;
		const wants = Array.from({ length: n }, (_, k) => ({ id: `x${String(k).padStart(3, '0')}`, zone }));
		const got = assignSlots(slots, wants, new Map());
		assert.equal(got.size, n, zone);
		const keys = [...got.values()].map(slotKey);
		assert.equal(new Set(keys).size, n, `${zone}: two comrades on one slot`);
		const pos = [...got.values()].map((s) => `${s.pos[0].toFixed(2)},${s.pos[1].toFixed(2)}`);
		assert.equal(new Set(pos).size, n, `${zone}: two slots at the same place`);
		assert.ok([...got.values()].filter((s) => s.kind === 'tile').length === 3, `${zone}: overflow uses tiles`);
		for (const s of got.values()) assert.equal(zoneAt(...tileOf(world, s.pos)), zone, `${zone}: slot outside the zone`);
	}
});

test('a comrade keeps its slot across snapshots, even when someone earlier in id order arrives', () => {
	const first = assignSlots(slots, [{ id: 'm', zone: 'canteen' }], new Map());
	const second = assignSlots(slots, [{ id: 'a', zone: 'canteen' }, { id: 'm', zone: 'canteen' }], first);
	assert.equal(slotKey(second.get('m')!), slotKey(first.get('m')!));
	assert.notEqual(slotKey(second.get('a')!), slotKey(second.get('m')!));
	// Changing zone lets the slot go.
	const third = assignSlots(slots, [{ id: 'm', zone: 'siberia' }], second);
	assert.equal(third.get('m')!.zone, 'siberia');
});

test('the first snapshot places everyone at their slots at once, playing the right animation', () => {
	const crew = createCrew(world, { rng: rng(1) });
	crew.apply(snap([
		agent('a1', 'Shock Worker', 'Generalist Executor', 'running'),
		agent('a2', 'Comrade Critic', 'Independent Reviewer', 'idle'),
		agent('a3', 'Recovery', 'Expert Unblocker', 'error'),
	]));
	const [monkey, cynic, fixer] = ['a1', 'a2', 'a3'].map((id) => crew.get(id)!);
	for (const c of [monkey, cynic, fixer]) {
		assert.deepEqual(c.path, [], `${c.agent.name} should not be walking`);
		assert.deepEqual([c.pos[0], c.pos[1]], [c.slot!.pos[0], c.slot!.pos[1]]);
		assert.equal(c.dir, c.slot!.facing);
	}
	assert.equal(zoneOf(monkey), 'production');
	assert.equal(monkey.anim, 'work');
	assert.ok(atAnvil(monkey), 'the first production station is the anvil');
	assert.equal(zoneOf(cynic), 'canteen');
	assert.equal(cynic.anim, 'idle');
	assert.equal(zoneOf(fixer), 'siberia');
	assert.equal(fixer.anim, 'shiver');
	assert.equal(fixer.needsYou, true);
	assert.equal(cynic.needsYou, false);
});

test('an agent that errors walks to Siberia, facing where it walks, then shivers there', () => {
	const crew = createCrew(world, { rng: rng(2) });
	const ok = agent('a1', 'Shock Worker', 'Generalist Executor', 'running');
	crew.apply(snap([ok]));
	crew.apply(snap([{ ...ok, status: 'error', errorReason: 'Out of rivets.' }], 1_020_000));
	const c = crew.get('a1')!;
	assert.ok(c.path.length > 0, 'a route to Siberia');
	crew.step(16);
	assert.equal(c.anim, 'walk');
	const start: V3 = [...c.pos];
	crew.step(1000);
	const moved = Math.hypot(c.pos[0] - start[0], c.pos[1] - start[1]);
	assert.ok(moved > 55 && moved < 61, `about one tile per 0.75s, moved ${moved.toFixed(1)} in 1s`);
	const took = runUntil(crew, 120_000, () => c.path.length === 0);
	assert.ok(took >= 0, 'reaches Siberia within two minutes');
	assert.equal(zoneOf(c), 'siberia');
	assert.equal(c.anim, 'shiver');
	assert.equal(c.dir, c.slot!.facing);
	assert.equal(c.needsYou, true);
});

test('a newcomer steps off at the platform and walks in; a leaver is removed', () => {
	const crew = createCrew(world, { rng: rng(3) });
	const a = agent('a1', 'Comrade Critic', 'Independent Reviewer', 'idle');
	crew.apply(snap([a]));
	const change = crew.apply(snap([a, agent('a2', 'Night Shift Welder', null, 'running')], 1_020_000));
	assert.deepEqual(change.arrived, ['a2']);
	const n = crew.get('a2')!;
	assert.equal(zoneOf(n), 'recruitment');
	assert.ok(n.path.length > 0);
	assert.ok(runUntil(crew, 120_000, () => n.path.length === 0) >= 0);
	assert.equal(zoneOf(n), 'production');
	const gone = crew.apply(snap([n.agent], 1_040_000));
	assert.deepEqual(gone.left.map((l) => l.id), ['a1']);
	assert.equal(crew.get('a1'), undefined);
});

test('with nobody running, The Commissar wanders every 20 to 40 seconds, never into Siberia, and not onto anyone\'s slot', () => {
	const crew = createCrew(world, { rng: rng(4) });
	const others = [agent('a1', 'Shock Worker', 'Generalist Executor', 'idle'), agent('a2', 'Comrade Critic', 'Independent Reviewer', 'idle')];
	crew.apply(snap([...others, agent('rep', 'The Commissar', 'Representative of the State', 'idle')]));
	const rep = crew.get('rep')!;
	assert.equal(rep.place.zone, 'roam');
	assert.deepEqual(rep.path, [], 'The Commissar starts where he is, not on the platform');
	const taken = crew.list().filter((c) => c.slot).map((c) => c.slot!.pos);
	const stops: V3[] = [[...rep.pos]];
	let pauses = 0;
	for (let k = 0; k < 4; k++) {
		const waited = runUntil(crew, WANDER_MAX_MS + 100, () => rep.path.length > 0);
		assert.ok(waited >= 0, 'he moves on within 40s');
		if (k > 0) assert.ok(waited >= 20_000 - 100, `he lingers at least 20s, lingered ${waited}ms`);
		pauses++;
		assert.ok(runUntil(crew, 120_000, () => rep.path.length === 0) >= 0, 'and gets there');
		assert.notEqual(zoneOf(rep), 'siberia');
		assert.ok(rep.anim === 'lurk' || rep.anim === 'scribble', `he lurks or scribbles, not ${rep.anim}`);
		assert.equal(rep.shadow, null);
		for (const p of taken) assert.ok(Math.hypot(p[0] - rep.pos[0], p[1] - rep.pos[1]) >= 24, 'not on a comrade\'s slot');
		stops.push([...rep.pos]);
	}
	assert.equal(pauses, 4);
	assert.ok(new Set(stops.map((p) => p.join(','))).size >= 4, 'visits different places');
});

test('an agent whose zone is full gets no slot and stays put rather than crashing', () => {
	const huge = slotTable(world)('directorate').length + 1;
	const got = assignSlots(slots, Array.from({ length: huge }, (_, k) => ({ id: `d${k}`, zone: 'directorate' })), new Map<string, Slot>());
	assert.equal(got.size, huge - 1);
});

test('frames advance by the animation clock, and a long pause does not spin forever', () => {
	const crew = createCrew(world, { rng: rng(5) });
	crew.apply(snap([agent('a1', 'Shock Worker', 'Generalist Executor', 'running')]));
	const c = crew.get('a1')!;
	assert.equal(c.anim, 'work');
	assert.equal(c.frame, 0);
	crew.step(221);
	assert.equal(c.frame, 1);
	crew.step(3_600_000);
	assert.ok(c.frame >= 0 && c.frame < 6);
});
