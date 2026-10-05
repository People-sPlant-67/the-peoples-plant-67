/**
 * Furnishing's rules on the real world, with no drawing: what fits where and why not,
 * that nothing the rules allow ever cuts anyone off, the posters' walls, reading a layout back
 * from storage, settling an old one, and the edits furnishing makes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textWidth, missingGlyphs } from '../src/art/font';
import { PIECE_KINDS, POSTER_KINDS, POSTER_SIGNAGE, type PieceKind, pieceFoot, posterSign } from '../src/art/furniture';
import { project } from '../src/art/render';
import type { Footprint, Prop } from '../src/art/scene';
import type { V3 } from '../src/art/sdf';
import {
	type Layout, MAX_PIECES, emptyLayout, feetOf, fits, floorAt, posterFits, posterRects, readLayout, roomFor, settle, shifted, tilesUnder,
	wallPointAt, withPut, without,
} from '../src/world/layout';
import { findPath, tileCentre, tileOf } from '../src/world/path';
import type { World } from '../src/world/types';
import { HOME_POSTERS, MOVABLE_PROPS, WORLD_H, WORLD_W, buildWorld, walkableFor, wallRect } from '../src/world/zones';

const world = buildWorld();
const L = world.tile;
const home = new Map(world.scene.props.map((p) => [p.id, p.foot]));
const feet = feetOf(world, home, emptyLayout());
/** Where comrades work, stand and arrive. */
const places: V3[] = [world.spawn, ...Object.values(world.marks).map((m) => m.pos), ...Object.values(world.zones).flatMap((z) => [...z.stations, ...z.spots])];

/**
 * A piece's footprint on a tile.
 *
 * @param kind Piece.
 * @param tx Tile x.
 * @param ty Tile y.
 * @returns Footprint.
 */
const at = (kind: PieceKind, tx: number, ty: number): Footprint => pieceFoot(kind, 0, tileCentre(world, tx, ty));

/**
 * The first tile, scanning the plant, where a globe meets a given answer.
 *
 * @param want The answer.
 * @returns Tile.
 */
function firstWhere(want: ReturnType<typeof fits>): [number, number] {
	for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) if (fits(world, feet, 'new', at('globe', x, y)) === want) return [x, y];
	throw new Error(`no tile answers ${want}`);
}

test('every piece stands within its one tile, in every turn', () => {
	for (const k of PIECE_KINDS) for (const f of [0, 1, 2, 3] as const) {
		const foot = pieceFoot(k, f, tileCentre(world, 5, 5));
		assert.deepEqual(tilesUnder(foot, L), [[5, 5]], `${k} turned ${f}`);
	}
	// A quarter turn swaps a long piece's sides.
	const a = pieceFoot('bookcase', 0, [0, 0, 0]), b = pieceFoot('bookcase', 1, [0, 0, 0]);
	assert.ok(a.y1 - a.y0 > a.x1 - a.x0 && b.x1 - b.x0 > b.y1 - b.y0);
});

test('fits refuses workplaces and places comrades stand, doorways, things already there, people and the edge of the floor', () => {
	const station = world.zones.production.stations[0];
	assert.equal(fits(world, feet, 'new', at('globe', ...tileOf(world, station))), 'workplace');
	const spot = world.zones.canteen.spots[0];
	assert.equal(fits(world, feet, 'new', at('globe', ...tileOf(world, spot))), 'workplace');
	assert.equal(fits(world, feet, 'new', at('globe', 0, 19)), 'taken', 'the track bed');
	assert.equal(fits(world, feet, 'new', at('globe', 30, 15)), 'floor', 'off the floor');
	assert.equal(fits(world, feet, 'new', at('globe', -1, 3)), 'floor', 'off the grid');
	const [dx, dy] = firstWhere('doorway');
	assert.ok(dx >= 0 && dy >= 0);
	const free = firstWhere(null);
	assert.equal(fits(world, feet, 'new', at('globe', ...free), [tileCentre(world, ...free)]), 'someone', 'nobody is stood inside a piece');
	const table = world.scene.props.find((p) => p.id === 'can-table1')!.foot;
	assert.equal(fits(world, feet, 'new', at('globe', Math.floor((table.x0 + table.x1) / 2 / L), Math.floor((table.y0 + table.y1) / 2 / L))), 'taken');
	// Something already standing is not in its own way.
	const ficus = feet.get('dir-ficus')!;
	assert.notEqual(fits(world, feet, 'dir-ficus', ficus), 'taken');
});

