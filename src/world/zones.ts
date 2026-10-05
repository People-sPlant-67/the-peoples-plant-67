/**
 * The whole plant as one world: nine rooms of a Soviet factory under one roof, laid out on a
 * single tile grid in Habbo style (back walls along the north-west and north-east edges, low
 * partition walls between rooms, doorways a tile wide), plus Siberia: a snowfield off the
 * east end, past a barbed-wire fence, far enough from the platform that the camera must pan.
 *
 * Tile layout (x across, y down; rects are [x0, x1) × [y0, y1)):
 *
 *        0     6  7    11      19     24        32
 *     0  +-----+-------+--------+------+---------+
 *        | DIR | PLAN  |  PROD  |      | SIBERIA |
 *     7  +-----+-+-----+--------+ REP  |         |
 *        | PALACE| HYG |  INSP  |      +---------+ 10
 *    13  +-------+-+---+--------+------+
 *        | RECRUIT |      CANTEEN      |
 *    20  +---------+-------------------+
 *
 * Geometry is ray-marched once at startup, so primitives are kept lean: one floor box per
 * zone (its look is a surface pattern, not geometry), two back walls, and a few primitives
 * per prop. Signs are pixel decals (see env.ts).
 */
import {
	type Sign, ZONE_SIGNS, addAnvil, addCoal, addColumn, addCrates, addHut, addPine, addSignpost, addWorkbench,
	STAR, bitmap, hutChimneyTop, letterSignpost, planBoard, posterGlory, posterPlan, stamp, wallDecal, wallSurface,
} from '../art/env';
import { textWidth } from '../art/font';
import { type Facing, type PieceKind, placedPrims } from '../art/furniture';
import { INK, MATERIALS, type MaterialName, rgb } from '../art/palette';
import { type Frame, PX, TILE, makeView, project } from '../art/render';
import { type Footprint, type Scene, flatten, renderLayers } from '../art/scene';
import { type PatternOut, type Prim, type V3, box, cone, cylinder, ellipsoid, hash, roundCone } from '../art/sdf';
import { clearOf, findPath } from './path';
import type { HomePoster, Patch, TileRect, Wall, WallRect, WallSpot, World, Zone, ZoneId } from './types';

export type { Patch } from './types';

const L = TILE;
const R2 = Math.SQRT2;

/** Grid size in tiles. The main hall is 24 × 20; Siberia sticks out east as 8 × 10. */
export const WORLD_W = 32;
export const WORLD_H = 20;
/** Back wall height. Leaves a band above the posters for the zone plaques. */
const WH = 165;
/** Low partition height: waist high on a comrade, so heads show over it. */
const PART_H = 22;

export const ZONE_TILES: Record<ZoneId, TileRect> = {
	directorate: { x0: 0, y0: 0, x1: 6, y1: 7 },
	planRoom: { x0: 6, y0: 0, x1: 11, y1: 7 },
	production: { x0: 11, y0: 0, x1: 19, y1: 7 },
	repair: { x0: 19, y0: 0, x1: 24, y1: 13 },
	palace: { x0: 0, y0: 7, x1: 7, y1: 13 },
	hygiene: { x0: 7, y0: 7, x1: 11, y1: 13 },
	inspectorate: { x0: 11, y0: 7, x1: 19, y1: 13 },
	recruitment: { x0: 0, y0: 13, x1: 9, y1: 20 },
	canteen: { x0: 9, y0: 13, x1: 24, y1: 20 },
	siberia: { x0: 24, y0: 0, x1: 32, y1: 10 },
};

const LABELS: Record<ZoneId, string> = {
	recruitment: 'Recruitment Office',
	directorate: "Company Lead's Office",
	planRoom: 'Plan Room',
	inspectorate: 'Inspectorate',
	production: 'Production Floor',
	repair: 'Repair Brigade',
	hygiene: 'Office of Operational Hygiene',
	canteen: 'Canteen',
	palace: 'Palace of Culture',
	siberia: 'Siberia',
};

/**
 * Gaps in the partitions, one tile wide. 'v:X:Y' is the vertical boundary line x = X at tile
 * row Y; 'h:Y:X' is the horizontal line y = Y at tile column X. Every zone has at least one,
 * and tests/world-zones.test.ts proves every station is reachable from the platform.
 */
const DOORS = new Set([
	'v:9:16', 'h:13:3', // platform → canteen, platform → palace
	'h:7:3', // palace → director, up the red carpet
	'v:6:5', 'h:7:10', // director → plan room, plan room → hygiene
	'v:11:4', 'v:11:10', 'h:13:10', // plan room → production, hygiene → inspectorate, hygiene → canteen
	'v:19:5', 'h:7:16', // production → repair, production → inspectorate
	'v:19:10', 'h:13:15', 'h:13:21', // inspectorate → repair, inspectorate → canteen, repair → canteen
	'v:24:4', // the gate to Siberia
]);
/** Partition units replaced by the Hygiene office's window onto the Palace (not passable). */
const WINDOW = new Set(['v:7:9', 'v:7:10']);

/**
 * Which zone a tile belongs to.
 *
 * @param {number} tx Tile x.
 * @param {number} ty Tile y.
 * @returns {ZoneId | null} Zone, or null for void (no floor).
 */
export function zoneAt(tx: number, ty: number): ZoneId | null {
	for (const [id, r] of Object.entries(ZONE_TILES) as [ZoneId, TileRect][]) if (tx >= r.x0 && tx < r.x1 && ty >= r.y0 && ty < r.y1) return id;
	return null;
}

/**
 * Whether a world coordinate lies within a pixel-thin line on a regular grid.
 * Half-width 0.72px keeps a line along x or y exactly one pixel wide on the 2:1 diagonal.
 *
 * @param {number} v Coordinate.
 * @param {number} step Grid spacing.
 * @param {number} hw Half-width.
 * @returns {boolean} On a line.
 */
const onLine = (v: number, step: number, hw = 0.72 * PX): boolean => Math.abs(v - Math.round(v / step) * step) < hw;

/** World-space rectangle on the floor. */
interface Rect { x0: number; y0: number; x1: number; y1: number }

/**
 * Distance inside a rectangle to its nearest edge, or -1 if outside.
 *
 * @param {number} x World x.
 * @param {number} y World y.
 * @param {Rect} r Rectangle.
 * @returns {number} Inset.
 */
const inset = (x: number, y: number, r: Rect): number => (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1 ? -1 : Math.min(x - r.x0, r.x1 - x, y - r.y0, r.y1 - y));

/**
 * Tile rect to world rect.
 *
 * @param {TileRect} t Tiles.
 * @returns {Rect} World units.
 */
const worldRect = (t: TileRect): Rect => ({ x0: t.x0 * L, y0: t.y0 * L, x1: t.x1 * L, y1: t.y1 * L });

// Fixed points shared by the floor patterns and the furniture.
const ANVIL: V3 = [15.2 * L, 4.2 * L, 0];
const RUG: Rect = { x0: 1.3 * L, y0: 0.45 * L, x1: 5.1 * L, y1: 4.3 * L };
const RUNNER: Rect = { x0: 3.5 * L - 16, y0: 4.3 * L, x1: 3.5 * L + 16, y1: 7 * L };
const AISLE: Rect = { x0: 3.5 * L - 14, y0: 7 * L, x1: 3.5 * L + 14, y1: 13 * L };
const TRACK_Y = 19.45 * L;
const BALLAST: Rect = { x0: 0, y0: 18.9 * L, x1: 9 * L, y1: 20 * L };
/** The track bed as something nobody can stand on: it is base-layer geometry, not a prop. */
export const BALLAST_FOOT: Footprint = { ...BALLAST, z0: 0 };
const GATE: V3 = [24 * L, 4.5 * L, 0];
const HUDDLE: V3 = [28.4 * L, 6.4 * L, 0];
/** Where the buffer stop stands, just short of the canteen partition. */
const BUFFER_X = 9 * L - 22;
/** The dock rail in the Palace of Culture, between the accused and the stage. */
const DOCK_RAIL: V3 = [128, 10 * L, 0];

/** The goods doors in the north-west wall where the track goes through, world units. */
export const GOODS_DOOR = { y0: TRACK_Y - 30, y1: 20 * L - 1, h: 84 };
/** The track's centre line and where a train's front stops (short of the buffer stop). */
export const TRACK = { y: TRACK_Y, stopX: BUFFER_X - 10 };

/**
 * Red carpet with a gold border, lightly flecked. Returns null outside the rectangle.
 *
 * @param {number} x World x.
 * @param {number} y World y.
 * @param {Rect} r Carpet.
 * @param {boolean} openEnds Leave the border off the short ends (a runner joining a rug or a doorway).
 * @returns {PatternOut | null} Surface.
 */
function carpet(x: number, y: number, r: Rect, openEnds = false): PatternOut | null {
	const e = openEnds ? Math.min(x - r.x0, r.x1 - x) : inset(x, y, r);
	if (inset(x, y, r) < 0) return null;
	if (e < 2.2) return { mat: 'gold', shift: -1 };
	if (e < 4.4) return { mat: 'red', shift: -1 };
	return { mat: 'red', shift: hash(Math.floor(x / 3), Math.floor(y / 3), 17) < 0.05 ? -1 : 0 };
}

