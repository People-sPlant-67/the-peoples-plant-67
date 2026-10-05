/**
 * The wardrobe: every choice renders, the lists hold only cloths a garment came in,
 * a kept look survives a reload and junk in storage does not; the outfit a comrade wears follows
 * the kept look over their own skin and hair; and changing at the cloakroom goes there, through
 * its seven outfits in order, with the attendant turned away while they have nothing on, and back.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRS, renderAvatar } from '../src/art/avatar';
import { ATTENDANT, BANK, randomOutfit } from '../src/art/outfits';
import { BARE_MS, CHANGING, STEP_MS, createChanging, stepOutfits } from '../src/cockpit/changing';
import { createCrew } from '../src/cockpit/crew';
import { EXTRAS, FACES, HATS, LEGS, type Look, MOUTHS, TOPS, WARDROBE_KEY, createWardrobe, lookKey, lookOf, surprise, validLook, wear } from '../src/cockpit/wardrobe';
import { outfitFor } from '../src/live/personas';
import type { AgentState, Snapshot } from '../src/live/types';
import { buildWorld } from '../src/world/zones';

const world = buildWorld();
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
/**
 * A roster entry.
 *
 * @param id Id.
 * @param name Name.
 * @returns Agent.
 */
const agent = (id: string, name: string): AgentState => ({ id, name, title: null, role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null });
/**
 * A snapshot of a roster.
 *
 * @param agents Agents.
 * @returns Snapshot.
 */
const snap = (agents: AgentState[]): Snapshot => ({ at: 1_000_000, session: 'ok', message: null, companyId: null, companyName: 'Works', agents, badges: null, badgesStale: false, approvals: null });
const LOOK: Look = { headwear: 'budenovka', hatMat: 'khaki', torso: 'shinel', torsoMat: 'greyWool', shirtMat: 'cream', legs: 'galife', legsMat: 'navyWork', face: 'walrus', mouth: 'pipe', scarf: null, extras: ['armband', 'heroStar'] };

test('every hat, top, legs, face and mouth renders in every direction, and the attendant too', () => {
	const base = randomOutfit(41);
	const outfits = [
		...HATS.map((h) => wear(base, { ...lookOf(base), headwear: h.kind, hatMat: h.cloths[0] ?? 'greyWool' })),
		...TOPS.map((t) => wear(base, { ...lookOf(base), torso: t.kind, torsoMat: t.cloths[0] })),
		...LEGS.map((g) => wear(base, { ...lookOf(base), torso: 'tunic', legs: g.kind, legsMat: g.cloths[0] })),
		...FACES.map((f) => wear(base, { ...lookOf(base), face: f })),
		...MOUTHS.map((m) => wear(base, { ...lookOf(base), mouth: m })),
		wear(base, { ...lookOf(base), extras: [...EXTRAS] }),
		ATTENDANT,
	];
	for (const o of outfits) for (const d of DIRS) {
		const f = renderAvatar(o, 'idle', d, 0);
		let n = 0;
		for (let k = 3; k < f.rgba.length; k += 4) if (f.rgba[k]) n++;
		assert.ok(n > 600, `${o.id} ${d} draws a whole comrade`);
	}
});

test('a look over a comrade keeps their skin and hair; overalls keep legs and bib one cloth; every look has its own id', () => {
	const own = randomOutfit(7);
	const o = wear(own, LOOK);
	assert.equal(o.skin, own.skin);
	assert.equal(o.hair, own.hair);
	assert.equal(o.headwear, 'budenovka');
	assert.notEqual(o.id, own.id);
	const ov = wear(own, { ...LOOK, torso: 'overalls', torsoMat: 'rust', legs: 'skirt', legsMat: 'navyWork' });
	assert.equal(ov.legsMat, 'rust');
	assert.equal(ov.legs, 'trousers');
	assert.notEqual(lookKey(LOOK), lookKey({ ...LOOK, extras: ['armband'] }));
	assert.equal(lookKey(LOOK), lookKey({ ...LOOK, extras: ['heroStar', 'armband'] }), 'the order of extras does not matter');
	assert.equal(lookOf(wear(own, LOOK)).headwear, 'budenovka');
});

