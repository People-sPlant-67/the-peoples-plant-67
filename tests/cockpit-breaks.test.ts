/**
 * Breaks and fidgets on the real world and crew, with no drawing: only idle comrades in
 * the Canteen leave their spot; one to a soda machine and two to a chess table, sat on its stools;
 * working comrades only fidget where they stand; a scene can take anyone from a break; work arriving
 * or furniture going ends a break; and the timings stay in their ranges.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { V3 } from '../src/art/sdf';
import { BREAK_MAX_MS, BREAK_MIN_MS, FIDGET_MAX_MS, LASTS, TEA_PLACES, type Usable, createBreaks, usesOf } from '../src/cockpit/breaks';
import { SOFT_HOLD, busiest, createCrew, inScene } from '../src/cockpit/crew';
import type { AgentState, Snapshot } from '../src/live/types';
import { findPath, tileCentre } from '../src/world/path';
import { OWN_PIECES, buildWorld } from '../src/world/zones';

const world = buildWorld();

/**
 * A fictional agent.
 *
 * @param id Id.
 * @param status Status.
 * @returns Agent.
 */
function agent(id: string, status: string): AgentState {
	return { id, name: `Comrade ${id}`, title: 'Generalist Executor', role: null, status, pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null };
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
 * Seeded random numbers.
 *
 * @param seed Seed.
 * @returns Generator.
 */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

/** The plant's own soda machine and chess table, where they stand. */
const own = (): Usable[] => OWN_PIECES.map((o) => ({ id: o.id, kind: o.kind as Usable['kind'], facing: o.facing, at: tileCentre(world, o.tile[0], o.tile[1]) }));

/**
 * A crew and its breaks, run along together.
 *
 * @param agents Roster.
 * @param seed Random seed.
 * @returns Crew, breaks, a runner and what was prefetched.
 */
function setup(agents: AgentState[], seed = 1) {
	const crew = createCrew(world, { rng: rng(seed) });
	crew.apply(snap(agents));
	let usable = own();
	const fetched: string[] = [];
	const r = rng(seed + 7);
	const breaks = createBreaks({ crew, world, usable: () => usable, prefetch: (_o, a, d) => fetched.push(`${a}|${d}`), rng: r });
	/**
	 * Run for a while in 100 ms steps, or until a condition holds.
	 *
	 * @param ms Longest.
	 * @param until Condition.
	 * @returns Time taken, or -1.
	 */
	const run = (ms: number, until: () => boolean = () => false): number => {
		for (let t = 0; t <= ms; t += 100) {
			if (until()) return t;
			crew.step(100);
			breaks.tick(100);
		}
		return -1;
	};
	return { crew, breaks, run, fetched, setUsable: (u: Usable[]) => { usable = u; } };
}

test('each place to take a break can be walked to all the way, and a chess table has a seat each side, one in front of it', () => {
	const from = world.zones.canteen.spots[0];
	for (const u of own()) for (const use of usesOf(u)) {
		const end = findPath(world, from, use.stand)?.at(-1);
		assert.ok(end && Math.hypot(end[0] - use.stand[0], end[1] - use.stand[1]) < 1, `${use.key} can be reached`);
	}
	for (const p of TEA_PLACES) {
		const end = findPath(world, from, p)?.at(-1);
		assert.ok(end && Math.hypot(end[0] - p[0], end[1] - p[1]) < 1, 'a place at the samovar can be reached');
	}
	const table = own().find((u) => u.kind === 'chess')!;
	const seats = usesOf(table);
	assert.equal(seats.length, 2);
	assert.deepEqual(seats.map((s) => s.dir).sort(), ['E', 'W'], 'facing each other across the board, side by side on screen');
	assert.ok(seats.every((s) => s.front), 'both drawn over the table');
	const turned = usesOf({ ...table, facing: 1 });
	assert.deepEqual(turned.map((s) => s.front).sort(), [false, true], 'turned, one sits behind it');
});

test('only idle comrades in the Canteen go on breaks, within the time a break is due; working ones never leave their place', () => {
	const ids = ['a1', 'a2', 'a3', 'a4'];
	const s = setup([...ids.map((id) => agent(id, 'idle')), agent('w1', 'running')], 3);
	const worker = s.crew.get('w1')!;
	const at: V3 = [...worker.pos];
	const t = s.run(BREAK_MAX_MS + 1_000, () => s.breaks.doing.size > 0);
	assert.ok(t >= BREAK_MIN_MS - 1_000 && t >= 0, `the first break comes in its window (${t} ms)`);
	assert.ok(![...s.breaks.doing.keys()].includes('w1'));
	s.run(4 * BREAK_MAX_MS);
	assert.ok(Math.hypot(worker.pos[0] - at[0], worker.pos[1] - at[1]) < 1, 'the working comrade never left their station');
	assert.ok(s.fetched.some((f) => /^(stretch|yawn|watch)\|/.test(f)), 'but fidgeted there');
});

test('one to a soda machine, two to a chess table, sat on its stools facing each other', () => {
	const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
	const s = setup(ids.map((id) => agent(id, 'idle')), 5);
	let soda = 0, chess = 0, sat = false;
	s.run(10 * BREAK_MAX_MS, () => {
		const d = [...s.breaks.doing.values()];
		soda = Math.max(soda, d.filter((x) => x === 'soda').length);
		chess = Math.max(chess, d.filter((x) => x === 'chess').length);
		const players = ids.map((id) => s.crew.get(id)!).filter((c) => c.anim === 'chess');
		if (players.length === 2) {
			sat = true;
			assert.ok(players.every((c) => c.stack?.over), 'both sat beside the table, drawn over it');
			assert.notEqual(players[0].dir, players[1].dir);
		}
		return false;
	});
	assert.equal(soda, 1, 'never two at one soda machine');
	assert.ok(chess === 2, 'a game needs two');
	assert.ok(sat, 'and they sat down to it');
});

test('a scene can take anyone from a break; work arriving sends them back; furniture taken away ends the break', () => {
	const s = setup(['c1', 'c2', 'c3', 'c4'].map((id) => agent(id, 'idle')), 9);
	s.run(10 * BREAK_MAX_MS, () => s.breaks.doing.size > 0);
	const [first] = [...s.breaks.doing.keys()];
	assert.ok(s.crew.hold(first, 'ceremony'), 'a ceremony takes them');
	assert.equal(s.crew.get(first)!.stack, null, 'off the stool');
	s.run(200);
	assert.ok(!s.breaks.doing.has(first));
	s.crew.release(first, 'ceremony');

	s.run(10 * BREAK_MAX_MS, () => s.breaks.doing.size > 0);
	const [second] = [...s.breaks.doing.keys()];
	s.crew.apply(snap(['c1', 'c2', 'c3', 'c4'].map((id) => agent(id, id === second ? 'running' : 'idle')), 1_020_000));
	s.run(200);
	assert.ok(!s.breaks.doing.has(second), 'work ended the break');
	assert.notEqual(s.crew.get(second)!.held, SOFT_HOLD);

	s.setUsable([]);
	s.run(10 * BREAK_MAX_MS, () => [...s.breaks.doing.values()].some((d) => d === 'soda' || d === 'chess'));
	assert.ok(![...s.breaks.doing.values()].some((d) => d === 'soda' || d === 'chess'), 'with no furniture, nobody goes to any');
	s.setUsable(own());
	s.run(10 * BREAK_MAX_MS, () => [...s.breaks.doing.values()].some((d) => d === 'soda'));
	const drinker = [...s.breaks.doing].find(([, d]) => d === 'soda')![0];
	s.setUsable(own().filter((u) => u.kind !== 'soda'));
	s.run(200);
	assert.ok(!s.breaks.doing.has(drinker), 'the soda machine went, and the break with it');
});

test('breaks end on time and fidgets come round again', () => {
	const s = setup(['d1', 'd2'].map((id) => agent(id, 'idle')), 11);
	s.run(10 * BREAK_MAX_MS, () => s.breaks.doing.size > 0);
	const [id, what] = [...s.breaks.doing][0];
	const walkMs = 30_000;
	assert.ok(s.run(LASTS[what] + walkMs, () => !s.breaks.doing.has(id)) >= 0, 'the break ends');
	const c = s.crew.get('d2')!;
	let fidgets = 0, last = c.anim;
	s.run(6 * FIDGET_MAX_MS, () => { if (c.anim !== last && ['stretch', 'yawn', 'watch'].includes(c.anim)) fidgets++; last = c.anim; return false; });
	assert.ok(fidgets >= 2, `fidgets again and again (${fidgets})`);
});

test('a game of chess ends for both together, and moving the table ends it (they get up where they are)', () => {
	const ids = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];
	const s = setup(ids.map((id) => agent(id, 'idle')), 5);
	const playing = () => [...s.breaks.doing].filter(([, d]) => d === 'chess').map(([id]) => id);
	assert.ok(s.run(20 * BREAK_MAX_MS, () => playing().length === 2 && playing().every((id) => s.crew.get(id)!.anim === 'chess')) >= 0, 'a game starts');
	const [a, b] = playing();
	s.crew.apply(snap(ids.map((id) => agent(id, id === a ? 'running' : 'idle')), 1_020_000));
	s.run(200);
	assert.ok(!s.breaks.doing.has(a) && !s.breaks.doing.has(b), 'one called away ends the game for both');
	s.crew.apply(snap(ids.map((id) => agent(id, 'idle')), 1_040_000));
	assert.ok(s.run(20 * BREAK_MAX_MS, () => playing().length === 2 && playing().every((id) => s.crew.get(id)!.anim === 'chess')) >= 0, 'another game');
	const [c, d] = playing();
	const sat = s.crew.get(c)!.pos.slice();
	s.setUsable(own().map((u) => (u.kind === 'chess' ? { ...u, at: [u.at[0] - 4 * world.tile, u.at[1], 0] as V3 } : u)));
	s.run(100);
	assert.ok(!s.breaks.doing.has(c) && !s.breaks.doing.has(d), 'the table moved: the game is over');
	assert.ok(Math.hypot(s.crew.get(c)!.pos[0] - sat[0], s.crew.get(c)!.pos[1] - sat[1]) < 10, 'they got up where they sat');
	assert.equal(s.crew.get(c)!.stack, null);
});