/** Floor look per zone, in world coordinates. The box's own material is the default. */
const FLOORS: Record<ZoneId, { mat: Prim['mat']; at: (x: number, y: number) => PatternOut | null }> = {
	// Parquet in a basket weave, under a red rug and a runner from the Palace door to the desk.
	directorate: {
		mat: 'wood',
		at: (x, y) => {
			const c = carpet(x, y, RUG) ?? carpet(x, y, RUNNER, true);
			if (c) return c;
			const cell = 17, i = Math.floor(x / cell), j = Math.floor(y / cell);
			const across = (i + j) % 2 ? x : y;
			if (onLine(x, cell) || onLine(y, cell) || onLine(across, cell / 3)) return { mat: 'woodDark', shift: -1 };
			return hash(i, j, Math.floor(across / (cell / 3))) < 0.3 ? { shift: -1 } : null;
		},
	},
	// Dark boards along x with staggered joints.
	planRoom: {
		mat: 'woodDark',
		at: (x, y) => {
			const pw = L / 4, row = Math.floor(y / pw), off = (row % 3) * pw, pl = 0.75 * L;
			if (onLine(y, pw) || onLine(x + off, pl)) return { shift: -2 };
			return hash(row, Math.floor((x + off) / pl), 13) < 0.35 ? { shift: -1 } : null;
		},
	},
	// Concrete slabs with an oil stain under the anvil, as on the old Production Floor corner.
	production: {
		mat: 'concrete',
		at: (x, y) => {
			if (onLine(x, L) || onLine(y, L)) return { mat: 'grout' };
			const dx = x - ANVIL[0] + 4, dy = y - ANVIL[1];
			if (Math.sqrt(dx * dx * 0.6 + dy * dy) + hash(Math.floor(x), Math.floor(y), 5) * 5 < 17) return { mat: 'oil' };
			const w = hash(Math.floor(x / (2.83 * PX)), Math.floor(y / (2.83 * PX)), 1);
			return w < 0.035 ? { shift: -1 } : w > 0.985 ? { shift: 1 } : null;
		},
	},
	// Steel tread plate: short ribs alternating direction cell by cell.
	repair: {
		mat: 'steel',
		at: (x, y) => {
			if (onLine(x, L) || onLine(y, L)) return { mat: 'iron', shift: -1 };
			const c = 6, i = Math.floor(x / c), j = Math.floor(y / c);
			const u = x - (i + 0.5) * c, v = y - (j + 0.5) * c;
			const rib = Math.abs(u) < 2.2 && Math.abs((i + j) % 2 ? u - v : u + v) < 1.1;
			return rib ? { shift: 1 } : null;
		},
	},
	// Big marble checkerboard with a red aisle between the two doors.
	palace: {
		mat: 'cream',
		at: (x, y) => {
			const c = carpet(x, y, AISLE, true);
			if (c) return c;
			if (onLine(x, L) || onLine(y, L)) return { mat: 'grout' };
			return (Math.floor(x / L) + Math.floor(y / L)) % 2 ? { mat: 'charcoal' } : null;
		},
	},
	// Small pale-blue tiles with white grout: clinical.
	hygiene: {
		mat: 'skyShirt',
		at: (x, y) => (onLine(x, L / 4) || onLine(y, L / 4) ? { mat: 'medWhite' } : null),
	},
	// Speckled linoleum with a darker border band.
	inspectorate: {
		mat: 'khaki',
		at: (x, y) => {
			if (inset(x, y, worldRect(ZONE_TILES.inspectorate)) < 7) return { mat: 'oliveDrab' };
			if (onLine(x, L) || onLine(y, L)) return { shift: -1 };
			return hash(Math.floor(x / 2), Math.floor(y / 2), 23) < 0.06 ? { shift: -1 } : null;
		},
	},
	// Red and sand half-tile metlakh checker, the canteen classic.
	canteen: {
		mat: 'sand',
		at: (x, y) => {
			const h = L / 2;
			if (onLine(x, h) || onLine(y, h)) return { mat: 'grout' };
			return (Math.floor(x / h) + Math.floor(y / h)) % 2 ? { mat: 'brickRed' } : null;
		},
	},
	// Concrete platform slabs, a yellow edge line, then ballast and sleepers.
	recruitment: {
		mat: 'concrete',
		at: (x, y) => {
			if (y >= BALLAST.y0) {
				if (y > TRACK_Y - 18 && y < TRACK_Y + 18 && ((x % 14) + 14) % 14 < 6) return { mat: 'woodDark' };
				const k = hash(Math.floor(x / 2), Math.floor(y / 2), 29);
				return { mat: 'greyWool', shift: k < 0.3 ? -1 : k > 0.85 ? 1 : 0 };
			}
			if (y > 18.55 * L && y < 18.72 * L) return { mat: 'mustard' };
			if (onLine(x, L) || onLine(y, L)) return { mat: 'grout' };
			return hash(Math.floor(x / 3), Math.floor(y / 3), 31) < 0.04 ? { shift: -1 } : null;
		},
	},
	// Snow, with a trail of boot prints from the gate to the huddle.
	siberia: {
		mat: 'snow',
		at: (x, y) => {
			const tdx = HUDDLE[0] - GATE[0], tdy = HUDDLE[1] - GATE[1], tl = Math.hypot(tdx, tdy);
			const ux = tdx / tl, uy = tdy / tl;
			const along = (x - GATE[0]) * ux + (y - GATE[1]) * uy;
			const across = -(x - GATE[0]) * uy + (y - GATE[1]) * ux;
			if (along > 6 && along < tl - 40) {
				const step = Math.round(along / 7);
				const da = along - step * 7, dc = across - (step % 2 ? 2.6 : -2.6);
				if ((da * da) / 4.4 + (dc * dc) / 1.7 < 1) return { shift: -1 };
			}
			const s = hash(Math.floor(x), Math.floor(y), 4);
			return s < 0.02 ? { shift: 1 } : s > 0.985 ? { shift: -1 } : null;
		},
	},
};

/**
 * One floor slab covering a zone, 6 units thick, top at z = 0.
 *
 * @param {ZoneId} id Zone.
 * @returns {Prim} Floor primitive.
 */
function floorOf(id: ZoneId): Prim {
	const r = worldRect(ZONE_TILES[id]);
	const c: V3 = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, -3];
	const f = FLOORS[id];
	const side: PatternOut = id === 'siberia' ? { mat: 'ice', shift: -1 } : { mat: 'concrete', shift: -1 };
	return box(c, [(r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2, 3], 0, f.mat, {
		group: 'floor',
		pattern: (lx, ly, _lz, _nx, _ny, nz) => (nz < 0.9 ? side : f.at(lx + c[0], ly + c[1])),
	});
}

/** A straight run of partition between two zones, in tile units along one grid line. */
interface Run {
	dir: 'v' | 'h';
	/** Grid line: x for 'v', y for 'h'. */
	line: number;
	/** Start and end tile along the line. */
	a: number;
	b: number;
	/** Barbed wire (Siberia) instead of a painted wall. */
	wire: boolean;
}

/**
 * Every partition run, split at doorways and zone changes and capped at 3 tiles, so each is
 * a short prop that depth-sorts cleanly against comrades walking past its ends.
 *
 * @returns {Run[]} Runs.
 */
function partitionRuns(): Run[] {
	const runs: Run[] = [];
	for (const dir of ['v', 'h'] as const) {
		const lines = dir === 'v' ? WORLD_W : WORLD_H, along = dir === 'v' ? WORLD_H : WORLD_W;
		for (let line = 1; line < lines; line++) {
			let cur: Run | null = null, curKey = '';
			for (let t = 0; t <= along; t++) {
				const za = t < along ? (dir === 'v' ? zoneAt(line - 1, t) : zoneAt(t, line - 1)) : null;
				const zb = t < along ? (dir === 'v' ? zoneAt(line, t) : zoneAt(t, line)) : null;
				const unit = `${dir}:${line}:${t}`;
				const wall = !!za && !!zb && za !== zb && !DOORS.has(unit) && !WINDOW.has(unit);
				const key = `${za}|${zb}`;
				if (cur && (!wall || key !== curKey || t - cur.a >= 3)) { runs.push(cur); cur = null; }
				if (!wall) continue;
				if (!cur) { cur = { dir, line, a: t, b: t + 1, wire: za === 'siberia' || zb === 'siberia' }; curKey = key; } else cur.b = t + 1;
			}
		}
	}
	return runs;
}

/**
 * Primitives for one partition run: a painted wall with a red cap, or a barbed-wire fence.
 *
 * @param {Run} r Run.
 * @param {string} g Outline group.
 * @returns {Prim[]} Primitives.
 */
function partition(r: Run, g: string): Prim[] {
	// Ends overlap the crossing line by half a thickness so corners close.
	const t = 2.5, a = r.a * L - t, b = r.b * L + t, m = (a + b) / 2, hl = (b - a) / 2;
	/**
	 * Map (along, across, z) to world.
	 *
	 * @param {number} u Along the line.
	 * @param {number} z Height.
	 * @returns {V3} Point.
	 */
	const at = (u: number, z: number): V3 => (r.dir === 'v' ? [r.line * L, u, z] : [u, r.line * L, z]);
	if (!r.wire) {
		const h: V3 = r.dir === 'v' ? [t, hl, PART_H / 2] : [hl, t, PART_H / 2];
		return [box(at(m, PART_H / 2), h, 0.4, 'paintGreen', { group: g, pattern: (_x, _y, lz) => (lz > PART_H / 2 - 2.6 ? { mat: 'paintLine' } : null) })];
	}
	const out: Prim[] = [];
	const n = Math.max(1, Math.round((b - a - 2 * t) / 15));
	for (let k = 0; k <= n; k++) out.push(cylinder(at(a + t + ((b - a - 2 * t) * k) / n, 17), 1.8, 17, 0.4, 'log', { group: g }));
	for (const z of [11, 20, 29]) out.push(roundCone(at(a + t, z), at(b - t, z), 1, 1, 'iron', { group: `${g}w` }));
	return out;
}

/**
 * A red plaque with cream lettering, for the top band of a back wall.
 *
 * @param {string} text Lettering.
 * @returns {Sign} Plaque.
 */
function plaque(text: string): Sign {
	const w = textWidth(text) + 8;
	const b = bitmap(w, 9, INK.posterRed);
	for (let i = 0; i < w; i++) { b[0][i] = b[8][i] = INK.posterRedDark; }
	for (let j = 0; j < 9; j++) { b[j][0] = b[j][w - 1] = INK.posterRedDark; }
	return { b, texts: [{ s: text, x: 4, y: 2, col: INK.posterCream }] };
}

/**
 * The Chairman's portrait, the only one in the plant: swept-back dark hair, a heavy moustache,
 * a high-collared tunic. Sepia on dark, in a gold frame. The default until the owner picks or
 * paints their own.
 *
 * @returns {Sign} Portrait.
 */
export function ownerPortrait(): Sign {
	const W = 24, H = 30;
	const SKIN = '#c9a27e', SHADOW = '#a8825f', HAIR = '#3a2e26', DARK = '#2b2420', TUNIC = '#5a5440';
	const b = bitmap(W, H, DARK);
	for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
		if (i < 2 || j < 2 || i >= W - 2 || j >= H - 2) { b[j][i] = i === 0 || j === 0 || i === W - 1 || j === H - 1 ? '#8a6a10' : INK.posterGold; continue; }
		// Shoulders widen downwards from the neck.
		if (j >= 20 && Math.abs(i - 11.5) < 4 + (j - 20) * 1.1) b[j][i] = TUNIC;
		const hx = (i - 11.5) / 5, hy = (j - 11) / 6.2;
		if (hx * hx + hy * hy < 1) b[j][i] = hx > 0.55 ? SHADOW : SKIN;
		// Hair swept back over the crown.
		const cx = (i - 11.5) / 5.4, cy = (j - 7.5) / 3.6;
		if (j <= 8 && cx * cx + cy * cy < 1) b[j][i] = HAIR;
	}
	// Ears.
	b[11][6] = b[12][6] = b[11][17] = b[12][17] = SHADOW;
	// Brows and eyes.
	b[9][9] = b[9][10] = b[9][13] = b[9][14] = HAIR;
	b[10][10] = b[10][13] = DARK;
	// Nose, the heavy moustache, and the mouth under it.
	b[12][11] = b[12][12] = SHADOW;
	for (let i = 8; i < 16; i++) b[14][i] = HAIR;
	for (let i = 9; i < 15; i++) b[13][i] = i === 11 || i === 12 ? SHADOW : HAIR;
	for (let i = 10; i < 14; i++) b[16][i] = '#6e4a3a';
	// The tunic's high collar and its red tabs.
	for (let i = 9; i < 15; i++) b[20][i] = TUNIC;
	b[21][9] = b[21][14] = INK.posterRed;
	return { b, texts: [] };
}

