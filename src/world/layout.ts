/**
 * Furnishing as data and rules, with no drawing: what the owner has stood about the
 * plant and hung on its walls, read back safely from storage, and whether a piece fits where it
 * is dropped. A piece never stands on a workplace or a place comrades stand, in a doorway, on
 * something else or someone, and never cuts part of the plant off: the last is checked by
 * flooding the floor from the platform with the pathfinder's own rules, before and after.
 */
import { type Facing, PIECE_KINDS, POSTER_KINDS, type PieceKind, type PosterKind, pieceFoot, posterSign } from '../art/furniture';
import type { Sign } from '../art/env';
import type { Frame } from '../art/render';
import type { Footprint } from '../art/scene';
import type { V3 } from '../art/sdf';
import { clearOf, segmentClear, tileCentre, tileOf } from './path';
import type { Wall, WallRect, WallSpot, World } from './types';
import { BALLAST_FOOT, HOME_POSTERS, MOVABLE_PROPS, WALL_LEN, WORLD_H, WORLD_W, walkableFor, wallRect, zoneAt } from './zones';

/** A piece from the catalogue, stood in the middle of a tile. */
export interface PlacedPiece {
	id: string;
	kind: PieceKind;
	tile: [number, number];
	facing: Facing;
}

/** A poster from the catalogue, hung on a back wall. */
export interface PlacedPoster {
	id: string;
	kind: PosterKind;
	spot: WallSpot;
}

/** Everything the owner has changed. An empty layout is the plant as it was built. */
export interface Layout {
	pieces: PlacedPiece[];
	posters: PlacedPoster[];
	/** The plant's own props that were moved, by id: whole tiles from where they began. */
	moved: Record<string, [number, number]>;
	/** The plant's own posters that were moved, by id: where each hangs now. */
	hung: Record<string, WallSpot>;
}

/** The most pieces and posters a layout keeps (storage stays small, the depth sort quick). */
export const MAX_PIECES = 60;
/** The most catalogue posters a layout keeps. */
export const MAX_POSTERS = 24;
/** Where a new poster's top edge goes: under the plaques, over the dado. */
export const POSTER_TOP = 128;
/** How far from the corner and from other wall art a poster keeps, world units. */
const WALL_GAP = 2;

/**
 * A layout with nothing changed.
 *
 * @returns Layout.
 */
export function emptyLayout(): Layout {
	return { pieces: [], posters: [], moved: {}, hung: {} };
}

/** Why a piece or poster cannot go where it was dropped. */
export type Misfit = 'floor' | 'workplace' | 'doorway' | 'taken' | 'someone' | 'cutOff' | 'wall' | 'wallArt';

/** What the furnishing note says for each. */
export const MISFIT_WORDS: Record<Misfit, string> = {
	floor: 'It has to stand on the floor.',
	workplace: 'Comrades work or stand there.',
	doorway: 'That is a doorway.',
	taken: 'Something is already there.',
	someone: 'Someone is standing there.',
	cutOff: 'It would cut part of the plant off.',
	wall: 'Posters go on the back walls.',
	wallArt: 'Something already hangs there.',
};

/** Strict overlap of two footprints on the floor: touching is not overlapping. */
const overlaps = (a: Footprint, b: Footprint): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * The tiles a footprint covers.
 *
 * @param f Footprint.
 * @param L Tile size.
 * @returns Tiles, x and y.
 */
export function tilesUnder(f: Footprint, L: number): [number, number][] {
	const out: [number, number][] = [];
	const e = 1e-6;
	for (let ty = Math.floor(f.y0 / L); ty <= Math.floor((f.y1 - e) / L); ty++) {
		for (let tx = Math.floor(f.x0 / L); tx <= Math.floor((f.x1 - e) / L); tx++) out.push([tx, ty]);
	}
	return out;
}

/**
 * A footprint moved by whole tiles.
 *
 * @param f Footprint.
 * @param d Tiles along x and y.
 * @param L Tile size.
 * @returns Moved footprint.
 */
export function shifted(f: Footprint, d: readonly [number, number], L: number): Footprint {
	return { x0: f.x0 + d[0] * L, x1: f.x1 + d[0] * L, y0: f.y0 + d[1] * L, y1: f.y1 + d[1] * L, z0: f.z0 };
}

/** What the rules need to know about a world, worked out once. */
interface Plan {
	/** Where comrades work, stand and arrive: nothing may stand within a comrade's width of these. */
	protect: V3[];
	/** The tiles those places are reached from. */
	anchors: Set<number>;
	/** Tiles in a gap of a partition, or either side of one. */
	doorways: Set<number>;
}
const plans = new WeakMap<World, Plan>();