test('Surprise me gives real looks, with one bag at most and trousers apart from the top', () => {
	for (let s = 0; s < 300; s++) {
		const l = surprise(s * 7919);
		assert.ok(validLook(l), `seed ${s}`);
		assert.ok(!(l.extras.includes('satchel') && l.extras.includes('briefcase')));
	}
	assert.ok(TOPS.slice(0, 4).every((t, k) => t.kind === BANK.torso[k]), 'the bank\'s tops come first, as they were');
});

test('kept looks survive a reload; junk in storage is dropped; nothing kept means their own outfit', () => {
	const store = new Map<string, string>();
	const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
	const w = createWardrobe(s);
	const own = randomOutfit(3);
	assert.equal(w.wearing(A, own), own);
	w.set(A, LOOK);
	assert.equal(createWardrobe(s).wearing(A, own).headwear, 'budenovka', 'after a reload');
	w.clear(A);
	assert.equal(createWardrobe(s).get(A), null);
	store.set(WARDROBE_KEY, JSON.stringify({ [A]: { ...LOOK, headwear: 'crown' }, [B]: LOOK, x: 5 }));
	const again = createWardrobe(s);
	assert.equal(again.get(A), null, 'a hat that does not exist');
	assert.deepEqual(again.get(B), LOOK);
	store.set(WARDROBE_KEY, 'not json');
	assert.doesNotThrow(() => createWardrobe(s));
	w.set(A, { ...LOOK, extras: ['crown' as never] });
	assert.equal(createWardrobe(s).get(A), null, 'an unknown extra is refused');
});

test('changing: the seven outfits run from what they wore to what they will wear, each with its own id', () => {
	const from = outfitFor(agent(A, 'Anna')), to = wear(from, LOOK);
	const steps = stepOutfits(from, to);
	assert.equal(steps.length, 7);
	assert.equal(steps[0], from);
	assert.equal(steps[6], to);
	assert.equal(new Set(steps.map((o) => o.id)).size, 7);
	assert.deepEqual(steps.map((o) => [o.headwear === 'none', o.torso === 'bare', o.legs === 'bare']), [
		[from.headwear === 'none', false, false], [true, false, false], [true, true, false], [true, true, true], [true, true, false], [true, false, false], [false, false, false],
	]);
});