test('someone on a break or fidgeting is free for a farewell, a scene, and The Commissar\'s attention', () => {
	const s = setup([agent('f1', 'idle'), agent('f2', 'running')], 13);
	s.run(10 * BREAK_MAX_MS, () => s.crew.get('f2')!.held === SOFT_HOLD || s.breaks.doing.size > 0);
	const held = [s.crew.get('f1')!, s.crew.get('f2')!].find((c) => c.held === SOFT_HOLD)!;
	assert.ok(held, 'someone on a break or fidgeting');
	assert.equal(inScene(held), false);
	if (held.id === 'f2') assert.equal(busiest(s.crew.list(), 'rep')?.id, 'f2', 'The Commissar still shadows a working comrade while they stretch');
	assert.ok(s.crew.hold(held.id, `dep:${held.id}`), 'a farewell takes them');
	assert.equal(inScene(held), true);
	assert.notEqual(held.anim, 'chess', 'out of any sitting pose at once');
});

test('one fidget at a time in a room', () => {
	const s = setup(['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id) => agent(id, 'idle')), 17);
	const fidgets = ['stretch', 'yawn', 'watch'];
	let most = 0;
	s.run(3 * BREAK_MAX_MS, () => { most = Math.max(most, s.crew.list().filter((c) => c.place.zone === 'canteen' && fidgets.includes(c.anim)).length); return false; });
	assert.equal(most, 1);
});