test('whatever the rules allow, however much is crammed in, every workplace stays reachable from the platform', () => {
	const crammed = new Map(feet);
	const props: Prop[] = [...world.scene.props];
	let n = 0;
	for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
		const kind = PIECE_KINDS[(x + y) % PIECE_KINDS.length];
		const f = at(kind, x, y);
		if (fits(world, crammed, `p${n}`, f)) continue;
		crammed.set(`p${n}`, f);
		props.push({ id: `p${n}`, sprite: world.scene.base, x: 0, y: 0, foot: f });
		n++;
	}
	assert.ok(n > 100, `a crowded plant: ${n} pieces`);
	const w: World = { ...world, scene: { ...world.scene, props }, grid: { ...world.grid, walkable: walkableFor(props.map((p) => p.foot)) } };
	/**
	 * Whether a route from the platform ends exactly at a place.
	 *
	 * @param on World.
	 * @param p Place.
	 * @returns True when it does.
	 */
	const reaches = (on: World, p: V3): boolean => {
		const end = findPath(on, on.spawn, p)?.at(-1);
		return !!end && Math.hypot(end[0] - p[0], end[1] - p[1]) < 1;
	};
	// The judge's bench is up on the stage: scenes put him there, nobody walks to it. Every place that can be walked to still can.
	const walked = places.filter((p) => reaches(world, p));
	assert.ok(walked.length > places.length - 3);
	for (const p of walked) assert.ok(reaches(w, p), `a route to ${p.map(Math.round).join(',')}`);
});

test('a piece that would cut part of the plant off is refused', () => {
	// Fill the canteen's doorways but one, then try to block that one's approach.
	const [cx, cy] = firstWhere('cutOff');
	assert.equal(fits(world, feet, 'new', at('globe', cx, cy)), 'cutOff');
});

test('the plant\'s own props move by whole tiles, under the same rules', () => {
	for (const id of MOVABLE_PROPS) assert.ok(home.has(id), `${id} is in the plant`);
	const clock = home.get('rec-clock')!;
	assert.equal(fits(world, feet, 'rec-clock', shifted(clock, [-1, 1], L)), null);
	assert.equal(fits(world, feet, 'rec-clock', shifted(clock, [40, 0], L)), 'floor');
	const moved = feetOf(world, home, withPut(emptyLayout(), { type: 'prop', id: 'rec-clock', by: [-1, 1] }));
	assert.equal(moved.get('rec-clock')!.x0, clock.x0 - L);
	assert.equal(moved.get('rec-clock')!.y0, clock.y0 + L);
});

test('posters hang on the back walls, never over other wall art, and the plant\'s own two fit where they began', () => {
	for (const h of HOME_POSTERS) {
		const others = [...posterRects(emptyLayout())].filter(([k]) => k !== h.id).map(([, r]) => r);
		assert.equal(posterFits(world, wallRect(h.sign(), h.spot), others), null, h.id);
	}
	const space = posterSign('space');
	assert.equal(posterFits(world, wallRect(space, { wall: 'nw', at: 14 * L, zTop: 128 }), []), null, 'the Recruitment Office wall is free');
	assert.equal(posterFits(world, wallRect(space, { wall: 'nw', at: 10 * L, zTop: 128 }), []), 'wallArt', 'over the group photo');
	assert.equal(posterFits(world, wallRect(space, { wall: 'ne', at: 2, zTop: 128 }), []), 'wall', 'off the end of the wall');
	assert.equal(posterFits(world, wallRect(space, { wall: 'nw', at: 19 * L, zTop: 128 }), []), 'wallArt', 'over the goods doors');
	const one = wallRect(space, { wall: 'nw', at: 14 * L, zTop: 128 });
	assert.equal(posterFits(world, wallRect(space, { wall: 'nw', at: 14.5 * L, zTop: 128 }), [one]), 'wallArt', 'over another poster');
});

