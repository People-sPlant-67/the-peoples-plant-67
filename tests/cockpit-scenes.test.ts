/**
 * Scenes: the director holds a scene's comrades, runs its steps in order, keeps the train and
 * the court to one scene at a time, and caps a replay. The four plays (arrival, departure,
 * trial, tribunal) do what the owner signed off, against the real world and crew.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCrew } from '../src/cockpit/crew';
import { FX_MS, type Verdict, arrival, departure, trial, tribunal } from '../src/cockpit/plays';
import { REPLAY_CAP, type Scene, createDirector } from '../src/cockpit/scenes';
import type { AgentState, Snapshot } from '../src/live/types';
import { buildWorld } from '../src/world/zones';

const world = buildWorld();

/**
 * An agent.
 *
 * @param id Id.
 * @param name Name.
 * @param over Overrides.
 * @returns AgentState.
 */
function agent(id: string, name: string, over: Partial<AgentState> = {}): AgentState {
	return { id, name, title: null, role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null, ...over };
}

/**
 * A good snapshot.
 *
 * @param agents Roster.
 * @returns Snapshot.
 */
function snap(agents: AgentState[]): Snapshot {
	return { at: 1_000_000, session: 'ok', message: null, companyId: null, companyName: null, agents, badges: null, badgesStale: false, approvals: null };
}

const ROSTER = [agent('a', 'Anna'), agent('b', 'Boris', { title: 'Company Lead' }), agent('c', 'Chekov', { title: 'Director of Operational Hygiene' })];

/**
 * A crew with the roster placed, and a director recording effects.
 *
 * @returns Crew, director and the effects log.
 */
function setup() {
	const crew = createCrew(world, { rng: () => 0.5 });
	crew.apply(snap(ROSTER));
	const fx: string[] = [];
	const director = createDirector(crew, (name, args) => fx.push(args.word ? `${name}:${args.word}` : name));
	/**
	 * Run the world for a while in 50 ms steps.
	 *
	 * @param ms Milliseconds.
	 */
	const run = (ms: number): void => { for (let t = 0; t < ms; t += 50) { director.step(50); crew.step(50); } };
	return { crew, director, fx, run };
}

/**
 * A small scene.
 *
 * @param id Scene id.
 * @param cast Comrades.
 * @param over Overrides.
 * @returns Scene.
 */
function scene(id: string, cast: string[], over: Partial<Scene> = {}): Scene {
	return { id, kind: 'departure', cast, uses: [], ceremony: true, summary: `${id} happened.`, who: id, steps: [{ do: 'wait', ms: 100 }], ...over };
}

test('a held comrade ignores placement until released, then goes back to work', () => {
	const { crew } = setup();
	const before = crew.get('a')!.slot;
	assert.ok(crew.hold('a', 's1'));
	assert.equal(crew.hold('a', 's2'), false, 'one scene at a time');
	crew.walk('a', world.marks.dock.pos);
	crew.apply(snap([{ ...ROSTER[0], status: 'error' }, ...ROSTER.slice(1)]));
	assert.ok(crew.get('a')!.path.length > 0, 'still walking to the dock, not to Siberia');
	crew.release('a', 's1');
	const c = crew.get('a')!;
	assert.equal(c.held, null);
	assert.equal(c.place.zone, 'siberia');
	assert.ok(c.path.length > 0, 'released, they head for Siberia straight away');
	assert.notDeepEqual(c.slot, before);
});

test('a held comrade who leaves the roster stays until the scene lets go, then is removed', () => {
	const { crew } = setup();
	crew.hold('a', 'dep:a');
	const change = crew.apply(snap(ROSTER.slice(1)));
	assert.deepEqual(change.left.map((l) => l.id), ['a']);
	assert.ok(crew.get('a')?.gone);
	crew.release('a', 'dep:a');
	assert.equal(crew.get('a'), undefined);
});

test('steps run in order; an effect fires once and holds the scene for its length', () => {
	const { crew, director, fx, run } = setup();
	let flag = false;
	director.enqueue(scene('s', ['a'], {
		steps: [
			{ do: 'fx', name: 'bell', ms: 500 },
			{ do: 'until', test: () => flag },
			{ do: 'fx', name: 'done' },
		],
	}));
	run(1_000);
	assert.deepEqual(fx, ['bell']);
	assert.equal(crew.get('a')!.held, 's');
	flag = true;
	run(100);
	assert.deepEqual(fx, ['bell', 'done']);
	assert.equal(crew.get('a')!.held, null, 'released at the end');
	assert.equal(director.has('s'), false);
});