/**
 * The Palace's group photograph: gold frame, cream mat, and nobody in it yet.
 *
 * @returns {Sign} Frame.
 */
function groupPhoto(scratched = 0): Sign {
	const W = 56, H = 30;
	const b = bitmap(W, H, '#5f5646');
	for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
		const e = Math.min(i, j, W - 1 - i, H - 1 - j);
		if (e < 2) b[j][i] = e === 0 ? '#8a6a10' : INK.posterGold;
		else if (e < 4) b[j][i] = INK.posterCream;
		else if (e === 4) b[j][i] = '#4a4236';
	}
	// The collective in two rows, back row a step higher. Each airbrushed comrade is scratched
	// out in place, first from the front row's right, the way a censor works along a print.
	PHOTO_FACES.forEach(([cx, cy], k) => {
		const gone = k >= PHOTO_FACES.length - scratched;
		for (let dy = -2; dy <= 5; dy++) for (let dx = -2; dx <= 2; dx++) {
			const x = cx + dx, y = cy + dy;
			const head = dy <= 1 && dx * dx + (dy + 0.5) * (dy + 0.5) <= 5;
			const body = dy >= 3 && Math.abs(dx) <= 2;
			if (gone) {
				// Scratched through the emulsion: black with pale gouges.
				if (head || body || dy === 2) b[y][x] = (x + y * 2) % 3 === 0 ? '#c9bfa6' : '#1c1814';
				continue;
			}
			if (head) b[y][x] = dy === -2 ? '#2e2822' : '#b39b7e';
			else if (body) b[y][x] = '#3a342b';
		}
	});
	return { b, texts: [] };
}

/** Face centres in the group photo bitmap, back row first. */
export const PHOTO_FACES: [number, number][] = [
	...[10, 18, 26, 34, 42].map((x): [number, number] => [x + 2, 9]),
	...[8, 16, 24, 32, 40, 48].map((x): [number, number] => [x, 18]),
];
/** Where the group photo hangs: centre along the north-west wall, top edge height. */
export const PHOTO_AT = { cy: 10 * L, zTop: 118 };

/** The radiogram under the owner's portrait: centre of its floor footprint. */
export const RADIO: V3 = [3.5 * L, 9, 0];
/** Its body's half-size, world units. */
const RADIO_H: V3 = [14, 8, 19];
/** The dial on its front: centre (world units) and half-width and half-height. */
export const RADIO_DIAL = { c: [RADIO[0], RADIO[1] + RADIO_H[1], 16] as V3, hw: 7, hh: 2.2 };

/**
 * A 1930s floor-standing radiogram: a wooden cabinet on a plinth, a cloth grille behind
 * slats, a brass dial and two knobs. Faces the room (+y) from the north-east wall.
 *
 * @param {Prim[]} p Prop to add to.
 * @param {V3} c Centre of the footprint.
 */
function addRadiogram(p: Prim[], c: V3): void {
	const [hx, hy, hz] = RADIO_H;
	p.push(box([c[0], c[1], 1.5], [hx + 1, hy + 1, 1.5], 0.4, 'woodDark', { group: 'radioPlinth' }));
	p.push(box([c[0], c[1], 3 + hz], [hx, hy, hz], 1.2, 'wood', {
		group: 'radio',
		pattern: (lx, _ly, lz, _nx, ny, nz) => {
			if (nz > 0.9) return Math.abs(lx) > hx - 2 ? { shift: -1 } : null;
			if (ny < 0.9) return null;
			// Grille: cloth behind thin slats under an arch, in the upper part of the front.
			const gw = hx - 3.5;
			if (Math.abs(lx) < gw && lz > -2 && lz < hz - 7 + 3.5 * (1 - (lx / gw) ** 2)) return ((lx + 30) % 3.5) < 0.9 ? { mat: 'woodDark' } : { mat: 'sand' };
			const dz = lz + 3 + hz - RADIO_DIAL.c[2];
			if (Math.abs(lx) < RADIO_DIAL.hw && Math.abs(dz) < RADIO_DIAL.hh) return Math.abs(lx - 1.5) < 0.6 ? { mat: 'red' } : { mat: 'brass' };
			return null;
		},
	}));
	for (const s of [-1, 1]) p.push(ellipsoid([c[0] + s * 9.5, c[1] + hy + 0.6, RADIO_DIAL.c[2] - 7], [1.8, 1.4, 1.8], 'charcoal', { group: 'radioKnob' }));
}

/** The dial lit from behind: brass tones become a warm valve glow, one step brighter. */
const DIAL_GLOW = ['#d9862a', '#f5b03f', '#ffd66e', '#fff2b8'];

/**
 * The radiogram switched on: a copy of its pixels with the dial glowing.
 *
 * @param {Frame} sprite The radiogram's prop sprite.
 * @returns {Uint8ClampedArray} RGBA, the same size as the sprite.
 */
export function radioLit(sprite: Frame): Uint8ClampedArray {
	const out = sprite.rgba.slice();
	const body = sprite.groups.indexOf('radio');
	const glow = new Map(MATERIALS.brass.tones.map((t, k) => [rgb(t).join(), rgb(DIAL_GLOW[k])]));
	for (let i = 0; i < sprite.group.length; i++) {
		if (sprite.group[i] !== body || !out[i * 4 + 3]) continue;
		const g = glow.get(`${out[i * 4]},${out[i * 4 + 1]},${out[i * 4 + 2]}`);
		if (g) out.set(g, i * 4);
	}
	return out;
}

/**
 * The goods doors in the north-west wall, from shut (0) to fully open (steps - 1). Each state
 * is painted on the wall's own pixels, so it lines up with the brickwork, and cropped to the
 * doorway. Open, the doorway is a dark tunnel mouth that a train can come out of.
 *
 * @param {Frame} base Base layer (only its wall pixels are painted).
 * @param {number} steps Number of states.
 * @returns {Patch[]} One patch per state.
 */
export function goodsDoorStates(base: Frame, steps = 8): Patch[] {
	const { y0, y1, h } = GOODS_DOOR;
	const cols = Math.round((y1 - y0) / (R2 * PX));
	const [, top] = project(base, [0, y1, h]);
	const [, bottom] = project(base, [0, y1, 0]);
	const rows = Math.round(bottom - top);
	const half = Math.floor(cols / 2);
	const out: Patch[] = [];
	// One scratch layer for every state, cleared where the last state painted.
	const f: Frame = { ...base, rgba: new Uint8ClampedArray(base.rgba.length) };
	for (let k = 0; k < steps; k++) {
		const open = Math.round((k / (steps - 1)) * (half - 2));
		const b = bitmap(cols, rows, null);
		for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
			const edge = Math.min(i, cols - 1 - i, j);
			if (edge < 2) { b[j][i] = edge === 0 ? '#1f1c1a' : '#3b3a38'; continue; }
			// The tunnel: darker towards the top and the far side.
			const dark = j < rows * 0.3 ? '#0b0a09' : '#15120f';
			// Panels slide apart into the wall on each side.
			const inLeft = i < half - open && i >= 2, inRight = i >= half + open && i < cols - 2;
			if (!inLeft && !inRight) { b[j][i] = dark; continue; }
			const pi = inLeft ? i + open : i - open;
			const px = inLeft ? pi - 2 : pi - half;
			const pw = half - 2;
			const rim = px < 2 || px > pw - 3 || j < 4 || j > rows - 3;
			const rivet = rim && (px + j) % 4 === 0;
			const brace = Math.abs((px / pw) - ((j - 2) / (rows - 4))) < 0.06 || Math.abs((px / pw) - 1 + ((j - 2) / (rows - 4))) < 0.06;
			const stripe = Math.abs(j - rows * 0.55) < 2;
			b[j][i] = rivet ? '#9aa0a4' : rim ? '#3e4347' : stripe ? '#7a2a22' : brace ? '#42474b' : (px * 7 + j * 3) % 29 === 0 ? '#6b4a2a' : '#565c60';
		}
		wallDecal(f, { b, texts: [] }, [0, y1, h], 'left', ['wallL'], 1);
		let x0 = f.w, y0p = f.h, x1 = -1, y1p = -1;
		for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
			if (!f.rgba[(j * f.w + i) * 4 + 3]) continue;
			x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0p = Math.min(y0p, j); y1p = Math.max(y1p, j);
		}
		const w = x1 - x0 + 1, ph = y1p - y0p + 1;
		const rgba = new Uint8ClampedArray(w * ph * 4);
		for (let j = 0; j < ph; j++) rgba.set(f.rgba.subarray(((y0p + j) * f.w + x0) * 4, ((y0p + j) * f.w + x0 + w) * 4), j * w * 4);
		out.push({ x: x0, y: y0p, w, h: ph, rgba });
		for (let j = 0; j < ph; j++) f.rgba.fill(0, ((y0p + j) * f.w + x0) * 4, ((y0p + j) * f.w + x0 + w) * 4);
	}
	return out;
}

/**
 * Whether a screen point (base-layer pixels) falls inside the open doorway, where something
 * inside the wall can be seen.
 *
 * @param {Frame} base Base layer.
 * @returns {(x: number, y: number) => boolean} Test.
 */
export function doorwayTest(base: Frame): (x: number, y: number) => boolean {
	const { y0, y1, h } = GOODS_DOOR;
	const q = [project(base, [0, y1, h]), project(base, [0, y0, h]), project(base, [0, y0, 0]), project(base, [0, y1, 0])].map(([x, y]) => [x, y]);
	return (x, y) => {
		// Convex quad: the point must be on the same side of every edge.
		let sign = 0;
		for (let k = 0; k < 4; k++) {
			const [ax, ay] = q[k], [bx, by] = q[(k + 1) % 4];
			const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
			if (c === 0) continue;
			if (sign === 0) sign = Math.sign(c);
			else if (Math.sign(c) !== sign) return false;
		}
		return true;
	};
}

/**
 * The group photo as a bitmap, for the close-up when someone is airbrushed.
 *
 * @param {number} scratched How many faces are scratched out.
 * @returns {(string | null)[][]} Rows of colours.
 */
export function groupPhotoBitmap(scratched: number): (string | null)[][] {
	return groupPhoto(Math.min(scratched, PHOTO_FACES.length)).b;
}

/**
 * Repaint the group photo with some comrades scratched out (on a base layer already built).
 *
 * @param {Frame} base Base layer.
 * @param {number} scratched How many faces are scratched out.
 */