/**
 * The rules' view of a world, worked out on first use from the world as built.
 *
 * @param world World.
 * @returns Plan.
 */
function planOf(world: World): Plan {
	let plan = plans.get(world);
	if (plan) return plan;
	const protect: V3[] = [world.spawn, ...Object.values(world.marks).map((m) => m.pos), ...Object.values(world.zones).flatMap((z) => [...z.stations, ...z.spots])];
	const anchors = new Set<number>();
	for (const p of protect) {
		const [tx, ty] = tileOf(world, p);
		if (tx >= 0 && ty >= 0 && tx < WORLD_W && ty < WORLD_H) anchors.add(ty * WORLD_W + tx);
	}
	// A doorway: a floor tile whose neighbour across a zone boundary is floor too, with no
	// partition between their middles.
	const walls = world.scene.props.filter((p) => p.id.startsWith('wall-') || p.id.startsWith('fence-')).map((p) => p.foot);
	const doorways = new Set<number>();
	for (let ty = 0; ty < WORLD_H; ty++) for (let tx = 0; tx < WORLD_W; tx++) {
		const z = zoneAt(tx, ty);
		if (!z) continue;
		for (const [dx, dy] of [[1, 0], [0, 1]]) {
			const nz = zoneAt(tx + dx, ty + dy);
			if (!nz || nz === z) continue;
			if (!segmentClear(tileCentre(world, tx, ty), tileCentre(world, tx + dx, ty + dy), walls)) continue;
			doorways.add(ty * WORLD_W + tx);
			doorways.add((ty + dy) * WORLD_W + tx + dx);
		}
	}
	plan = { protect, anchors, doorways };
	plans.set(world, plan);
	return plan;
}

/** The eight moves, as the pathfinder makes them. */
const MOVES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Every tile a comrade can walk to from the platform, by the pathfinder's rules: walkable tiles,
 * no corners cut, and a straight walk between tile middles clear of everything standing.
 *
 * @param world World (for the tile size and the platform).
 * @param walkable Walkability.
 * @param feet Everything standing.
 * @returns 1 for each tile reached, row-major.
 */
export function reachable(world: World, walkable: Uint8Array, feet: Footprint[]): Uint8Array {
	const seen = new Uint8Array(WORLD_W * WORLD_H);
	const ok = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && walkable[y * WORLD_W + x] === 1;
	const [sx, sy] = tileOf(world, world.spawn);
	if (!ok(sx, sy)) return seen;
	const queue = [sy * WORLD_W + sx];
	seen[queue[0]] = 1;
	while (queue.length) {
		const k = queue.pop()!;
		const x = k % WORLD_W, y = (k - x) / WORLD_W;
		const c = tileCentre(world, x, y);
		for (const [dx, dy] of MOVES) {
			const nx = x + dx, ny = y + dy, n = ny * WORLD_W + nx;
			if (!ok(nx, ny) || seen[n]) continue;
			if (dx && dy && (!ok(x + dx, y) || !ok(x, y + dy))) continue;
			const nc = tileCentre(world, nx, ny);
			// Only what is near the step can block it.
			const near = feet.filter((f) => f.x0 < Math.max(c[0], nc[0]) + 12 && f.x1 > Math.min(c[0], nc[0]) - 12 && f.y0 < Math.max(c[1], nc[1]) + 12 && f.y1 > Math.min(c[1], nc[1]) - 12);
			if (!segmentClear(c, nc, near)) continue;
			seen[n] = 1;
			queue.push(n);
		}
	}
	return seen;
}

/**
 * Whether something can stand with a footprint, among everything else standing.
 *
 * @param world World.
 * @param feet Everything standing now, by id (the thing being moved may be among them).
 * @param id The thing being placed (left out of `feet` for the check).
 * @param foot Where it would stand.
 * @param standing Where comrades stand still now.
 * @returns Null when it fits, else why not.
 */