test('changing at the cloakroom: queued, walked there, stripped behind the attendant\'s back, dressed, and sent back', () => {
	const w = createWardrobe(null);
	const crew = createCrew(world, { rng: () => 0.5, outfitOf: (a) => w.wearing(a.id, outfitFor(a)) });
	crew.apply(snap([agent(A, 'Anna'), agent(B, 'Boris')]));
	const was = crew.get(A)!.outfit;
	const away: boolean[] = [];
	const puffs: string[] = [];
	const fetched = new Map<string, number>();
	const ch = createChanging({
		crew, world, attendant: (a) => away.push(a), puff: (id) => puffs.push(id),
		prefetch: (o) => fetched.set(o.id, (fetched.get(o.id) ?? 0) + 1),
		unfetch: (o) => fetched.set(o.id, (fetched.get(o.id) ?? 0) - 1),
	});
	w.set(A, LOOK);
	ch.start(A, w.wearing(A, outfitFor(crew.get(A)!.agent)));
	crew.apply(snap([agent(A, 'Anna'), agent(B, 'Boris')]));
	assert.equal(crew.get(A)!.outfit.id, was.id, 'they keep what they have on until they change');
	ch.start(B, w.wearing(B, outfitFor(crew.get(B)!.agent)));
	assert.equal(ch.words(B), 'Waiting for a turn at the cloakroom.');
	ch.tick(16);
	assert.equal(ch.stageOf(A), 'walking');
	assert.equal(crew.get(A)!.held, CHANGING);
	assert.equal(ch.words(A), 'Off to the cloakroom to change.');
	assert.equal(ch.stageOf(B), 'queued', 'one at the counter at a time');
	// Walk them there.
	for (let k = 0; k < 4000 && ch.stageOf(A) === 'walking'; k++) { crew.step(50); ch.tick(50); }
	assert.equal(ch.stageOf(A), 'changing');
	const at = crew.get(A)!.pos;
	assert.ok(Math.hypot(at[0] - world.marks.cloak.pos[0], at[1] - world.marks.cloak.pos[1]) < 1, 'at the counter');
	assert.equal(ch.words(A), 'Changing at the cloakroom.');
	const seen: string[] = [];
	for (let t = 0; t < 7 * STEP_MS + BARE_MS && ch.stageOf(A) === 'changing'; t += 100) {
		ch.tick(100);
		const o = crew.get(A)?.outfit;
		if (o && seen.at(-1) !== o.id) seen.push(o.id);
		if (o?.legs === 'bare') assert.equal(away.at(-1), true, 'she has turned away while they have nothing on');
	}
	assert.equal(ch.stageOf(A), null, 'done');
	assert.equal(seen.length, 7, 'every step was worn');
	assert.equal(puffs.length, 6, 'a puff for each piece');
	assert.equal(away.at(-1), false, 'she turns back');
	assert.equal(crew.get(A)!.outfit.headwear, 'budenovka', 'in the new look');
	assert.equal(crew.get(A)!.held, null, 'back to placement, who walks them home');
	assert.ok(crew.get(A)!.path.length > 0);
	ch.tick(16);
	assert.equal(ch.stageOf(B), 'walking', 'then the next in line');
	// Boris leaves mid-errand: dropped cleanly, and the attendant faces the counter again.
	crew.apply(snap([agent(A, 'Anna')]));
	ch.tick(16);
	assert.equal(ch.stageOf(B), null);
	assert.ok([...fetched.values()].every((n) => n === 0), 'everything prefetched is let go');
});

test('a second Keep while changing follows the first; a second while waiting replaces it', () => {
	const w = createWardrobe(null);
	const crew = createCrew(world, { rng: () => 0.5, outfitOf: (a) => w.wearing(a.id, outfitFor(a)) });
	crew.apply(snap([agent(A, 'Anna')]));
	const ch = createChanging({ crew, world, attendant: () => {}, puff: () => {}, prefetch: () => {}, unfetch: () => {} });
	const own = outfitFor(crew.get(A)!.agent);
	/**
	 * Keep a look and send them, as the app does: the wardrobe first, then the change.
	 *
	 * @param l Look.
	 */
	const keep = (l: Look): void => { w.set(A, l); ch.start(A, w.wearing(A, own)); };
	keep(LOOK);
	ch.tick(16);
	for (let k = 0; k < 4000 && ch.stageOf(A) !== 'changing'; k++) { crew.step(50); ch.tick(50); }
	keep({ ...LOOK, headwear: 'fedora', hatMat: 'charcoal' });
	keep({ ...LOOK, headwear: 'beret', hatMat: 'charcoal' });
	assert.deepEqual(ch.ids, [A, A], 'one changing, one waiting (the newest)');
	for (let t = 0; t < 30000 && ch.ids.length === 2; t += 100) { crew.step(100); ch.tick(100); }
	assert.equal(crew.get(A)!.outfit.headwear, 'budenovka', 'the first change finished in its own look');
	for (let t = 0; t < 60000 && ch.ids.length; t += 100) { crew.step(100); ch.tick(100); }
	assert.equal(crew.get(A)!.outfit.headwear, 'beret', 'then the newest');
});

test('a comrade a ceremony holds does not hold up the queue; they go when it lets them', () => {
	const w = createWardrobe(null);
	const crew = createCrew(world, { rng: () => 0.5, outfitOf: (a) => w.wearing(a.id, outfitFor(a)) });
	crew.apply(snap([agent(A, 'Anna'), agent(B, 'Boris')]));
	const ch = createChanging({ crew, world, attendant: () => {}, puff: () => {}, prefetch: () => {}, unfetch: () => {} });
	assert.ok(crew.hold(A, 'arrival'), 'a hire waiting at the desk, say');
	ch.start(A, wear(outfitFor(crew.get(A)!.agent), LOOK));
	ch.start(B, wear(outfitFor(crew.get(B)!.agent), LOOK));
	ch.tick(16);
	assert.equal(ch.stageOf(A), 'queued');
	assert.equal(ch.stageOf(B), 'walking', 'Boris goes first');
	crew.release(A, 'arrival');
	for (let t = 0; t < 60000 && ch.stageOf(A) === 'queued'; t += 100) { crew.step(100); ch.tick(100); }
	assert.equal(ch.stageOf(A), 'walking', 'then Anna, once the counter is free and nothing holds her');
});

