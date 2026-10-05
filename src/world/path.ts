/**
 * Pathfinding over the world's tile grid: A* with 8-connected moves, no corner cutting and an
 * octile heuristic. Tile walkability alone is not enough: two walkable tiles can sit either
 * side of a thin partition, so every move is also swept against the props' footprints,
 * grown by the comrade's radius. A path therefore never lets a comrade's footprint overlap a prop.
 */
import { ACTOR_RADIUS, type Footprint } from '../art/scene';
import type { V3 } from '../art/sdf';
import type { World } from './types';

/**
 * Whether a comrade standing at (x, y) keeps ACTOR_RADIUS clear of a footprint. Touching
 * counts as clear, matching the rule tests/scene.test.ts applies to patrols.
 *
 * @param {number} x World x.
 * @param {number} y World y.
 * @param {Footprint} f Footprint.
 * @returns {boolean} Clear.
 */
export function clearOf(x: number, y: number, f: Footprint): boolean {
	const r = ACTOR_RADIUS;
	return x + r <= f.x0 || x - r >= f.x1 || y + r <= f.y0 || y - r >= f.y1;
}

/**
 * Whether a straight walk from a to b keeps ACTOR_RADIUS clear of every footprint.
 * Exact slab test of the segment against each footprint grown by the radius, open on
 * all sides so grazing an edge is allowed (as clearOf allows touching).
 *
 * @param {V3} a Start.
 * @param {V3} b End.
 * @param {Footprint[]} feet Obstacles.
 * @returns {boolean} Clear.
 */
export function segmentClear(a: V3, b: V3, feet: Footprint[]): boolean {
	const r = ACTOR_RADIUS;
	const dx = b[0] - a[0], dy = b[1] - a[1];
	for (const f of feet) {
		let t0 = 0, t1 = 1;
		let hit = true;
		for (const [o, d, lo, hi] of [[a[0], dx, f.x0 - r, f.x1 + r], [a[1], dy, f.y0 - r, f.y1 + r]]) {
			if (Math.abs(d) < 1e-9) {
				// Moving parallel to this slab: inside only if strictly between its planes.
				if (o <= lo || o >= hi) { hit = false; break; }
				continue;
			}
			let ta = (lo - o) / d, tb = (hi - o) / d;
			if (ta > tb) { const t = ta; ta = tb; tb = t; }
			t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
			// Strict: an interval of zero length is a graze along a face, not an overlap.
			if (t0 >= t1) { hit = false; break; }
		}
		if (hit) return false;
	}
	return true;
}

/**
 * Centre of a tile in world units.
 *
 * @param {World} w World.
 * @param {number} tx Tile x.
 * @param {number} ty Tile y.
 * @returns {V3} Centre on the floor.
 */
export function tileCentre(w: World, tx: number, ty: number): V3 {
	return [(tx + 0.5) * w.tile, (ty + 0.5) * w.tile, 0];
}

/**
 * Whether a tile is inside the grid and walkable.
 *
 * @param {World} w World.
 * @param {number} tx Tile x.
 * @param {number} ty Tile y.
 * @returns {boolean} Walkable.
 */
export function isWalkable(w: World, tx: number, ty: number): boolean {
	const { w: gw, h: gh, walkable } = w.grid;
	return tx >= 0 && ty >= 0 && tx < gw && ty < gh && walkable[ty * gw + tx] === 1;
}

/**
 * The tile a world point falls in.
 *
 * @param {World} w World.
 * @param {V3} p Point.
 * @returns {[number, number]} Tile x and y (may be outside the grid).
 */
export function tileOf(w: World, p: V3): [number, number] {
	return [Math.floor(p[0] / w.tile), Math.floor(p[1] / w.tile)];
}

/** Where a path end attaches to the grid. */
interface Anchor {
	tx: number;
	ty: number;
	/** The exact point can stand clear and walk straight to its tile's centre, so the path keeps it. */
	keep: boolean;
}

/**
 * Snap a point to the grid: its own tile if it can stand there and walk to the centre,
 * otherwise the walkable tile whose centre is nearest.
 *
 * @param {World} w World.
 * @param {V3} p Point.
 * @param {Footprint[]} feet Prop footprints.
 * @returns {Anchor | null} Anchor, or null if nothing in the world is walkable.
 */
function anchor(w: World, p: V3, feet: Footprint[]): Anchor | null {
	const [tx, ty] = tileOf(w, p);
	if (isWalkable(w, tx, ty) && feet.every((f) => clearOf(p[0], p[1], f)) && segmentClear(p, tileCentre(w, tx, ty), feet)) return { tx, ty, keep: true };
	let best: Anchor | null = null, bd = Infinity;
	for (let y = 0; y < w.grid.h; y++) for (let x = 0; x < w.grid.w; x++) {
		if (!isWalkable(w, x, y)) continue;
		const c = tileCentre(w, x, y);
		const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
		if (d < bd) { bd = d; best = { tx: x, ty: y, keep: false }; }
	}
	return best;
}