export function fits(world: World, feet: ReadonlyMap<string, Footprint>, id: string, foot: Footprint, standing: readonly V3[] = []): Misfit | null {
	const L = world.tile, plan = planOf(world);
	const tiles = tilesUnder(foot, L);
	if (tiles.some(([x, y]) => x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H || !zoneAt(x, y))) return 'floor';
	if (plan.protect.some((p) => !clearOf(p[0], p[1], foot))) return 'workplace';
	if (tiles.some(([x, y]) => plan.anchors.has(y * WORLD_W + x))) return 'workplace';
	if (tiles.some(([x, y]) => plan.doorways.has(y * WORLD_W + x))) return 'doorway';
	const others = [...feet].filter(([k]) => k !== id).map(([, f]) => f);
	if ([...others, BALLAST_FOOT].some((f) => overlaps(foot, f))) return 'taken';
	if (standing.some((p) => !clearOf(p[0], p[1], foot))) return 'someone';
	// Every workplace still walks straight to the middle of its tile, as the pathfinder needs.
	if (plan.protect.some((p) => !segmentClear(p, tileCentre(world, ...tileOf(world, p)), [foot]))) return 'workplace';
	const before = walkableFor(others), after = walkableFor([...others, foot]);
	for (const a of plan.anchors) if (before[a] && !after[a]) return 'workplace';
	const was = reachable(world, before, others), now = reachable(world, after, [...others, foot]);
	for (let k = 0; k < was.length; k++) if (was[k] && after[k] && !now[k]) return 'cutOff';
	return null;
}

/**
 * Whether one of the plant's own props can go back where it began. Its old place never had to meet
 * the rules for new pieces, so it only has to be clear: of everything else, and of anyone.
 *
 * @param feet Everything standing now, by id.
 * @param id The prop.
 * @param home Its footprint where it began.
 * @param standing Where comrades stand now.
 * @returns Null when it can, else why not.
 */
export function homeFree(feet: ReadonlyMap<string, Footprint>, id: string, home: Footprint, standing: readonly V3[] = []): Misfit | null {
	if ([...feet].some(([k, f]) => k !== id && overlaps(home, f))) return 'taken';
	if (standing.some((p) => !clearOf(p[0], p[1], home))) return 'someone';
	return null;
}

/**
 * The art of a poster in a layout: one of the plant's own, or from the catalogue.
 *
 * @param kind A catalogue poster, or the id of one of the plant's own.
 * @returns Sign.
 */
export function posterArt(kind: PosterKind | string): Sign {
	const home = HOME_POSTERS.find((h) => h.id === kind);
	return home ? home.sign() : posterSign(kind as PosterKind);
}

/**
 * Whether a poster can hang at a spot.
 *
 * @param world World.
 * @param rect The room it would take.
 * @param others The room every other poster takes.
 * @returns Null when it fits, else why not.
 */
export function posterFits(world: World, rect: WallRect, others: readonly WallRect[]): Misfit | null {
	if (rect.a0 < WALL_GAP || rect.a1 > WALL_LEN[rect.wall] - WALL_GAP || rect.z0 < 34) return 'wall';
	const clash = (r: WallRect): boolean => r.wall === rect.wall && rect.a0 < r.a1 + WALL_GAP && r.a0 < rect.a1 + WALL_GAP && rect.z0 < r.z1 + WALL_GAP && r.z0 < rect.z1 + WALL_GAP;
	return [...world.walls.art, ...others].some(clash) ? 'wallArt' : null;
}

/**
 * The point on a back wall under a point on the base layer.
 *
 * @param base Base layer (its anchor and view).
 * @param sx X, base-layer pixels.
 * @param sy Y.
 * @returns The wall, how far along it and how high, or null when the point is not on a back wall.
 */
export function wallPointAt(base: Frame, sx: number, sy: number): { wall: Wall; at: number; z: number } | null {
	const { R, U, res } = base.view;
	// Screen right of the corner is the north-east wall (y = 0), left of it the north-west (x = 0).
	const wall: Wall = sx >= base.ax ? 'ne' : 'nw';
	const i = wall === 'ne' ? 0 : 1;
	const at = (sx - base.ax) / (R[i] * res);
	const z = ((base.ay - sy) / res - at * U[i]) / U[2];
	if (at < 0 || at > WALL_LEN[wall] || z < 0 || z > 170) return null;
	return { wall, at, z };
}

/**
 * Every poster's room on the walls, by id: the plant's own where they hang now, and the catalogue's.
 *
 * @param layout Layout.
 * @returns Rooms.
 */
export function posterRects(layout: Layout): Map<string, WallRect> {
	const out = new Map<string, WallRect>();
	for (const h of HOME_POSTERS) out.set(h.id, wallRect(h.sign(), layout.hung[h.id] ?? h.spot));
	for (const p of layout.posters) out.set(p.id, wallRect(posterSign(p.kind), p.spot));
	return out;
}

/**
 * Everything standing in a layout, by id: the plant's props (the moved ones where they are now)
 * and the catalogue's pieces.
 *
 * @param world World (for the tile size).
 * @param home Every prop's footprint as the plant was built.
 * @param layout Layout.
 * @returns Footprints.
 */