test('the train and the court are used by one scene at a time; dropping the train frees it early', () => {
	const { director, fx, run } = setup();
	director.enqueue(scene('t1', ['a'], { uses: ['train'], steps: [{ do: 'fx', name: 'one', ms: 300 }, { do: 'drop', use: 'train' }, { do: 'wait', ms: 5_000 }] }));
	director.enqueue(scene('t2', ['b'], { uses: ['train'], steps: [{ do: 'fx', name: 'two', ms: 300 }] }));
	run(100);
	assert.deepEqual(fx, ['one']);
	run(400);
	assert.deepEqual(fx, ['one', 'two'], 'the second train goes once the first has let go of it');
	assert.deepEqual(director.running(), ['t1', 't2'], 'the first scene carries on without the train');
});

test('cancel releases a scene\'s comrades', () => {
	const { crew, director, run } = setup();
	director.enqueue(scene('s', ['a'], { steps: [{ do: 'until', test: () => false }] }));
	run(100);
	assert.equal(crew.get('a')!.held, 's');
	director.cancel('s');
	assert.equal(crew.get('a')!.held, null);
});

test('a replay keeps the first three ceremonies and reports the rest', () => {
	const { director } = setup();
	for (const [k, id] of ['a', 'b', 'c', 'a', 'b'].entries()) director.enqueue(scene(`r${k}`, [id], { uses: ['train'] }));
	director.enqueue(scene('bg', ['c'], { ceremony: false }));
	const dropped = director.trimBacklog();
	assert.equal(REPLAY_CAP, 3);
	assert.deepEqual(dropped.map((s) => s.id), ['r3', 'r4']);
	assert.ok(director.has('bg'), 'background scenes are never dropped');
	assert.ok(director.has('r0') && director.has('r2'));
});

test('arrival: the train comes, the newcomer walks to the desk and waits; a stamp sends them to work', () => {
	const { crew, director, fx, run } = setup();
	crew.apply(snap([...ROSTER, agent('n', 'Nadia', { status: 'pending_approval' })]));
	let pending = true;
	director.enqueue(arrival(world, 'n', 'Nadia', () => pending, () => false));
	run(200);
	assert.equal(crew.get('n')!.hidden, true, 'not seen until the train is in');
	run(FX_MS.trainIn + 100);
	assert.equal(crew.get('n')!.hidden, false);
	run(30_000);
	const c = crew.get('n')!;
	assert.ok(Math.hypot(c.pos[0] - world.marks.desk.pos[0], c.pos[1] - world.marks.desk.pos[1]) < 2, 'waiting at the desk');
	assert.equal(c.held, 'arr:n');
	assert.deepEqual(fx, ['trainIn', 'trainOut']);
	pending = false;
	run(FX_MS.stamp + 200);
	assert.deepEqual(fx, ['trainIn', 'trainOut', 'stamp:ОДОБРЕНО']);
	assert.equal(crew.get('n')!.held, null);
});

test('arrival refused: ОТКАЗАНО, back to the platform, onto the train, gone', () => {
	const { crew, director, fx, run } = setup();
	crew.apply(snap([...ROSTER, agent('n', 'Nadia', { status: 'pending_approval' })]));
	let gone = false;
	director.enqueue(arrival(world, 'n', 'Nadia', () => true, () => gone));
	run(40_000);
	crew.apply(snap(ROSTER));
	gone = true;
	run(60_000);
	assert.deepEqual(fx, ['trainIn', 'trainOut', 'stamp:ОТКАЗАНО', 'trainIn', 'trainOut']);
	assert.equal(crew.get('n'), undefined);
});

test('departure and trial: a leaver boards the train; the terminated are tried and airbrushed', () => {
	const { crew, director, fx, run } = setup();
	crew.hold('a', 'dep:a');
	crew.hold('b', 'dep:b');
	crew.apply(snap([ROSTER[2]]));
	director.enqueue(departure(world, 'a', 'Anna'));
	director.enqueue(trial(world, 'b', 'Boris'));
	run(90_000);
	assert.deepEqual(fx.filter((f) => f.startsWith('train')), ['trainIn', 'trainOut']);
	assert.deepEqual(fx.filter((f) => !f.startsWith('train')), ['stamp:ВИНОВЕН', 'airbrush', 'photo']);
	assert.equal(crew.get('a'), undefined);
	assert.equal(crew.get('b'), undefined);
});

/**
 * Distance on the floor between a comrade and a mark.
 *
 * @param p Position.
 * @param q Mark position.
 * @returns Distance.
 */
const dist = (p: number[], q: number[]): number => Math.hypot(p[0] - q[0], p[1] - q[1]);