export function paintGroupPhoto(base: Frame, scratched: number): void {
	onNW(base, groupPhoto(Math.min(scratched, PHOTO_FACES.length)), PHOTO_AT.cy, PHOTO_AT.zTop);
}

/**
 * The photo's outline on screen, in base-layer pixels (the wall shears it: its right side is higher).
 *
 * @param {Frame} base Base layer.
 * @returns {[number, number][]} Top-left, top-right, bottom-right, bottom-left.
 */
export function photoQuad(base: Frame): [number, number][] {
	const cols = 56 * 2, rows = 30 * 2;
	const w = cols * R2 * PX;
	const [fx, fy] = project(base, [0, PHOTO_AT.cy + w / 2, PHOTO_AT.zTop]);
	const x0 = Math.round(fx), y0 = Math.round(fy), rise = Math.floor(cols / 2);
	return [[x0, y0], [x0 + cols, y0 - rise], [x0 + cols, y0 - rise + rows], [x0, y0 + rows]];
}

/**
 * A hanging red banner with a gold star and fringe.
 *
 * @returns {Sign} Banner.
 */
function banner(): Sign {
	const W = 10, H = 40;
	const b = bitmap(W, H, INK.posterRed);
	for (let i = 0; i < W; i++) { b[0][i] = '#8a6a10'; b[H - 1][i] = i % 2 ? INK.posterGold : null; }
	for (let j = 1; j < H - 1; j++) b[j][W - 1] = INK.posterRedDark;
	stamp(b, STAR, 0, 5, INK.posterGold);
	return { b, texts: [] };
}

/** Where the noticeboard hangs on the back wall: left of the portrait, in the director's office. */
export const NOTICE_AT = { cx: 1.42 * L, zTop: 126 } as const;

/** Where the emergency lamp hangs: above the noticeboard, under the top of the wall. */
export const LAMP_AT = { cx: NOTICE_AT.cx, zTop: 160 } as const;

/** The emergency lamp, row by row: m metal, k dark iron, r and R the red glass, w its highlight. */
const LAMP = [
	'.mmmmmmm.',
	'..kkkkk..',
	'..kmmmk..',
	'.krRRRrk.',
	'.rRwRRRr.',
	'.kRwRRRk.',
	'.rRRRRRr.',
	'.krRRRrk.',
	'..rrrrr..',
	'..kmmmk..',
];

/**
 * The emergency lamp on the director's wall: a red glass dome in an iron cage. Unlit it is a dull
 * red; lit (while Paperclip cannot be reached, flashing) it glows.
 *
 * @param {boolean} lit Lit.
 * @returns {Sign} Lamp.
 */
export function lampSign(lit: boolean): Sign {
	const ink: Record<string, string> = lit
		? { m: '#8a8e95', k: '#2a2a2e', r: '#e0322a', R: '#ff5a44', w: '#ffe0d0' }
		: { m: '#6b6f76', k: '#2a2a2e', r: '#5a1712', R: '#7e241c', w: '#a8574a' };
	const b = bitmap(LAMP[0].length, LAMP.length, null);
	LAMP.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') b[j][i] = ink[ch]; }));
	return { b, texts: [] };
}

/**
 * The emergency lamp as a patch, lit or not.
 *
 * @param {Frame} base Base layer.
 * @param {boolean} lit Lit.
 * @returns {Patch} Lamp.
 */
export function lampPatch(base: Frame, lit: boolean): Patch {
	return nePatch(base, lampSign(lit), LAMP_AT.cx, LAMP_AT.zTop, 2);
}

/** Labels on the noticeboard's slips: incoming (Inbox), visas (Approvals), failures (Failed runs). */
export const NOTICE_LABELS = ['ВХОД', 'ВИЗЫ', 'СБОИ'] as const;
/** The noticeboard's size in bitmap pixels, and its slips' width and tops. */
export const NOTICE = { w: 38, h: 27, slipW: 33, slipY: [2, 10, 18] } as const;

/**
 * The director's noticeboard: cork in a dark frame, three pinned slips, one per Paperclip count.
 * The numbers are painted over it while the plant runs; given here, they are drawn in.
 *
 * @param {(number | null)[]} counts Inbox, approvals and failed runs, or none.
 * @returns {Sign} Noticeboard.
 */
export function noticeboard(counts: (number | null)[] = []): Sign {
	const { w: W, h: H } = NOTICE;
	const b = bitmap(W, H, '#9a6b3e');
	for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
		if (i === 0 || j === 0 || i === W - 1 || j === H - 1) b[j][i] = '#3e2c1a';
		else if (hash(i, j, 31) < 0.18) b[j][i] = '#865a31';
	}
	const texts: Sign['texts'] = [];
	NOTICE.slipY.forEach((y, k) => {
		// Pinned by hand: each slip sits a pixel off the others.
		const x = 2 + (k % 2);
		for (let j = 0; j < 7; j++) for (let i = 0; i < NOTICE.slipW; i++) b[y + j][x + i] = j === 6 ? '#b8ab8c' : INK.posterCream;
		b[y][x + 1] = k === 2 ? INK.posterRed : '#3a6ea5';
		texts.push({ s: NOTICE_LABELS[k], x: x + 2, y: y + 1, col: INK.posterBlack });
		const n = counts[k];
		if (n === undefined || n === null) return;
		// Right-aligned, two pixels in from the slip's edge.
		const s = noticeNumber(n);
		texts.push({ s, x: x + NOTICE.slipW - 2 - textWidth(s), y: y + 1, col: k === 2 && n > 0 ? INK.posterRed : INK.posterBlack });
	});
	return { b, texts };
}

/**
 * A count as the noticeboard writes it: at most two digits.
 *
 * @param {number} n Count.
 * @returns {string} Lettering.
 */
export function noticeNumber(n: number): string {
	return n > 99 ? '99' : String(Math.max(0, Math.floor(n)));
}

/**
 * The Repair Brigade's tool wall: a pegboard with hammer, spanners, saw, pliers and screwdrivers.
 *
 * @returns {Sign} Tool wall.
 */
function toolWall(): Sign {
	const W = 44, H = 26;
	const b = bitmap(W, H, '#7a5a38');
	for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
		if (i === 0 || j === 0 || i === W - 1 || j === H - 1) b[j][i] = '#4e3822';
		else if (i % 4 === 2 && j % 4 === 2) b[j][i] = '#5e4429';
	}
	const steel = '#b4bbc2', wood = '#c89a62', red = INK.posterRed;
	stamp(b, ['#####', '#####'], 2, 3, steel);
	stamp(b, ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#'], 4, 5, wood);
	stamp(b, ['#.#', '###', '.#.', '.#.', '.#.', '.#.', '.#.', '.#.', '.#.', '###', '#.#'], 9, 3, steel);
	stamp(b, ['#.#', '###', '.#.', '.#.', '.#.', '.#.', '.#.', '###', '#.#'], 13, 4, steel);
	for (let j = 0; j < 5; j++) for (let i = 17; i < 30 - j; i++) b[4 + j][i] = steel;
	for (let i = 17; i < 25; i += 2) b[9][i] = steel;
	stamp(b, ['####', '#..#', '#..#', '####'], 30, 3, wood);
	stamp(b, ['#.#', '#.#', '.#.', '#.#', '#.#', '#.#', '#.#'], 36, 3, steel);
	stamp(b, ['#.#', '#.#', '#.#'], 36, 10, red);
	for (const x of [18, 22, 26]) {
		stamp(b, ['.#.', '.#.', '.#.', '.#.'], x, 13, steel);
		stamp(b, ['###', '###', '###', '###'], x, 17, x === 22 ? wood : red);
	}
	return { b, texts: [] };
}

/** How long each back wall is, world units, from the corner they share. */
export const WALL_LEN: Record<Wall, number> = { ne: 24 * L, nw: 20 * L };

/** World units up a wall for each screen pixel. */
const Z_PER_PX = 1 / Math.cos(Math.PI / 6);

/**
 * The room a sign takes on its wall.
 *
 * @param {Sign} s Sign.
 * @param {WallSpot} spot Where it hangs.
 * @param {number} scale Pixel scale.
 * @returns {WallRect} Its rectangle in the wall's plane.
 */
export function wallRect(s: Sign, spot: WallSpot, scale = 2): WallRect {
	const w = s.b[0].length * scale * R2 * PX, h = s.b.length * scale * PX * Z_PER_PX;
	return { wall: spot.wall, a0: spot.at - w / 2, a1: spot.at + w / 2, z0: spot.zTop - h, z1: spot.zTop };
}

/**
 * The top-left corner, in world units, of a sign hung at a spot. On the north-west wall
 * screen-right runs towards -y, so a sign's left edge is its larger-y end.
 *
 * @param {Sign} s Sign.
 * @param {WallSpot} spot Where it hangs.
 * @param {number} scale Pixel scale.
 * @returns {V3} Corner.
 */
function wallCorner(s: Sign, spot: WallSpot, scale: number): V3 {
	const w = s.b[0].length * scale * R2 * PX;
	return spot.wall === 'ne' ? [spot.at - w / 2, 0, spot.zTop] : [0, spot.at + w / 2, spot.zTop];
}

/**
 * Paint a sign on a back wall, only where the wall itself shows.
 *
 * @param {Frame} f Base layer.
 * @param {Sign} s Sign.
 * @param {WallSpot} spot Where it hangs.
 * @param {number} scale Pixel scale.
 */
export function hang(f: Frame, s: Sign, spot: WallSpot, scale = 2): void {
	wallDecal(f, s, wallCorner(s, spot, scale), spot.wall === 'ne' ? 'right' : 'left', [spot.wall === 'ne' ? 'wallR' : 'wallL'], scale);
}

/**
 * Trim a patch to its painted pixels.
 *
 * @param {Patch} p Patch.
 * @returns {Patch} The smallest patch holding every painted pixel (1 × 1 and clear when there are none).
 */
function trimPatch(p: Patch): Patch {
	let x0 = p.w, y0 = p.h, x1 = -1, y1 = -1;
	for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
		if (!p.rgba[(j * p.w + i) * 4 + 3]) continue;
		if (i < x0) x0 = i;
		if (i > x1) x1 = i;
		if (j < y0) y0 = j;
		if (j > y1) y1 = j;
	}
	if (x1 < 0) return { x: p.x, y: p.y, w: 1, h: 1, rgba: new Uint8ClampedArray(4) };
	const w = x1 - x0 + 1, h = y1 - y0 + 1;
	const rgba = new Uint8ClampedArray(w * h * 4);
	for (let j = 0; j < h; j++) rgba.set(p.rgba.subarray(((y0 + j) * p.w + x0) * 4, ((y0 + j) * p.w + x0 + w) * 4), j * w * 4);
	return { x: p.x + x0, y: p.y + y0, w, h, rgba };
}