export function feetOf(world: World, home: ReadonlyMap<string, Footprint>, layout: Layout): Map<string, Footprint> {
	const out = new Map<string, Footprint>();
	for (const [id, f] of home) out.set(id, layout.moved[id] ? shifted(f, layout.moved[id], world.tile) : f);
	for (const p of layout.pieces) out.set(p.id, pieceFoot(p.kind, p.facing, tileCentre(world, p.tile[0], p.tile[1])));
	return out;
}

/**
 * The shape of the ids furnishing gives new pieces and posters ("f" and two base-36 runs). Nothing
 * else is read back: a stored id that named one of the plant's own props would take its place.
 */
export const PIECE_ID = /^f[0-9a-z]{1,16}-[0-9a-z]{1,8}$/;

/**
 * Whether a value is a whole number in a range.
 *
 * @param v Value.
 * @param lo Lowest.
 * @param hi Highest.
 * @returns True when it is.
 */
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * A wall spot read from storage, or null if it is not one.
 *
 * @param v Value.
 * @returns Spot.
 */
function readSpot(v: unknown): WallSpot | null {
	if (!v || typeof v !== 'object') return null;
	const s = v as Record<string, unknown>;
	if ((s.wall !== 'ne' && s.wall !== 'nw') || typeof s.at !== 'number' || !Number.isFinite(s.at) || typeof s.zTop !== 'number' || !Number.isFinite(s.zTop)) return null;
	if (s.at < 0 || s.at > WALL_LEN[s.wall] || s.zTop < 0 || s.zTop > 170) return null;
	return { wall: s.wall, at: s.at, zTop: s.zTop };
}

/**
 * A layout read back from storage: anything that is not plainly part of one is left out, so a
 * damaged or hand-edited entry can never break the plant.
 *
 * @param raw Whatever was stored.
 * @returns Layout.
 */
export function readLayout(raw: unknown): Layout {
	const out = emptyLayout();
	if (!raw || typeof raw !== 'object') return out;
	const r = raw as Record<string, unknown>;
	const ids = new Set<string>();
	for (const v of Array.isArray(r.pieces) ? r.pieces : []) {
		if (out.pieces.length >= MAX_PIECES || !v || typeof v !== 'object') continue;
		const p = v as Record<string, unknown>;
		if (typeof p.id !== 'string' || !PIECE_ID.test(p.id) || ids.has(p.id) || !PIECE_KINDS.includes(p.kind as PieceKind)) continue;
		if (!Array.isArray(p.tile) || !int(p.tile[0], 0, WORLD_W - 1) || !int(p.tile[1], 0, WORLD_H - 1) || !int(p.facing, 0, 3)) continue;
		ids.add(p.id);
		out.pieces.push({ id: p.id, kind: p.kind as PieceKind, tile: [p.tile[0], p.tile[1]], facing: p.facing as Facing });
	}
	for (const v of Array.isArray(r.posters) ? r.posters : []) {
		if (out.posters.length >= MAX_POSTERS || !v || typeof v !== 'object') continue;
		const p = v as Record<string, unknown>;
		const spot = readSpot(p.spot);
		if (typeof p.id !== 'string' || !PIECE_ID.test(p.id) || ids.has(p.id) || !POSTER_KINDS.includes(p.kind as PosterKind) || !spot) continue;
		ids.add(p.id);
		out.posters.push({ id: p.id, kind: p.kind as PosterKind, spot });
	}
	const moved = r.moved && typeof r.moved === 'object' ? r.moved as Record<string, unknown> : {};
	for (const id of MOVABLE_PROPS) {
		const d = Object.hasOwn(moved, id) ? moved[id] : null;
		if (Array.isArray(d) && int(d[0], -WORLD_W, WORLD_W) && int(d[1], -WORLD_H, WORLD_H) && (d[0] || d[1])) out.moved[id] = [d[0], d[1]];
	}
	const hung = r.hung && typeof r.hung === 'object' ? r.hung as Record<string, unknown> : {};
	for (const { id } of HOME_POSTERS) {
		const spot = Object.hasOwn(hung, id) ? readSpot(hung[id]) : null;
		if (spot) out.hung[id] = spot;
	}
	return out;
}

/**
 * A layout with whatever no longer fits taken out, checked in the order it was built up (the
 * plant's own props first, then the pieces, then the posters). Needed because a stored layout
 * can predate a change to the plant, or come from a damaged entry.
 *
 * @param world World.
 * @param home Every prop's footprint as the plant was built.
 * @param layout Layout.
 * @returns The part of it that fits.
 */