test('called off at the counter (they are leaving): handed back in a whole outfit, the attendant turned round', () => {
	const w = createWardrobe(null);
	const crew = createCrew(world, { rng: () => 0.5, outfitOf: (a) => w.wearing(a.id, outfitFor(a)) });
	crew.apply(snap([agent(A, 'Anna')]));
	const away: boolean[] = [];
	const ch = createChanging({ crew, world, attendant: (a) => away.push(a), puff: () => {}, prefetch: () => {}, unfetch: () => {} });
	w.set(A, LOOK);
	ch.start(A, w.wearing(A, outfitFor(crew.get(A)!.agent)));
	ch.tick(16);
	for (let k = 0; k < 4000 && ch.stageOf(A) !== 'changing'; k++) { crew.step(50); ch.tick(50); }
	for (let t = 0; t < 20000 && crew.get(A)!.outfit.legs !== 'bare'; t += 100) ch.tick(100);
	assert.equal(crew.get(A)!.outfit.legs, 'bare');
	ch.cancel(A);
	assert.equal(ch.stageOf(A), null);
	assert.equal(crew.get(A)!.held, null, 'free for their farewell to take them');
	assert.notEqual(crew.get(A)!.outfit.legs, 'bare', 'never left with nothing on');
	assert.equal(away.at(-1), false);
});

test('only cloths the plant can name are kept', () => {
	assert.equal(validLook({ ...LOOK, torsoMat: 'gold' }), false);
	assert.equal(validLook({ ...LOOK, torsoMat: 'constructor' }), false);
	assert.equal(createWardrobe(null).get('constructor'), null);
});

test('looks that look the same are the same look', () => {
	assert.equal(lookKey({ ...LOOK, headwear: 'none', hatMat: 'red' }), lookKey({ ...LOOK, headwear: 'none', hatMat: 'khaki' }));
	assert.equal(lookKey({ ...LOOK, torso: 'overalls', torsoMat: 'rust', legs: 'skirt' }), lookKey({ ...LOOK, torso: 'overalls', torsoMat: 'rust', legs: 'galife' }));
	assert.notEqual(lookKey({ ...LOOK, torso: 'labcoat', torsoMat: 'medWhite', shirtMat: 'cream' }), lookKey({ ...LOOK, torso: 'labcoat', torsoMat: 'medWhite', shirtMat: 'skyShirt' }), 'a lab coat shows its shirt');
});

test('an outfit only ever seen standing never has a walk cycle baked', async () => {
	const { createFrameBank } = await import('../src/cockpit/frames');
	const asked: string[] = [];
	const client = { request: (o: { id: string }, anim: string) => { asked.push(`${o.id}|${anim}`); return new Promise<never>(() => {}); }, demote: () => {}, drop: () => {}, describe: () => '' };
	const frames = createFrameBank(client as never, () => {});
	const step = { ...ATTENDANT, id: 'step' }, walker = { ...ATTENDANT, id: 'walker' };
	for (const o of [step, walker]) frames.retain(o.id);
	frames.still('step');
	frames.want(step, 'idle', 'S');
	frames.want(walker, 'idle', 'S');
	assert.equal(asked.filter((k) => k === 'step|walk').length, 0, 'a step of changing');
	assert.equal(asked.filter((k) => k === 'walker|walk').length, 32, 'anyone else: walking in every direction');
	frames.release('step');
	frames.retain('step');
	frames.want(step, 'idle', 'SW');
	assert.ok(asked.includes('step|walk'), 'forgotten once let go');
});