/** The eight moves: dx, dy, cost. */
const MOVES: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/**
 * Octile distance between tiles, the exact cost of an unobstructed 8-connected walk.
 *
 * @param {number} ax From x.
 * @param {number} ay From y.
 * @param {number} bx To x.
 * @param {number} by To y.
 * @returns {number} Distance in tiles.
 */
function octile(ax: number, ay: number, bx: number, by: number): number {
	const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
	return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * Drop waypoints that lie on the straight line between their neighbours. Only removes
 * points strictly between two others on the same line, so the walked route is unchanged.
 *
 * @param {V3[]} pts Waypoints.
 * @returns {V3[]} Simplified waypoints.
 */
export function simplify(pts: V3[]): V3[] {
	const out: V3[] = [];
	for (const p of pts) {
		const last = out[out.length - 1];
		if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-6) continue;
		if (out.length >= 2) {
			const a = out[out.length - 2], b = last;
			const cross = (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]);
			const dot = (b[0] - a[0]) * (p[0] - b[0]) + (b[1] - a[1]) * (p[1] - b[1]);
			if (Math.abs(cross) < 1e-6 && dot > 0) out.pop();
		}
		out.push(p);
	}
	return out;
}

/**
 * Find a walking route between two points.
 *
 * Each end is snapped to the grid: a point that can stand clear on a walkable tile and walk
 * straight to its centre is kept as the first or last waypoint; otherwise (inside a prop, off
 * the floor) the route starts or ends at the nearest walkable tile's centre instead.
 *
 * @param {World} world World.
 * @param {V3} from Start, feet in world units.
 * @param {V3} to Goal, feet in world units.
 * @returns {V3[] | null} World-space waypoints with collinear points removed, or null when unreachable.
 */
export function findPath(world: World, from: V3, to: V3): V3[] | null {
	const feet = world.scene.props.map((p) => p.foot);
	const a = anchor(world, from, feet), b = anchor(world, to, feet);
	if (!a || !b) return null;
	const start: V3 = [from[0], from[1], 0], goal: V3 = [to[0], to[1], 0];
	if (a.tx === b.tx && a.ty === b.ty) {
		if (a.keep && b.keep && segmentClear(start, goal, feet)) return simplify([start, goal]);
		return simplify([...(a.keep ? [start] : []), tileCentre(world, a.tx, a.ty), ...(b.keep ? [goal] : [])]);
	}

	const W = world.grid.w, n = W * world.grid.h;
	const g = new Float64Array(n).fill(Infinity);
	const came = new Int32Array(n).fill(-1);
	const closed = new Uint8Array(n);
	const s = a.ty * W + a.tx, e = b.ty * W + b.tx;
	g[s] = 0;
	// Binary heap of [f, node].
	const heap: [number, number][] = [[octile(a.tx, a.ty, b.tx, b.ty), s]];
	/** Push onto the heap. */
	const push = (item: [number, number]): void => {
		heap.push(item);
		let i = heap.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (heap[p][0] <= heap[i][0]) break;
			[heap[p], heap[i]] = [heap[i], heap[p]];
			i = p;
		}
	};
	/** Pop the lowest f from the heap. */
	const pop = (): [number, number] => {
		const top = heap[0], last = heap.pop()!;
		if (heap.length) {
			heap[0] = last;
			let i = 0;
			for (;;) {
				const l = i * 2 + 1, r = l + 1;
				let m = i;
				if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
				if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
				if (m === i) break;
				[heap[m], heap[i]] = [heap[i], heap[m]];
				i = m;
			}
		}
		return top;
	};

	while (heap.length) {
		const [, cur] = pop();
		if (closed[cur]) continue;
		if (cur === e) break;
		closed[cur] = 1;
		const cx = cur % W, cy = (cur - cx) / W;
		const cc = tileCentre(world, cx, cy);
		for (const [dx, dy, cost] of MOVES) {
			const nx = cx + dx, ny = cy + dy;
			if (!isWalkable(world, nx, ny)) continue;
			// No corner cutting: a diagonal needs both tiles it squeezes between.
			if (dx && dy && (!isWalkable(world, cx + dx, cy) || !isWalkable(world, cx, cy + dy))) continue;
			const ni = ny * W + nx;
			if (closed[ni]) continue;
			const ng = g[cur] + cost;
			if (ng >= g[ni]) continue;
			if (!segmentClear(cc, tileCentre(world, nx, ny), feet)) continue;
			g[ni] = ng;
			came[ni] = cur;
			push([ng + octile(nx, ny, b.tx, b.ty), ni]);
		}
	}
	if (g[e] === Infinity) return null;

	const tiles: V3[] = [];
	for (let k = e; k >= 0; k = came[k]) tiles.push(tileCentre(world, k % W, Math.floor(k / W)));
	tiles.reverse();
	return simplify([...(a.keep ? [start] : []), ...tiles, ...(b.keep ? [goal] : [])]);
}