test('a point on screen maps back to the floor and the walls', () => {
	const base = world.scene.base;
	for (const p of [[100, 200, 0], [700, 300, 0]] as V3[]) {
		const [sx, sy] = project(base, p);
		const f = floorAt(base, sx, sy);
		assert.ok(Math.abs(f[0] - p[0]) < 1e-6 && Math.abs(f[1] - p[1]) < 1e-6);
	}
	const [nx, ny] = project(base, [300, 0, 90]);
	assert.deepEqual(roundWall(wallPointAt(base, nx, ny)), { wall: 'ne', at: 300, z: 90 });
	const [wx, wy] = project(base, [0, 500, 60]);
	assert.deepEqual(roundWall(wallPointAt(base, wx, wy)), { wall: 'nw', at: 500, z: 60 });
	const [fx, fy] = project(base, [300, 300, 0]);
	assert.equal(wallPointAt(base, fx, fy + 400), null, 'below the floor is no wall');
});

/**
 * A wall point with its numbers rounded.
 *
 * @param p Wall point.
 * @returns Rounded.
 */
function roundWall(p: ReturnType<typeof wallPointAt>) {
	return p && { wall: p.wall, at: Math.round(p.at), z: Math.round(p.z) };
}

test('a layout read back from storage keeps only what is plainly part of one', () => {
	assert.deepEqual(readLayout(null), emptyLayout());
	assert.deepEqual(readLayout('pieces'), emptyLayout());
	const raw = {
		pieces: [
			{ id: 'fa-1', kind: 'palm', tile: [3, 4], facing: 1 },
			{ id: 'fa-1', kind: 'globe', tile: [3, 5], facing: 0 },
			{ id: 'fb-1', kind: 'throne', tile: [3, 6], facing: 0 },
			{ id: 'fc-1', kind: 'globe', tile: [3.5, 6], facing: 0 },
			{ id: 'fd-1', kind: 'globe', tile: [3, 6], facing: 7 },
			{ id: 'fE<script>-1', kind: 'globe', tile: [3, 6], facing: 0 },
			{ id: 'ff-1', kind: 'globe', tile: [99, 6], facing: 0 },
			// An id that names one of the plant's own props would stand in its place.
			{ id: 'dir-desk', kind: 'palm', tile: [2, 2], facing: 0 },
			{ id: 'wall-h13-4', kind: 'palm', tile: [2, 3], facing: 0 },
		],
		posters: [{ id: 'fq-1', kind: 'lenin', spot: { wall: 'nw', at: 600, zTop: 128 } }, { id: 'fr-1', kind: 'lenin', spot: { wall: 'up', at: 600, zTop: 128 } }, { id: 'poster-plan', kind: 'lenin', spot: { wall: 'nw', at: 600, zTop: 128 } }],
		moved: { 'rec-clock': [-1, 1], 'dir-desk': [1, 0], crates: [0, 0], coal: ['1', 0], __proto__: [1, 1] },
		hung: { 'poster-plan': { wall: 'nw', at: 600, zTop: 122 }, 'poster-none': { wall: 'nw', at: 600, zTop: 122 } },
	};
	const l = readLayout(JSON.parse(JSON.stringify(raw)));
	assert.deepEqual(l.pieces, [{ id: 'fa-1', kind: 'palm', tile: [3, 4], facing: 1 }]);
	assert.deepEqual(l.posters.map((p) => p.id), ['fq-1']);
	assert.deepEqual(l.moved, { 'rec-clock': [-1, 1] });
	assert.deepEqual(Object.keys(l.hung), ['poster-plan']);
	const many = { pieces: Array.from({ length: MAX_PIECES + 5 }, (_, k) => ({ id: `fp-${k}`, kind: 'globe', tile: [k % WORLD_W, Math.floor(k / WORLD_W)], facing: 0 })) };
	assert.equal(readLayout(many).pieces.length, MAX_PIECES);
	assert.equal(roomFor(readLayout(many), false), false);
	assert.equal(roomFor(readLayout(many), true), true);
});