export function settle(world: World, home: ReadonlyMap<string, Footprint>, layout: Layout): Layout {
	const out = emptyLayout();
	const feet = new Map(home);
	for (const [id, d] of Object.entries(layout.moved)) {
		const f = home.get(id);
		if (!f) continue;
		const to = shifted(f, d, world.tile);
		if (fits(world, feet, id, to)) continue;
		feet.set(id, to);
		out.moved[id] = d;
	}
	for (const p of layout.pieces) {
		const f = pieceFoot(p.kind, p.facing, tileCentre(world, p.tile[0], p.tile[1]));
		if (fits(world, feet, p.id, f)) continue;
		feet.set(p.id, f);
		out.pieces.push(p);
	}
	const rects: WallRect[] = [];
	const hang = (rect: WallRect): boolean => {
		if (posterFits(world, rect, rects)) return false;
		rects.push(rect);
		return true;
	};
	// The plant's own posters first, wherever they hang now: one that no longer fits goes home.
	for (const h of HOME_POSTERS) {
		const spot = layout.hung[h.id];
		if (spot && hang(wallRect(h.sign(), spot))) out.hung[h.id] = spot;
		else rects.push(wallRect(h.sign(), h.spot));
	}
	for (const p of layout.posters) if (hang(wallRect(posterSign(p.kind), p.spot))) out.posters.push(p);
	return out;
}

/**
 * The point on the floor under a point on the base layer.
 *
 * @param base Base layer (its anchor and view).
 * @param sx X, base-layer pixels.
 * @param sy Y.
 * @returns Floor point, world units.
 */
export function floorAt(base: Frame, sx: number, sy: number): V3 {
	const { R, U, res } = base.view;
	// Screen x and height above the anchor are each a mix of floor x and y: undo the mix.
	const a = (sx - base.ax) / res, b = (base.ay - sy) / res;
	const det = R[0] * U[1] - R[1] * U[0];
	return [(a * U[1] - b * R[1]) / det, (R[0] * b - U[0] * a) / det, 0];
}

/** Something furnishing can put down: a piece, one of the plant's own props or posters, or a catalogue poster. */
export type Put =
	| { type: 'piece'; piece: PlacedPiece }
	| { type: 'prop'; id: string; by: [number, number] }
	| { type: 'poster'; poster: PlacedPoster }
	| { type: 'homePoster'; id: string; spot: WallSpot };

/**
 * A layout with something put down (added, or moved if it is there already).
 *
 * @param l Layout.
 * @param put What, and where.
 * @returns New layout; the old one is untouched.
 */
export function withPut(l: Layout, put: Put): Layout {
	const out: Layout = { pieces: [...l.pieces], posters: [...l.posters], moved: { ...l.moved }, hung: { ...l.hung } };
	if (put.type === 'piece') {
		const k = out.pieces.findIndex((p) => p.id === put.piece.id);
		if (k >= 0) out.pieces[k] = put.piece; else out.pieces.push(put.piece);
	} else if (put.type === 'poster') {
		const k = out.posters.findIndex((p) => p.id === put.poster.id);
		if (k >= 0) out.posters[k] = put.poster; else out.posters.push(put.poster);
	} else if (put.type === 'prop') {
		if (put.by[0] || put.by[1]) out.moved[put.id] = put.by; else delete out.moved[put.id];
	} else {
		const homeSpot = HOME_POSTERS.find((h) => h.id === put.id)?.spot;
		const same = homeSpot && homeSpot.wall === put.spot.wall && Math.abs(homeSpot.at - put.spot.at) < 1e-6 && homeSpot.zTop === put.spot.zTop;
		if (same) delete out.hung[put.id]; else out.hung[put.id] = put.spot;
	}
	return out;
}

/**
 * A layout with something taken away: a catalogue piece or poster goes; one of the plant's own
 * goes back where it began.
 *
 * @param l Layout.
 * @param id What.
 * @returns New layout; the old one is untouched.
 */
export function without(l: Layout, id: string): Layout {
	const out: Layout = { pieces: l.pieces.filter((p) => p.id !== id), posters: l.posters.filter((p) => p.id !== id), moved: { ...l.moved }, hung: { ...l.hung } };
	delete out.moved[id];
	delete out.hung[id];
	return out;
}

/**
 * Whether there is room for one more piece or poster.
 *
 * @param l Layout.
 * @param poster True for a poster.
 * @returns True when there is.
 */
export function roomFor(l: Layout, poster: boolean): boolean {
	return poster ? l.posters.length < MAX_POSTERS : l.pieces.length < MAX_PIECES;
}