test('tribunal: while the referral waits, only the accused is held, and the court stays free', () => {
	const { crew, director, fx, run } = setup();
	director.enqueue(tribunal(world, 'ap0', 'a', 'Anna', () => ({ judge: 'b', prosecutor: 'c' }), () => false, () => null, () => true, () => false));
	run(40_000);
	assert.ok(dist(crew.get('a')!.pos, world.marks.waiting.pos) < 2, 'the accused waits in the Palace');
	assert.equal(crew.get('b')!.held, null, 'the Company Lead keeps working');
	assert.equal(crew.get('c')!.held, null, 'so does the Director');
	crew.hold('b', 'dep:b');
	crew.apply(snap([ROSTER[0], ROSTER[2]]));
	director.enqueue(trial(world, 'b', 'Boris'));
	run(40_000);
	assert.deepEqual(fx, ['stamp:ВИНОВЕН', 'airbrush', 'photo'], 'a trial is not blocked by a waiting referral');
});

for (const v of ['guilty', 'pardoned'] as const) {
	test(`tribunal: opening the case assembles the court; ${v} plays out and everyone is released`, () => {
		const { crew, director, fx, run } = setup();
		let verdict: Verdict = null;
		let onRoster = true;
		let open = false;
		director.enqueue(tribunal(world, 'ap1', 'a', 'Anna', () => ({ judge: 'b', prosecutor: 'c' }), () => open, () => verdict, () => true, () => !onRoster));
		run(30_000);
		open = true;
		run(60_000);
		assert.equal(crew.get('b')!.pos[2], world.marks.bench.pos[2], 'the judge is up on the stage');
		assert.equal(crew.get('c')!.held, 'trib:ap1');
		assert.ok(dist(crew.get('a')!.pos, world.marks.dock.pos) < 2, 'the accused is in the dock');
		assert.deepEqual(fx, [], 'nothing happens until the verdict');
		verdict = v;
		run(10_000);
		if (v === 'guilty') {
			assert.deepEqual(fx, ['stamp:ВИНОВЕН', 'airbrush', 'photo']);
			assert.equal(crew.get('a')!.hidden, true);
			assert.equal(crew.get('a')!.held, 'trib:ap1', 'kept off stage until Paperclip drops them');
			assert.equal(crew.get('b')!.held, null, 'the court rises at once');
			assert.equal(crew.get('c')!.held, null);
			// However long Paperclip takes, they never walk back out.
			run(300_000);
			assert.equal(crew.get('a')!.hidden, true);
			crew.apply(snap(ROSTER.slice(1)));
			onRoster = false;
			run(200);
			assert.equal(crew.get('a'), undefined);
		} else {
			assert.deepEqual(fx, ['stamp:ПОМИЛОВАН']);
			assert.equal(crew.get('a')!.held, null);
		}
		assert.equal(crew.get('b')!.held, null);
		assert.equal(crew.get('b')!.pos[2], 0, 'the judge stepped down');
	});
}

test('tribunal: an accused terminated from the dashboard is still tried and airbrushed', () => {
	const { crew, director, fx, run } = setup();
	let onRoster = true;
	director.enqueue(tribunal(world, 'ap3', 'a', 'Anna', () => ({ judge: 'b', prosecutor: null }), () => false, () => null, () => true, () => !onRoster));
	run(30_000);
	crew.apply(snap(ROSTER.slice(1)));
	onRoster = false;
	run(40_000);
	assert.deepEqual(fx, ['stamp:ВИНОВЕН', 'airbrush', 'photo']);
	assert.equal(crew.get('a'), undefined);
});

test('tribunal: the referral withdrawn elsewhere dissolves the court', () => {
	const { crew, director, fx, run } = setup();
	let open = true;
	director.enqueue(tribunal(world, 'ap2', 'a', 'Anna', () => ({ judge: 'b', prosecutor: null }), () => true, () => null, () => open, () => false));
	run(30_000);
	open = false;
	run(200);
	assert.deepEqual(fx, []);
	assert.equal(crew.get('a')!.held, null);
	assert.equal(crew.get('b')!.held, null);
});

test('tribunal: closing the case without a verdict lets the court rise; the accused waits again', () => {
	const { crew, director, fx, run } = setup();
	let open = true;
	director.enqueue(tribunal(world, 'ap4', 'a', 'Anna', () => ({ judge: 'b', prosecutor: 'c' }), () => open, () => null, () => true, () => false));
	run(60_000);
	assert.equal(crew.get('b')!.held, 'trib:ap4');
	open = false;
	run(40_000);
	assert.equal(crew.get('b')!.held, null, 'the Company Lead goes back to work');
	assert.equal(crew.get('c')!.held, null);
	assert.equal(crew.get('b')!.pos[2], 0);
	assert.equal(crew.get('a')!.held, 'trib:ap4', 'the accused still awaits trial');
	assert.ok(dist(crew.get('a')!.pos, world.marks.waiting.pos) < 2);
	assert.deepEqual(fx, []);
	open = true;
	run(60_000);
	assert.equal(crew.get('b')!.held, 'trib:ap4', 'reopening assembles the court again');
});