test('settling a stored layout drops whatever no longer fits, in the order it was built up', () => {
	const free = firstWhere(null);
	const stored: Layout = {
		pieces: [
			{ id: 'one', kind: 'globe', tile: free, facing: 0 },
			{ id: 'two', kind: 'palm', tile: free, facing: 0 },
			{ id: 'three', kind: 'palm', tile: tileOf(world, world.zones.production.stations[0]), facing: 0 },
		],
		posters: [
			{ id: 'p1', kind: 'space', spot: { wall: 'nw', at: 14 * L, zTop: 128 } },
			{ id: 'p2', kind: 'quiet', spot: { wall: 'nw', at: 14.5 * L, zTop: 128 } },
			{ id: 'p3', kind: 'lenin', spot: { wall: 'nw', at: 10 * L, zTop: 128 } },
		],
		moved: { 'rec-clock': [40, 0] },
		hung: {},
	};
	const s = settle(world, home, stored);
	assert.deepEqual(s.pieces.map((p) => p.id), ['one']);
	assert.deepEqual(s.posters.map((p) => p.id), ['p1']);
	assert.deepEqual(s.moved, {});
});

test('furnishing\'s edits: a put adds or moves, putting the plant\'s own back home forgets the move, taking away removes', () => {
	let l = withPut(emptyLayout(), { type: 'piece', piece: { id: 'a', kind: 'globe', tile: [3, 3], facing: 0 } });
	l = withPut(l, { type: 'piece', piece: { id: 'a', kind: 'globe', tile: [4, 3], facing: 2 } });
	assert.deepEqual(l.pieces, [{ id: 'a', kind: 'globe', tile: [4, 3], facing: 2 }]);
	l = withPut(l, { type: 'prop', id: 'coal', by: [1, 0] });
	assert.deepEqual(l.moved, { coal: [1, 0] });
	l = withPut(l, { type: 'prop', id: 'coal', by: [0, 0] });
	assert.deepEqual(l.moved, {});
	const plan = HOME_POSTERS.find((h) => h.id === 'poster-plan')!;
	l = withPut(l, { type: 'homePoster', id: 'poster-plan', spot: { wall: 'nw', at: 600, zTop: plan.spot.zTop } });
	assert.ok(l.hung['poster-plan']);
	l = withPut(l, { type: 'homePoster', id: 'poster-plan', spot: { ...plan.spot } });
	assert.deepEqual(l.hung, {});
	const before = l;
	l = without(l, 'a');
	assert.deepEqual(l.pieces, []);
	assert.equal(before.pieces.length, 1, 'the old layout is untouched');
});

test('the plant\'s own posters can be lifted off the wall and put back exactly', () => {
	const base = world.scene.base;
	for (const h of world.walls.posters) {
		const { over, under } = h;
		let differs = 0;
		for (let j = 0; j < over.h; j++) for (let i = 0; i < over.w * 4; i++) {
			const k = j * over.w * 4 + i;
			assert.equal(over.rgba[k], base.rgba[((over.y + j) * base.w + over.x) * 4 + i], 'the base shows the poster as built');
			if (over.rgba[k] !== under.rgba[k]) differs++;
		}
		assert.ok(differs > 100, `${h.id}: the wall behind it differs`);
	}
});

test('the posters\' lettering is in the font and fits on the paper', () => {
	for (const s of POSTER_SIGNAGE) assert.deepEqual(missingGlyphs(s), [], s);
	for (const k of POSTER_KINDS) {
		const p = posterSign(k);
		for (const t of p.texts) assert.ok(t.x >= 1 && t.x + textWidth(t.s) <= p.b[0].length - 1, `${k}: "${t.s}" fits`);
	}
});