/**
 * The base-layer pixels a sign hung at a spot can touch: its box, the wall's slope across it, and
 * a margin for lettering stepped off the slope.
 *
 * @param {Frame} base Base layer.
 * @param {Sign} s Sign.
 * @param {WallSpot} spot Where it hangs.
 * @param {number} scale Pixel scale.
 * @returns {{x: number, y: number, w: number, h: number}} Box, clipped to the base layer.
 */
function wallBox(base: Frame, s: Sign, spot: WallSpot, scale: number): { x: number; y: number; w: number; h: number } {
	const [fx, fy] = project(base, wallCorner(s, spot, scale));
	const bw = s.b[0].length * scale, bh = s.b.length * scale;
	const rise = Math.ceil(bw / 2);
	const x0 = Math.max(0, Math.floor(fx) - 2), x1 = Math.min(base.w, Math.ceil(fx) + bw + 2);
	const y0 = Math.max(0, Math.floor(fy) - 8 - (spot.wall === 'nw' ? rise : 0));
	const y1 = Math.min(base.h, Math.ceil(fy) + bh + 8 + (spot.wall === 'ne' ? rise : 0));
	return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * A sign on a back wall as a patch of its own pixels: painted onto a clear crop of the base
 * layer, only where the wall itself shows, exactly as hang paints it.
 *
 * @param {Frame} base Base layer.
 * @param {Sign} s Sign.
 * @param {WallSpot} spot Where it hangs.
 * @param {number} scale Pixel scale.
 * @returns {Patch} The sign's pixels, trimmed.
 */
export function wallPatch(base: Frame, s: Sign, spot: WallSpot, scale = 2): Patch {
	const { x: x0, y: y0, w, h } = wallBox(base, s, spot, scale);
	const group = new Int16Array(w * h).fill(-1);
	for (let j = 0; j < h; j++) group.set(base.group.subarray((y0 + j) * base.w + x0, (y0 + j) * base.w + x0 + w), j * w);
	const f: Frame = { w, h, ax: base.ax - x0, ay: base.ay - y0, rgba: new Uint8ClampedArray(w * h * 4), depth: new Float32Array(0), group, groups: base.groups, view: base.view };
	hang(f, s, spot, scale);
	return trimPatch({ x: x0, y: y0, w, h, rgba: f.rgba });
}

/**
 * A sign on the north-east back wall as a patch of its own pixels.
 *
 * @param {Frame} base Base layer.
 * @param {Sign} s Sign.
 * @param {number} cx Centre along x, world units.
 * @param {number} zTop Top edge height.
 * @param {number} scale Pixel scale.
 * @returns {Patch} The sign's pixels, trimmed.
 */
export function nePatch(base: Frame, s: Sign, cx: number, zTop: number, scale = 2): Patch {
	return wallPatch(base, s, { wall: 'ne', at: cx, zTop }, scale);
}

/**
 * Copy the base layer's pixels in a box.
 *
 * @param {Frame} base Base layer.
 * @param {{x: number, y: number, w: number, h: number}} b Box.
 * @returns {Patch} Copy.
 */
function grab(base: Frame, b: { x: number; y: number; w: number; h: number }): Patch {
	const rgba = new Uint8ClampedArray(b.w * b.h * 4);
	for (let j = 0; j < b.h; j++) rgba.set(base.rgba.subarray(((b.y + j) * base.w + b.x) * 4, ((b.y + j) * base.w + b.x + b.w) * 4), j * b.w * 4);
	return { ...b, rgba };
}

/** The posters the plant starts with, which furnishing can move: the art, where each hangs and what it is called. */
export const HOME_POSTERS: { id: string; sign: () => Sign; spot: WallSpot; name: string }[] = [
	{ id: 'poster-glory', sign: posterGlory, spot: { wall: 'ne', at: 11.25 * L + 35, zTop: 124 }, name: 'The poster Glory to labour' },
	{ id: 'poster-plan', sign: posterPlan, spot: { wall: 'ne', at: 14.6 * L, zTop: 122 }, name: 'The poster The plan is law' },
];

/** The props the plant starts with that furnishing can move. Workplaces, and the samovar the canteen queues at, stay put. */
export const MOVABLE_PROPS: readonly string[] = ['dir-ficus', 'dir-flag', 'crates', 'coal', 'rec-clock', 'can-soda', 'can-chess', 'pal-lenin'];
/** What furnishing calls each of them. */
export const MOVABLE_NAMES: Record<string, string> = {
	'dir-ficus': 'The ficus', 'dir-flag': 'The red flag', crates: 'The crates', coal: 'The coal heap', 'rec-clock': 'The station clock',
	'can-soda': 'The Canteen\'s soda machine', 'can-chess': 'The Canteen\'s chess table', 'pal-lenin': 'The Palace\'s bust of Lenin',
};
/**
 * The catalogue pieces the plant has of its own: a soda machine and a chess table for idle comrades
 *, and a bust of Lenin beside the Palace's stage, so there is always one to wink (14b).
 */
export const OWN_PIECES: readonly { id: string; kind: PieceKind; facing: Facing; tile: [number, number] }[] = [
	{ id: 'can-soda', kind: 'soda', facing: 1, tile: [20, 13] },
	{ id: 'can-chess', kind: 'chess', facing: 0, tile: [21, 18] },
	{ id: 'pal-lenin', kind: 'lenin', facing: 0, tile: [2, 11] },
];
/** The samovar on its counter in the Canteen, where idle comrades go for tea (world units). */
export const SAMOVAR: V3 = [23.3 * L, 15.5 * L, 0];

/** Where the Repair Brigade's tool wall hangs, under its plaque. */
export const TOOL_WALL_AT = { cx: 21.5 * L, zTop: 122 } as const;

/**
 * Walkability for a set of footprints: on a floor, and a comrade at the tile centre keeps clear
 * of every footprint and of the track bed.
 *
 * @param {Footprint[]} feet Everything standing.
 * @returns {Uint8Array} 1 where a comrade can stand, row-major.
 */
export function walkableFor(feet: Footprint[]): Uint8Array {
	const blockers = [...feet, BALLAST_FOOT];
	const walkable = new Uint8Array(WORLD_W * WORLD_H);
	for (let ty = 0; ty < WORLD_H; ty++) for (let tx = 0; tx < WORLD_W; tx++) {
		const x = (tx + 0.5) * L, y = (ty + 0.5) * L;
		walkable[ty * WORLD_W + tx] = zoneAt(tx, ty) && blockers.every((f) => clearOf(x, y, f)) ? 1 : 0;
	}
	return walkable;
}

/** The things in the plant that open something when clicked. */
export type FixtureId = 'radiogram' | 'noticeboard' | 'pravda' | 'telephone' | 'plaque' | 'toolWall';

/** Where the plant's name is stencilled on the back wall. */
const STENCIL_AT = { cx: 16.9 * L, zTop: 118, scale: 3 } as const;

/**
 * The plant's number, stencilled in light wear only: heavier wear chips the small raised o of №
 * into a colon.
 *
 * @returns {Sign} Stencil.
 */
function stencil(): Sign {
	return { b: bitmap(textWidth('№67'), 5, null), texts: [{ s: '№67', x: 0, y: 0, col: INK.stencil, worn: 0.06 }] };
}

/**
 * A prop's own pixels, or one group's within it, as a patch.
 *
 * @param {Scene} scene Scene.
 * @param {string} id Prop id.
 * @param {string} group Group within the prop, or none for all of it.
 * @returns {Patch} Pixels, trimmed.
 */
function propPatch(scene: Scene, id: string, group?: string): Patch {
	const p = scene.props.find((q) => q.id === id);
	if (!p) return { x: 0, y: 0, w: 1, h: 1, rgba: new Uint8ClampedArray(4) };
	const g = group ? p.sprite.groups.indexOf(group) : -1;
	const rgba = p.sprite.rgba.slice();
	if (group) for (let k = 0; k < p.sprite.group.length; k++) if (p.sprite.group[k] !== g) rgba[k * 4 + 3] = 0;
	return trimPatch({ x: p.x, y: p.y, w: p.sprite.w, h: p.sprite.h, rgba });
}

/**
 * The noticeboard as a patch, with the counts on its slips: painted over the board while the plant runs.
 *
 * @param {Frame} base Base layer.
 * @param {(number | null)[]} counts Inbox, approvals and failed runs.
 * @returns {Patch} Board.
 */
export function noticeboardPatch(base: Frame, counts: (number | null)[]): Patch {
	return nePatch(base, noticeboard(counts), NOTICE_AT.cx, NOTICE_AT.zTop, 2);
}

/**
 * Each fixture's own pixels, where they sit in the base layer: what the cockpit outlines, shakes
 * and hit-tests.
 *
 * @param {Scene} scene The plant's scene.
 * @returns {Record<FixtureId, Patch>} Patches.
 */
export function fixturePatches(scene: Scene): Record<FixtureId, Patch> {
	return {
		radiogram: propPatch(scene, 'dir-radio'),
		noticeboard: noticeboardPatch(scene.base, []),
		pravda: propPatch(scene, 'dir-desk', 'papers'),
		telephone: propPatch(scene, 'dir-desk', 'phone'),
		plaque: nePatch(scene.base, stencil(), STENCIL_AT.cx, STENCIL_AT.zTop, STENCIL_AT.scale),
		toolWall: nePatch(scene.base, toolWall(), TOOL_WALL_AT.cx, TOOL_WALL_AT.zTop),
	};
}

/**
 * Paint a sign on the north-west back wall (the x = 0 plane), centred on y. On this wall
 * screen-right runs towards -y, so the sign's left edge is its larger-y end.
 *
 * @param {Frame} f Base layer.
 * @param {Sign} s Sign.
 * @param {number} cy Centre along y, world units.
 * @param {number} zTop Top edge height.
 * @param {number} scale Pixel scale.
 */
function onNW(f: Frame, s: Sign, cy: number, zTop: number, scale = 2): void {
	hang(f, s, { wall: 'nw', at: cy, zTop }, scale);
}

/** The гардероб in the Palace of Culture, world units: its middle along x, and from the back to the front, the rack, the attendant, the counter and where a comrade changes. */
export const CLOAK = { x: 5.55 * L, rackY: 7.1 * L, attendantY: 7.56 * L, counterY: 7.97 * L, spotY: 8.5 * L } as const;

/** Top edge of the plaque band on the back walls. */
const PLAQUE_Z = 153;

/**
 * A free-standing red board on two posts, facing the camera (+y), for zones with no back wall.
 * Returns a function that letters the board once its sprite is rendered.
 *
 * @param {Prim[]} p Prop primitives to push into.
 * @param {string} g Group name for the board face (the lettering paints only there).
 * @param {string} text Lettering.
 * @param {V3} c Centre on the floor.
 * @returns {(sprite: Frame) => void} Letterer.
 */
function addBoard(p: Prim[], g: string, text: string, c: V3): (sprite: Frame) => void {
	const tw = textWidth(text) * R2 * PX;
	const hw = tw + 7, zc = 66, hz = 9;
	for (const s of [-1, 1]) p.push(box([c[0] + s * (hw - 4), c[1], 38], [1.6, 1.6, 38], 0.3, 'woodDark', { group: `${g}post` }));
	p.push(box([c[0], c[1], zc], [hw, 1.4, hz], 0.4, 'red', {
		group: g,
		pattern: (lx, _ly, lz) => (Math.abs(lx) > hw - 1.8 || Math.abs(lz) > hz - 1.8 ? { mat: 'gold', shift: -1 } : null),
	}));
	// Text is 10px (11.5 units) tall at 2×; centre it on the board face.
	return (sprite) => wallDecal(sprite, { b: bitmap(textWidth(text), 5, null), texts: [{ s: text, x: 0, y: 0, col: INK.posterCream }] }, [c[0] - tw, c[1] + 1.5, zc + 5.77], 'right', [g], 2);
}

/**
 * Build the whole plant: floors, walls, partitions, furniture, signage, zones and the walkability grid.
 *
 * @returns {World} World.
 */
export function buildWorld(): World {
	const prims: Prim[] = [];
	const props: { id: string; prims: Prim[] }[] = [];
	/** Start a new prop; primitives pushed until the next call belong to it. */
	const prop = (id: string): Prim[] => { const p: Prim[] = []; props.push({ id, prims: p }); return p; };
	/** Sprite work to do once props are rendered, keyed by prop id. */
	const letter: [string, (sprite: Frame) => void][] = [];

	// Floors and back walls
	for (const id of Object.keys(ZONE_TILES) as ZoneId[]) prims.push(floorOf(id));
	const hallW = 24 * L, hallH = 20 * L;
	const lwC: V3 = [-4, hallH / 2 - 4, WH / 2 - 3];
	prims.push(box(lwC, [4, hallH / 2 + 4, WH / 2 + 3], 0, 'brick', {
		group: 'wallL',
		pattern: (_lx, ly, lz, nx, _ny, nz) => (nz > 0.9 ? { mat: 'concrete', shift: 0 } : nx < 0.9 ? { mat: 'brick', shift: 0 } : wallSurface(-(ly + lwC[1]), lz + lwC[2], 1)),
	}));
	const rwC: V3 = [hallW / 2, -4, WH / 2 - 3];
	prims.push(box(rwC, [hallW / 2, 4, WH / 2 + 3], 0, 'brick', {
		group: 'wallR',
		pattern: (lx, _ly, lz, nx, ny, nz) => (nz > 0.9 ? { mat: 'concrete', shift: 0 } : ny < 0.9 ? { mat: 'brick', shift: nx > 0.5 ? 0 : -1 } : wallSurface(lx + rwC[0], lz + rwC[2], 1)),
	}));
	// Rails lie flat in the ballast: base layer, since nobody can stand south of them.
	for (const dy of [-12, 12]) prims.push(roundCone([0, TRACK_Y + dy, 1.8], [9 * L - 6, TRACK_Y + dy, 1.8], 1.8, 1.8, 'steel', { group: 'rail' }));

	// Partitions
	for (const r of partitionRuns()) {
		const id = `${r.wire ? 'fence' : 'wall'}-${r.dir}${r.line}-${r.a}`;
		prop(id).push(...partition(r, id));
	}

	// Directorate: big desk, flag, ficus
	const desk = prop('dir-desk');
	const dc: V3 = [3.5 * L, 2.7 * L, 0];
	desk.push(box([dc[0], dc[1], 25], [34, 15, 1.6], 0.5, 'woodDark', { group: 'desk', pattern: (lx, ly) => (Math.abs(lx) < 30 && Math.abs(ly) < 11 ? { mat: 'bottleGreen' } : null) }));
	for (const s of [-1, 1]) desk.push(box([dc[0] + s * 23, dc[1], 11.7], [9, 13, 11.7], 0.4, 'woodDark', { group: 'deskPed' }));
	// The red telephone: a rotary base, a cream dial and the handset across its cradle.
	desk.push(box([dc[0] + 20, dc[1] - 3, 28.4], [4.6, 3.6, 1.9], 0.9, 'red', { group: 'phone' }));
	desk.push(cylinder([dc[0] + 20, dc[1] - 1.2, 30.4], 2, 0.3, 0.2, 'cream', { group: 'phone' }));
	desk.push(roundCone([dc[0] + 15.5, dc[1] - 4.6, 31.6], [dc[0] + 24.5, dc[1] - 4.6, 31.6], 1.5, 1.5, 'red', { group: 'phone' }));
	// Pravda, folded: the red masthead along the far edge, columns of print below it.
	desk.push(box([dc[0] - 9, dc[1] + 1, 27], [9, 6.5, 0.5], 0.2, 'cream', {
		group: 'papers',
		pattern: (lx, ly, _lz, _nx, _ny, nz) => {
			if (nz < 0.9) return null;
			if (ly < -3.6) return { mat: 'red' };
			return Math.abs(lx) < 8 && ly < 5.5 && Math.floor(ly + 7) % 2 === 0 && Math.abs(lx) > 0.6 ? { shift: -1 } : null;
		},
	}));
	const flag = prop('dir-flag');
	const fc: V3 = [0.6 * L, 0.6 * L, 0];
	flag.push(cylinder([fc[0], fc[1], 1.5], 5, 1.5, 0.5, 'iron', { group: 'flagBase' }));
	flag.push(roundCone([fc[0], fc[1], 0], [fc[0], fc[1], 100], 1.1, 1.1, 'brass', { group: 'flagPole' }));
	flag.push(box([fc[0], fc[1] + 13, 86], [0.7, 12, 9], 0.3, 'red', { group: 'flag', pattern: (_lx, ly, lz) => (Math.abs(ly + 6) < 2.4 && Math.abs(lz - 4) < 2.4 ? { mat: 'gold' } : null) }));
	const ficus = prop('dir-ficus');
	const pc: V3 = [5.4 * L, 0.6 * L, 0];
	ficus.push(cylinder([pc[0], pc[1], 6], 6, 6, 1, 'brickRed', { group: 'pot' }));
	ficus.push(ellipsoid([pc[0], pc[1], 21], [7, 7, 9], 'bottleGreen', { group: 'leaves' }));
	ficus.push(ellipsoid([pc[0] - 4, pc[1] + 3, 30], [5, 5, 6], 'bottleGreen', { group: 'leaves2' }));
	ficus.push(ellipsoid([pc[0] + 4, pc[1] - 3, 32], [5, 5, 6], 'bottleGreen', { group: 'leaves3' }));
	addRadiogram(prop('dir-radio'), RADIO);

	// Plan Room: map table (the chalk Plan board is on the wall)
	const table = prop('plan-table');
	const tc: V3 = [8.5 * L, 3.6 * L, 0];
	table.push(box([tc[0], tc[1], 22], [36, 22, 1.6], 0.5, 'wood', {
		group: 'mapTable',
		pattern: (lx, ly, _lz, _nx, _ny, nz) => {
			if (nz < 0.9 || Math.abs(lx) > 32 || Math.abs(ly) > 18) return null;
			if (Math.abs(ly - 7 * Math.sin(lx / 9) + 2) < 1.3) return { mat: 'fadedBlue' };
			if ((Math.abs(lx - ly - 6) < 1 && lx > -10 && lx < 14) || (Math.abs(lx + 18) < 3 && Math.abs(ly + 8) < 3)) return { mat: 'red' };
			return { mat: 'cream' };
		},
	}));
	for (const [dx, dy] of [[-32, -18], [32, -18], [-32, 18], [32, 18]]) table.push(box([tc[0] + dx, tc[1] + dy, 10.2], [1.6, 1.6, 10.2], 0.3, 'woodDark', { group: 'tableLeg' }));

	// Production Floor: the original anvil, workbench, crates, coal and column, plus three spare benches
	addAnvil(prop('anvil'), ANVIL);
	addWorkbench(prop('workbench'), [11 * L + 17, 2.6 * L, 0]);
	const spareX = [12.2 * L, 14.2 * L, 16.2 * L];
	spareX.forEach((x, k) => addWorkbench(prop(`bench${k + 1}`), [x, 34, 0], true, k === 1));
	addCrates(prop('crates'), [17.4 * L, 5.6 * L, 0]);
	addCoal(prop('coal'), [18.2 * L, 2.2 * L, 0]);
	addColumn(prop('column'), [18.5 * L, 5, 0], WH);

	// Repair Brigade: vice bench under the tool wall, a pile of spare parts
	addWorkbench(prop('rep-vice'), [21.3 * L, 34, 0], true);
	const parts = prop('rep-parts');
	const rp: V3 = [22.9 * L, 8.8 * L, 0];
	parts.push(box([rp[0], rp[1], 11], [11, 11, 11], 0.7, 'woodDark', { group: 'partsCrate' }));
	parts.push(cylinder([rp[0] + 14, rp[1] + 10, 2], 9, 2, 0.5, 'iron', { group: 'gear1', pattern: (lx, ly) => ((Math.atan2(ly, lx) * 12 / Math.PI) % 2 < 1 && Math.hypot(lx, ly) > 7 ? { shift: -1 } : null) }));
	parts.push(cylinder([rp[0] + 13, rp[1] + 9, 6], 6, 2, 0.5, 'steel', { group: 'gear2' }));
	parts.push(cylinder([rp[0] - 16, rp[1] + 6, 12], 7, 12, 1, 'red', { group: 'drum', pattern: (_lx, _ly, lz) => (Math.abs(Math.abs(lz) - 6) < 1 ? { shift: -1 } : null) }));
	parts.push(roundCone([rp[0] - 8, rp[1] + 16, 2.5], [rp[0] + 20, rp[1] - 6, 2.5], 2.5, 2.5, 'steel', { group: 'pipe' }));

	// Palace of Culture: tribunal podium (the group photo and banners are on the wall)
	const pod = prop('pal-podium');
	pod.push(box([30, 10 * L, 5], [28, 72, 5], 0.5, 'woodDark', {
		group: 'stage',
		pattern: (_lx, ly, _lz, nx, ny, nz) => (nz > 0.9 ? null : nx > 0.9 || ny > 0.9 ? { mat: 'red', shift: ((ly % 6) + 6) % 6 < 1.5 ? -1 : 0 } : null),
	}));
	pod.push(box([36, 10 * L, 25], [7, 10, 15], 0.5, 'wood', {
		group: 'lectern',
		pattern: (_lx, ly, lz, nx) => (nx > 0.9 && Math.hypot(ly, lz - 4) < 3.5 ? { mat: 'gold' } : null),
	}));

	// The гардероб: a rack of coats under its sign along the wall to the Directorate, the
	// attendant's place in front of it, and the counter across the front, right of the red carpet.
	letter.push(['pal-cloak-rack', addBoard(prop('pal-cloak-rack'), 'cloakSign', 'ГАРДЕРОБ', [CLOAK.x, CLOAK.rackY, 0])]);
	const coats = prop('pal-cloak-coats');
	const coatMats: MaterialName[] = ['greyWool', 'brownLeather', 'navyWork', 'oliveDrab', 'charcoal', 'sand', 'blackLeather', 'bottleGreen', 'fur'];
	for (let k = 0; k < 9; k++) {
		const cx = CLOAK.x - 40 + k * 10;
		coats.push(box([cx, CLOAK.rackY + 1.5, 40], [3.4, 2.2, 13 - (k % 3) * 2], 2.2, coatMats[k], { group: `coat${k}`, pattern: (_lx, _ly, lz) => (lz > 9 ? { shift: -1 } : null) }));
		if (k % 2 === 0) coats.push(ellipsoid([cx, CLOAK.rackY + 1.5, 57], [3.6, 3.6, 2.2], k % 4 === 0 ? 'fur' : 'greyWool', { group: `hatOnHook${k}` }));
	}
	const counter = prop('pal-cloak-counter');
	counter.push(box([CLOAK.x, CLOAK.counterY, 12], [50, 5, 12], 0.6, 'woodDark', { group: 'cloakCounter', pattern: (lx, _ly, lz, _nx, ny) => (ny > 0.9 && Math.abs(lx % 12) < 0.8 && lz < 10 ? { shift: -1 } : null) }));
	counter.push(box([CLOAK.x, CLOAK.counterY, 25], [52, 6.5, 1.2], 0.4, 'wood', { group: 'cloakTop' }));
	for (let k = 0; k < 4; k++) counter.push(cylinder([CLOAK.x - 30 + k * 7, CLOAK.counterY + 1, 26.5], 1.5, 0.3, 0.2, 'brass', { group: `token${k}` }));

	// The dock: a low rail the accused stands behind, facing the stage.
	const dock = prop('pal-dock');
	dock.push(box([DOCK_RAIL[0], DOCK_RAIL[1], 16], [2, 16, 1.6], 0.6, 'woodDark', { group: 'dockRail' }));
	for (const s of [-1, 1]) dock.push(box([DOCK_RAIL[0], DOCK_RAIL[1] + s * 15, 8], [1.6, 1.6, 8], 0.3, 'woodDark', { group: 'dockPost' }));
	dock.push(box([DOCK_RAIL[0], DOCK_RAIL[1], 8], [0.8, 14, 6], 0.2, 'wood', { group: 'dockPanel' }));

	// Office of Operational Hygiene: clerk desk with ledger, window onto the Palace, board
	const hd = prop('hyg-desk');
	const hc: V3 = [8.6 * L, 9.6 * L, 0];
	hd.push(box([hc[0], hc[1], 25], [14, 28, 1.6], 0.5, 'woodDark', { group: 'hdesk' }));
	for (const s of [-1, 1]) hd.push(box([hc[0], hc[1] + s * 20, 11.7], [11, 6, 11.7], 0.4, 'woodDark', { group: 'hdeskPed' }));
	hd.push(box([hc[0], hc[1], 27.4], [9, 12, 0.8], 0.3, 'red', { group: 'ledger' }));
	hd.push(box([hc[0], hc[1], 28.8], [8, 11, 0.7], 0.2, 'cream', { group: 'pages', pattern: (lx, ly) => (Math.abs(ly) < 0.8 ? { shift: -1 } : ((lx % 3) + 3) % 3 < 0.8 && Math.abs(ly) > 2 ? { shift: -1 } : null) }));
	hd.push(cylinder([hc[0] - 6, hc[1] + 17, 29], 1.8, 2, 0.5, 'charcoal', { group: 'ink' }));
	const win = prop('hyg-window');
	const wy0 = 9 * L, wy1 = 11 * L, wx = 7 * L;
	win.push(box([wx, (wy0 + wy1) / 2, PART_H / 2], [2.5, (wy1 - wy0) / 2, PART_H / 2], 0.4, 'paintGreen', { group: 'winWall', pattern: (_x, _y, lz) => (lz > PART_H / 2 - 2.6 ? { mat: 'paintLine' } : null) }));
	for (const y of [wy0 + 2, wy1 - 2, (wy0 + wy1) / 2]) win.push(box([wx, y, 38], [2, 2, 16], 0.3, 'woodDark', { group: 'winFrame' }));
	win.push(box([wx, (wy0 + wy1) / 2, 55], [2.4, (wy1 - wy0) / 2, 2], 0.3, 'woodDark', { group: 'winFrame' }));
	win.push(box([wx, (wy0 + wy1) / 2, 38], [0.8, (wy1 - wy0) / 2 - 2, 15], 0, 'ice', { group: 'winPane', pattern: (_lx, ly, lz) => (Math.abs(ly - lz * 0.8 - 10) < 2 ? { shift: 1 } : null) }));
	letter.push(['hyg-board', addBoard(prop('hyg-board'), 'hygBoard', ZONE_SIGNS.hygiene, [8.4 * L, 7.4 * L, 0])]);

	// Inspectorate: filing cabinets, desk with lamp, board
	const cab = prop('ins-cabinets');
	for (const k of [0, 1, 2]) {
		cab.push(box([11 * L + 16 + k * 22, 7 * L + 13, 16], [10, 10, 16], 0.5, 'greyWool', {
			group: `cab${k}`,
			pattern: (_lx, ly, lz, _nx, ny) => (ny > 0.9 ? (((lz + 16) % 10.5) < 1 ? { shift: -1 } : Math.abs(ly) < 0.1 || (Math.abs(lz % 10.5 - 5) < 1 && Math.abs(_lx) < 3) ? { mat: 'brass' } : null) : null),
		}));
	}
	const idk = prop('ins-desk');
	const ic: V3 = [15.6 * L, 10 * L, 0];
	idk.push(box([ic[0], ic[1], 25], [15, 30, 1.6], 0.5, 'woodDark', { group: 'idesk' }));
	for (const s of [-1, 1]) idk.push(box([ic[0], ic[1] + s * 21, 11.7], [12, 7, 11.7], 0.4, 'woodDark', { group: 'ideskPed' }));
	idk.push(cylinder([ic[0] + 4, ic[1] - 20, 28], 3.2, 1, 0.4, 'iron', { group: 'lampBase' }));
	idk.push(roundCone([ic[0] + 4, ic[1] - 20, 28], [ic[0] + 1, ic[1] - 12, 43], 0.9, 0.9, 'brass', { group: 'lampArm' }));
	idk.push(cone([ic[0] + 1, ic[1] - 10, 43], 3.2, 6.5, 2, 'bottleGreen', { group: 'lampShade' }));
	idk.push(box([ic[0] - 2, ic[1] + 12, 28.2], [7, 5.5, 1.2], 0.2, 'cream', { group: 'dossiers' }));
	letter.push(['ins-board', addBoard(prop('ins-board'), 'insBoard', ZONE_SIGNS.inspectorate, [14.2 * L, 7.4 * L, 0])]);

	// Canteen: four standing tables, the samovar on its counter, board
	const tables: V3[] = [[12.5 * L, 15.5 * L, 0], [17.5 * L, 15.5 * L, 0], [12.5 * L, 18.5 * L, 0], [17.5 * L, 18.5 * L, 0]];
	tables.forEach((c, k) => {
		const t = prop(`can-table${k + 1}`);
		t.push(box([c[0], c[1], 29], [104, 14, 1.6], 0.5, 'wood', { group: `ctop${k}`, pattern: (lx) => (onLine(lx + 104, 26) ? { shift: -1 } : null) }));
		for (const dx of [-88, 0, 88]) t.push(box([c[0] + dx, c[1], 14], [1.8, 10, 14], 0.4, 'iron', { group: `cleg${k}` }));
		for (const dx of [-60, 25]) t.push(cylinder([c[0] + dx + k * 7, c[1] + 4, 32.6], 2.4, 2, 0.5, k % 2 ? 'medWhite' : 'brickRed', { group: `cup${k}` }));
	});
	const sam = prop('can-samovar');
	const sc: V3 = SAMOVAR;
	sam.push(box([sc[0], sc[1], 15], [12, 44, 15], 0.6, 'woodDark', { group: 'counter', pattern: (_lx, ly, _lz, _nx, _ny, nz) => (nz > 0.9 ? { mat: 'wood' } : ((ly % 15) + 15) % 15 < 1 ? { shift: -1 } : null) }));
	sam.push(cylinder([sc[0], sc[1] - 8, 32], 5, 2, 0.6, 'brass', { group: 'samovar' }));
	sam.push(cylinder([sc[0], sc[1] - 8, 42], 7.5, 8.5, 2, 'brass', { group: 'samovar' }));
	sam.push(cone([sc[0], sc[1] - 8, 53], 3, 7.5, 3, 'brass', { group: 'samovarTop' }));
	sam.push(cylinder([sc[0], sc[1] - 8, 59], 1.6, 3, 0.4, 'iron', { group: 'samovarChimney' }));
	sam.push(box([sc[0], sc[1] - 0.5, 39], [1.2, 1.6, 1.2], 0.4, 'brass', { group: 'tap' }));
	for (const dy of [14, 24]) sam.push(cylinder([sc[0] - 3, sc[1] + dy, 32.4], 2.4, 2.4, 0.5, 'medWhite', { group: `glass${dy}` }));
	letter.push(['can-board', addBoard(prop('can-board'), 'canBoard', ZONE_SIGNS.canteen, [17.5 * L, 13.4 * L, 0])]);
	for (const o of OWN_PIECES) prop(o.id).push(...placedPrims(o.kind, o.facing, [(o.tile[0] + 0.5) * L, (o.tile[1] + 0.5) * L, 0]));

	// Recruitment Office: kiosk against the wall, station clock, buffer stop
	const kiosk = prop('rec-kiosk');
	const kc: V3 = [26, 14.3 * L, 0];
	kiosk.push(box([kc[0], kc[1], 26], [22, 30, 26], 0.6, 'paintGreen', { group: 'kiosk', pattern: (_lx, _ly, lz) => (lz < -22 ? { mat: 'paintLine' } : null) }));
	kiosk.push(box([kc[0] + 2, kc[1], 54.5], [25, 33, 2.5], 0.6, 'red', { group: 'kioskRoof' }));
	kiosk.push(box([kc[0] + 22.2, kc[1], 33], [0.8, 16, 9], 0.2, 'ice', { group: 'kioskWin', pattern: (_lx, ly) => (Math.abs(ly) < 0.8 ? { mat: 'woodDark' } : null) }));
	kiosk.push(box([kc[0] + 26, kc[1], 22], [4, 18, 1.2], 0.3, 'wood', { group: 'kioskShelf' }));
	const clock = prop('rec-clock');
	const cc: V3 = [7.5 * L, 14.2 * L, 0];
	clock.push(roundCone([cc[0], cc[1], 0], [cc[0], cc[1], 76], 1.6, 1.3, 'iron', { group: 'clockPost' }));
	clock.push(box([cc[0], cc[1], 84], [8.5, 3, 8.5], 1, 'iron', { group: 'clockBox' }));
	clock.push(ellipsoid([cc[0], cc[1] + 2.6, 84], [7, 1.2, 7], 'medWhite', {
		group: 'clockFace',
		// Hands at ten to two, as clocks are always photographed.
		pattern: (lx, _ly, lz) => ((Math.abs(lz - lx * 0.6) < 0.9 && lx > 0 && lx < 5) || (Math.abs(lz + lx * 0.6) < 0.9 && lx < 0 && lx > -3.5) ? { mat: 'charcoal' } : null),
	}));
	// Buffer stop at the canteen end: trains come in through the goods doors and stop here.
	const buf = prop('rec-buffer');
	const bx = BUFFER_X;
	buf.push(box([bx, TRACK_Y, 12], [3, 17, 4.5], 0.5, 'red', { group: 'bufBeam', pattern: (lx, ly) => (((ly - lx + 40) % 8) < 4 ? { mat: 'cream' } : null) }));
	for (const s of [-1, 1]) {
		buf.push(ellipsoid([bx - 5, TRACK_Y + s * 10, 12], [3, 3.2, 3.2], 'iron', { group: 'buffers' }));
		buf.push(roundCone([bx + 10, TRACK_Y + s * 12, 1], [bx + 1, TRACK_Y + s * 12, 12], 1.6, 1.6, 'woodDark', { group: 'bufStrut' }));
	}

	// Siberia: pines, hut and signpost, as in the Siberia scene
	const S0 = 24 * L;
	const pines: [number, number, number][] = [[25.2, 0.7, 1], [27.0, 0.5, 1.15], [31.3, 3.2, 1.1], [31.2, 7.8, 0.9], [25.1, 9.2, 0.85]];
	pines.forEach(([x, y, s], k) => addPine(prop(`pine${k}`), [x * L, y * L, 0], s, `pine${k}`));
	const hut: V3 = [29.8 * L, 1.3 * L, 24];
	addHut(prop('hut'), hut);
	const sp: V3 = [25.6 * L, 6.6 * L, 0];
	addSignpost(prop('signpost'), sp);
	letter.push(['signpost', (s) => letterSignpost(s, sp)]);

	const { base, props: layers } = renderLayers(prims, props, makeView(0));
	for (const [id, fn] of letter) fn(layers.find((p) => p.id === id)!.sprite);

	// Wall signage. North-west wall: director, Palace, platform. North-east: plan room,
	// production, repair (the Plan board, posters and tool wall hang under their plaques). Each
	// is noted, so furnishing never hangs a poster over it.
	const art: WallRect[] = [];
	/**
	 * Hang a sign for good and note the room it takes.
	 *
	 * @param wall Wall.
	 * @param s Sign.
	 * @param at Middle along the wall.
	 * @param zTop Top edge.
	 * @param scale Pixel scale.
	 */
	const fixed = (wall: Wall, s: Sign, at: number, zTop: number, scale = 2): void => {
		hang(base, s, { wall, at, zTop }, scale);
		art.push(wallRect(s, { wall, at, zTop }, scale));
	};
	fixed('nw', plaque(ZONE_SIGNS.directorate), 3.5 * L, PLAQUE_Z);
	fixed('ne', ownerPortrait(), 3.5 * L, 128);
	fixed('ne', noticeboard(), NOTICE_AT.cx, NOTICE_AT.zTop);
	fixed('ne', lampSign(false), LAMP_AT.cx, LAMP_AT.zTop);
	fixed('ne', plaque(ZONE_SIGNS.planRoom), 8.5 * L, PLAQUE_Z);
	fixed('ne', planBoard(), 8.5 * L, 124);
	fixed('ne', plaque(ZONE_SIGNS.production), 15 * L, PLAQUE_Z);
	fixed('ne', stencil(), STENCIL_AT.cx, STENCIL_AT.zTop, STENCIL_AT.scale);
	fixed('ne', plaque(ZONE_SIGNS.repair), 21.5 * L, PLAQUE_Z);
	fixed('ne', toolWall(), TOOL_WALL_AT.cx, TOOL_WALL_AT.zTop);
	fixed('nw', plaque(ZONE_SIGNS.palace), 10 * L, PLAQUE_Z);
	fixed('nw', groupPhoto(), PHOTO_AT.cy, PHOTO_AT.zTop);
	for (const y of [12.25 * L, 7.75 * L]) fixed('nw', banner(), y, 124);
	fixed('nw', plaque(ZONE_SIGNS.recruitment), 16.5 * L, PLAQUE_Z);
	art.push({ wall: 'nw', a0: GOODS_DOOR.y0, a1: GOODS_DOOR.y1, z0: 0, z1: GOODS_DOOR.h });
	// The posters go up last, the wall behind each kept, so furnishing can take them down.
	const posters: HomePoster[] = HOME_POSTERS.map(({ id, sign, spot }) => {
		const box = wallBox(base, sign(), spot, 2);
		const under = grab(base, box);
		hang(base, sign(), spot);
		return { id, spot, under, over: grab(base, box) };
	});
	// The goods doors, shut. The cockpit animates them open over this.
	const shut = goodsDoorStates(base, 2)[0];
	for (let j = 0; j < shut.h; j++) for (let i = 0; i < shut.w; i++) {
		const s = (j * shut.w + i) * 4;
		if (shut.rgba[s + 3]) base.rgba.set(shut.rgba.subarray(s, s + 4), ((shut.y + j) * base.w + shut.x + i) * 4);
	}

	// Zones: stations (in hand-out order, each with its facing) and idle spots
	const T = (x: number, y: number): V3 => [x * L, y * L, 0];
	const zones = {} as Record<ZoneId, Zone>;
	/**
	 * Register a zone.
	 *
	 * @param {ZoneId} id Zone.
	 * @param {[V3, Zone['stationFacing'][number]][]} stations Stations and facings.
	 * @param {V3[]} spots Idle spots.
	 */
	const zone = (id: ZoneId, stations: [V3, Zone['stationFacing'][number]][], spots: V3[]): void => {
		zones[id] = { id, label: LABELS[id], sign: ZONE_SIGNS[id], tiles: ZONE_TILES[id], stations: stations.map((s) => s[0]), stationFacing: stations.map((s) => s[1]), spots };
	};
	zone('directorate', [[[dc[0], 1.6 * L, 0], 'SW']], []);
	zone('planRoom', [[[8.5 * L - 20, 42, 0], 'NE'], [[tc[0], tc[1] - 22 - 25, 0], 'SW']], []);
	zone('production', [[[ANVIL[0] - 32, ANVIL[1], 0], 'SE'], ...spareX.map((x): [V3, 'NE'] => [[x, 70, 0], 'NE'])], []);
	zone('repair', [[[21.3 * L - 8, 70, 0], 'NE']], []);
	zone('hygiene', [[[hc[0] + 14 + 23, hc[1], 0], 'NW']], []);
	zone('inspectorate', [[[ic[0] - 15 - 25, ic[1], 0], 'SE']], []);
	// The audience stands back from the гардероб's counter.
	zone('palace', [], [4.4, 5.3, 6.2].flatMap((x) => [9, 10.25, 11.5].map((y) => T(x, y))));
	// Two sides of four standing tables, then the queue at the samovar.
	const canteenSpots: V3[] = [];
	for (const [cx, cy] of tables) for (const dy of [-33, 33]) for (const dx of [-90, -45, 0, 45, 90]) canteenSpots.push([cx + dx, cy + dy, 0]);
	canteenSpots.push([sc[0] - 38, sc[1] - 26, 0], [sc[0] - 38, sc[1] + 20, 0]);
	zone('canteen', [], canteenSpots);
	zone('recruitment', [], [T(2.5, 17.5), T(6.5, 17.5), T(3.5, 16.3), T(5.5, 16.3)]);
	// A tight huddle: four in the middle, eight round them.
	const huddle: V3[] = [];
	for (let k = 0; k < 4; k++) huddle.push([HUDDLE[0] + Math.cos(k * Math.PI / 2 + 0.4) * 20, HUDDLE[1] + Math.sin(k * Math.PI / 2 + 0.4) * 20, 0]);
	for (let k = 0; k < 8; k++) huddle.push([HUDDLE[0] + Math.cos(k * Math.PI / 4) * 44, HUDDLE[1] + Math.sin(k * Math.PI / 4) * 44, 0]);
	zone('siberia', [], huddle);

	const walkable = walkableFor(layers.map((p) => p.foot));

	const spawn = T(4.5, 17.6);
	const actor = zones.production.stations[0];
	const [hx, hy] = project(base, hutChimneyTop(hut));
	const [sx, sy] = project(base, [sc[0], sc[1] - 8, 63]);
	const [fx, fy] = project(base, [S0, 0, 60]);
	const scene: Scene = {
		base, props: layers, frame: flatten(base, layers), actor, actorDir: 'SE', workProps: ['anvil'], patrol: [],
		emitters: [{ kind: 'smoke', x: hx, y: hy }, { kind: 'smoke', x: sx, y: sy }, { kind: 'snow', x: fx, y: fy }],
	};
	const marks: World['marks'] = {
		desk: { pos: [kc[0] + 48, kc[1], 0], dir: 'NW' },
		dock: { pos: [DOCK_RAIL[0] + 22, DOCK_RAIL[1], 0], dir: 'NW' },
		bench: { pos: [16, 10 * L, 10], dir: 'SE' },
		benchStep: { pos: [72, 10 * L - 30, 0], dir: 'NW' },
		prosecutor: { pos: [100, 12.3 * L, 0], dir: 'NW' },
		waiting: { pos: [5.7 * L, 12.2 * L, 0], dir: 'NW' },
		// Facing the room while changing, so the joke can be seen; the attendant faces her counter.
		cloak: { pos: [CLOAK.x, CLOAK.spotY, 0], dir: 'S' },
		attendant: { pos: [CLOAK.x, CLOAK.attendantY, 0], dir: 'SW' },
	};
	const world: World = { scene, zones, grid: { w: WORLD_W, h: WORLD_H, walkable }, tile: L, spawn, marks, walls: { art, posters } };
	// Demo loop for the previewer: platform → anvil → Siberia → platform. It crosses most of
	// the plant, so it exercises doorways, partitions and the camera pan.
	const legs = [[spawn, zones.production.stations[0]], [zones.production.stations[0], HUDDLE], [HUDDLE, spawn]] as const;
	for (const [a, b] of legs) {
		const leg = findPath(world, a, b);
		if (!leg) throw new Error(`world layout: no path from ${a.join(',')} to ${b.join(',')}`);
		scene.patrol.push(...(scene.patrol.length ? leg.slice(1) : leg));
	}
	scene.patrol.pop();
	return world;
}
