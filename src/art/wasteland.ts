/**
 * The wasteland around the plant: a different waste ground on each side, blending into
 * one another, fading into haze at the edges so it seems to go on past the screen in every
 * direction.
 *
 *   top (behind the back walls)   industrial ruin: broken slabs, rubble; half-built flats, a crane, chimneys
 *   right (around Siberia)        bare winter steppe: snow, frozen grass; birches
 *   left (where the trains come)  waste yard: frozen mud, slag, ice; the railway runs on; slag heap, pylons, pipes, a tank
 *   bottom (in front)             cracked concrete apron with snow; nothing tall, so nothing hides the plant
 *
 * The ground is generated pixel by pixel from the plant's own tile coordinates, so it lines up with
 * the floor and its features run on across tiles. The landmarks are ray-marched props, like the
 * plant's. Everything is baked once, after the plant itself is on screen.
 */
import { PX, type Frame, TILE, fitBounds, project, render } from './render';
import { type Prim, type V3, box, cone, cylinder, hash, roundCone } from './sdf';
import { rgb } from './palette';

const L = TILE;

/** How far the ground runs past the plant's frame, in pixels, before it is all haze. */
export const WASTE_MARGIN = { x: 720, y: 520 };
/** What the wasteland reads of the plant's base frame: its size, anchor and view (plain data, so it can go to a worker). */
export type BaseFrame = Pick<Frame, 'w' | 'h' | 'ax' | 'ay' | 'view'>;

/** The haze the wasteland fades into; also the stage's background past it. */
export const HAZE = '#16181d';

/** The four kinds of waste ground. */
export type WasteKind = 'ruin' | 'steppe' | 'yard' | 'apron';

/** Where each kind sits, as a screen direction from the plant's middle (radians; y grows down). */
const DIRECTION: Record<WasteKind, number> = { ruin: -Math.PI / 2, steppe: 0, apron: Math.PI / 2, yard: Math.PI };
const KINDS: WasteKind[] = ['ruin', 'steppe', 'yard', 'apron'];

/**
 * Smooth value noise in [0, 1].
 *
 * @param x X.
 * @param y Y.
 * @param seed Seed.
 * @returns Noise.
 */
function vnoise(x: number, y: number, seed = 0): number {
	const xi = Math.floor(x), yi = Math.floor(y);
	const fx = x - xi, fy = y - yi;
	const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
	const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Three octaves of value noise in [0, 1].
 *
 * @param x X.
 * @param y Y.
 * @param seed Seed.
 * @returns Noise.
 */
function fbm(x: number, y: number, seed = 0): number {
	return (vnoise(x, y, seed) * 0.57 + vnoise(x * 2.1, y * 2.1, seed + 7) * 0.29 + vnoise(x * 4.3, y * 4.3, seed + 13) * 0.14);
}

/**
 * How much of each kind of ground a point is, from its screen direction from the plant's middle,
 * with the borders made to wander.
 *
 * @param dx Screen x from the plant's middle.
 * @param dy Screen y from the plant's middle.
 * @param X Tile x (for the wander).
 * @param Y Tile y.
 * @returns Weights summing to 1, in KINDS order.
 */
export function wasteWeights(dx: number, dy: number, X: number, Y: number): number[] {
	const a = Math.atan2(dy * 1.8, dx) + (fbm(X * 0.08, Y * 0.08, 91) - 0.5) * 1.1;
	// A high power keeps each kind to its side, with a narrow seam between neighbours.
	const w = KINDS.map((k) => Math.max(0, Math.cos(a - DIRECTION[k])) ** 10);
	const sum = w.reduce((s, v) => s + v, 0) || 1;
	return w.map((v) => v / sum);
}

/** Side of the square over which a point's direction weights and haze are taken as one (pixels). */
const COARSE = 8;

/**
 * A colour as numbers.
 *
 * @param hex Colour.
 * @returns [r, g, b].
 */
const c3 = (hex: string): [number, number, number] => rgb(hex) as [number, number, number];

// Dusk colours: the waste ground sits a step darker and colder than the lit plant, so the eye stays on the plant.
const SNOW = c3('#aeb8c4'), SNOW_SHADE = c3('#97a3b2'), SNOW_DEEP = c3('#bcc5cf');
const CONCRETE = c3('#5d6064'), CONCRETE_DARK = c3('#55585c'), SEAM = c3('#47494d'), CRACK = c3('#383a3e');
const MUD = c3('#3d3631'), MUD_DARK = c3('#342e2a'), SLAG = c3('#24221f'), ICE = c3('#6f8293'), ICE_SHINE = c3('#8c9fb0');
const GRASS = c3('#6f6a4a'), GRASS_DARK = c3('#5a563c'), RUBBLE = c3('#66625c'), DIRT = c3('#443c35');
const BALLAST = c3('#4b4743'), SLEEPER = c3('#30241a'), RAIL = c3('#8a9096');

/**
 * The colour of one point of waste ground of one kind.
 *
 * @param kind Kind.
 * @param X Tile x (fractional).
 * @param Y Tile y.
 * @param px Pixel x (for specks).
 * @param py Pixel y.
 * @param trackY The railway's tile y, or null where it does not run.
 * @returns Colour.
 */
function ground(kind: WasteKind, X: number, Y: number, px: number, py: number, trackY: number | null): [number, number, number] {
	const n = fbm(X * 0.35, Y * 0.35, 3);
	const speck = hash(px, py, 5);
	// The railway runs on out of the goods doors, through the yard and off into the distance.
	if (trackY !== null && kind === 'yard') {
		const d = Math.abs(Y - trackY);
		if (d < 0.62) {
			if (Math.abs(d - 0.36) < 0.05) return RAIL;
			if (d < 0.48 && ((X * 2) % 1 + 1) % 1 < 0.28) return SLEEPER;
			return speck > 0.5 ? BALLAST : MUD_DARK;
		}
	}
	switch (kind) {
		case 'steppe': {
			// Faint, broken wind ripples in the snow, and frozen grass where the snow is thin.
			const ripple = Math.sin(X * 2.3 + Y * 0.9 + n * 9) * vnoise(X * 0.7, Y * 0.7, 71);
			if (n < 0.33 && speck > 0.6 && hash(Math.floor(X * 7), Math.floor(Y * 7), 9) > 0.5) return speck > 0.85 ? GRASS_DARK : GRASS;
			return ripple > 0.62 ? SNOW_SHADE : n > 0.66 ? SNOW_DEEP : SNOW;
		}
		case 'yard': {
			const m = fbm(X * 1.1, Y * 1.1, 17);
			if (m > 0.72) return speck > 0.9 ? ICE_SHINE : ICE;
			if (n > 0.66) return speck > 0.85 ? MUD_DARK : SLAG;
			const sn = fbm(X * 1.2, Y * 1.2, 23);
			if (sn > 0.7) return SNOW;
			if (sn > 0.67) return SNOW_SHADE;
			return speck > 0.75 ? MUD_DARK : MUD;
		}
		case 'ruin': {
			// Big broken slabs; where one is missing, bare dirt and rubble.
			const sx = Math.floor(X / 2), sy = Math.floor(Y / 2);
			const gone = hash(sx, sy, 31) > 0.86;
			const sn = fbm(X * 1.0, Y * 1.0, 37);
			if (sn > 0.7) return SNOW;
			if (sn > 0.67) return SNOW_SHADE;
			if (gone) return speck > 0.9 ? RUBBLE : DIRT;
			const fx = ((X / 2) % 1 + 1) % 1, fy = ((Y / 2) % 1 + 1) % 1;
			if (fx < 0.025 || fy < 0.025) return SEAM;
			if (Math.abs(fbm(X * 0.9, Y * 0.9, 41) - 0.5) < 0.012) return CRACK;
			return speck > 0.96 ? RUBBLE : hash(sx, sy, 43) > 0.5 ? CONCRETE : CONCRETE_DARK;
		}
		case 'apron': {
			const sn = fbm(X * 1.0, Y * 1.0, 53);
			if (sn > 0.7) return SNOW;
			if (sn > 0.67) return SNOW_SHADE;
			const fx = (X % 1 + 1) % 1, fy = (Y % 1 + 1) % 1;
			if (fx < 0.03 || fy < 0.03) return SEAM;
			if (Math.abs(fbm(X * 0.7, Y * 0.7, 59) - 0.5) < 0.01) return CRACK;
			return n > 0.55 ? CONCRETE_DARK : CONCRETE;
		}
	}
}

/**
 * How far into the haze a pixel is, 0 (clear) to 1 (all haze), from its distance past the plant.
 *
 * @param dx Screen x from the plant's middle.
 * @param dy Screen y from the plant's middle.
 * @param half The plant frame's half size.
 * @returns Haze.
 */
export function hazeAt(dx: number, dy: number, half: { w: number; h: number }): number {
	const r = Math.hypot(dx / (half.w + WASTE_MARGIN.x), dy / (half.h + WASTE_MARGIN.y));
	const t = Math.min(1, Math.max(0, (r - 0.6) / 0.38));
	return t * t * (3 - 2 * t);
}

/** A baked rectangle of pixels in the plant base frame's pixel space (x, y can be negative). */
export interface WasteLayer {
	x: number;
	y: number;
	w: number;
	h: number;
	rgba: Uint8ClampedArray;
}

/**
 * Bake the waste ground around the plant, a band of rows at a time (so the page can keep drawing
 * between bands).
 *
 * @param base The plant's base frame.
 * @param trackY The railway's world y, which the yard's rails follow out of the goods doors.
 * @returns The layer (empty to start) and a function that fills the next band, true once done.
 */
export function wasteGround(base: BaseFrame, trackY: number): { layer: WasteLayer; next: (rows?: number) => boolean } {
	const x0 = -WASTE_MARGIN.x, y0 = -WASTE_MARGIN.y;
	const w = base.w + 2 * WASTE_MARGIN.x, h = base.h + 2 * WASTE_MARGIN.y;
	const layer: WasteLayer = { x: x0, y: y0, w, h, rgba: new Uint8ClampedArray(w * h * 4) };
	const half = { w: base.w / 2, h: base.h / 2 };
	const [hr, hg, hb] = c3(HAZE);
	// Screen pixel → floor tile: the inverse of project() on the z = 0 plane.
	const [ox, oy] = project(base, [0, 0, 0]);
	// One tile along x moves (+sxPer, +syPer) on screen and one along y (−sxPer, +syPer): read off the view, not assumed.
	const [lx, ly] = project(base, [L, 0, 0]);
	const sxPer = lx - ox, syPer = ly - oy;
	const tY = trackY / L;
	const cw = Math.ceil(w / COARSE), ch = Math.ceil(h / COARSE);
	const coarseRow = new Int32Array(cw * ch).fill(-1);
	const coarseHaze = new Float32Array(cw * ch);
	const coarseW = new Float32Array(cw * ch * 4);
	let row = 0;
	return {
		layer,
		next(rows = 64) {
			const end = Math.min(h, row + rows);
			for (; row < end; row++) {
				const py = row + y0;
				for (let col = 0; col < w; col++) {
					const px = col + x0;
					const k = (row * w + col) * 4;
					// Direction and haze change slowly: worked out once per COARSE square, they cost a fraction.
					const cx = Math.floor(col / COARSE), cy = Math.floor(row / COARSE);
					const ci = cy * cw + cx;
					if (coarseRow[ci] !== cy) {
						const mx = (cx + 0.5) * COARSE + x0 - half.w, my = (cy + 0.5) * COARSE + y0 - half.h;
						const mu = (mx + half.w - ox) / sxPer, mv = (my + half.h - oy) / syPer;
						coarseRow[ci] = cy;
						coarseHaze[ci] = hazeAt(mx, my, half);
						coarseW.set(wasteWeights(mx, my, (mu + mv) / 2, (mv - mu) / 2), ci * 4);
					}
					const haze = coarseHaze[ci];
					if (haze >= 0.999) { layer.rgba[k] = hr; layer.rgba[k + 1] = hg; layer.rgba[k + 2] = hb; layer.rgba[k + 3] = 255; continue; }
					const u = (px - ox) / sxPer, v = (py - oy) / syPer;
					const X = (u + v) / 2, Y = (v - u) / 2;
					const weights = coarseW.subarray(ci * 4, ci * 4 + 4);
					// Where two kinds meet, blotches of one run into the other: a noise threshold, so the seam is ragged ground.
					const blot = fbm(X * 1.6, Y * 1.6, 77);
					let pick = 0, acc = weights[0];
					while (acc < blot && pick < 3) acc += weights[++pick];
					const [r, g, b] = ground(KINDS[pick], X, Y, px, py, X < 0.2 ? tY : null);
					// A smooth blend into the haze: it changes over hundreds of pixels.
					layer.rgba[k] = r + (hr - r) * haze;
					layer.rgba[k + 1] = g + (hg - g) * haze;
					layer.rgba[k + 2] = b + (hb - b) * haze;
					layer.rgba[k + 3] = 255;
				}
			}
			return row >= h;
		},
	};
}

/**
 * Bark: white with black marks, the birch's own.
 *
 * @param lx Local x.
 * @param ly Local y.
 * @param lz Local z.
 * @returns Override.
 */
const birchBark = (lx: number, ly: number, lz: number) => (hash(Math.floor(lz / 5), Math.floor((lx + ly) / 3), 61) > 0.72 ? { mat: 'charcoal' as const } : null);

/**
 * Snow on whatever faces up.
 *
 * @param _x Local x.
 * @param _y Local y.
 * @param _z Local z.
 * @param _a Normal x.
 * @param _b Normal y.
 * @param nz Normal z.
 * @returns Override.
 */
const snowTop = (_x: number, _y: number, _z: number, _a: number, _b: number, nz: number) => (nz > 0.7 ? { mat: 'snow' as const } : null);

/**
 * A bare winter birch.
 *
 * @param p Primitives.
 * @param c Base.
 * @param s Size.
 * @param g Group.
 */
function addBirch(p: Prim[], c: V3, s: number, g: string): void {
	const top: V3 = [c[0], c[1], 78 * s];
	p.push(roundCone(c, top, 3.2 * s, 1.4 * s, 'medWhite', { group: g, pattern: birchBark }));
	for (let k = 0; k < 5; k++) {
		const a = k * 1.3 + hash(c[0], c[1], k) * 0.8;
		const z = (34 + k * 9) * s;
		const reach = (20 - k * 2) * s;
		p.push(roundCone([c[0], c[1], z], [c[0] + Math.cos(a) * reach, c[1] + Math.sin(a) * reach, z + 16 * s], 1.3 * s, 0.6 * s, 'charcoal', { group: g }));
	}
}

/**
 * A pylon: four tapering legs, cross-bracing, and two cross-arms.
 *
 * @param p Primitives.
 * @param c Base centre.
 * @param hgt Height.
 * @param g Group.
 */
function addPylon(p: Prim[], c: V3, hgt: number, g: string): void {
	const foot = 16, head = 4;
	/**
	 * A point on one of the four legs.
	 *
	 * @param sx Which side along x (±1).
	 * @param sy Which side along y (±1).
	 * @param z Height.
	 * @param r How far out from the middle.
	 * @returns World point.
	 */
	const at = (sx: number, sy: number, z: number, r: number): V3 => [c[0] + sx * r, c[1] + sy * r, z];
	for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) p.push(roundCone(at(sx, sy, 0, foot), at(sx, sy, hgt, head), 1.6, 1.1, 'steel', { group: g }));
	for (let z = 30; z < hgt - 20; z += 38) {
		const r = foot + (head - foot) * (z / hgt);
		p.push(roundCone(at(1, 1, z, r), at(-1, -1, z + 30, r * 0.9), 0.9, 0.9, 'steel', { group: g }));
		p.push(roundCone(at(1, -1, z, r), at(-1, 1, z + 30, r * 0.9), 0.9, 0.9, 'steel', { group: g }));
	}
	for (const z of [hgt * 0.78, hgt * 0.92]) p.push(roundCone([c[0] - 34, c[1] + 34, z], [c[0] + 34, c[1] - 34, z], 1.5, 1.5, 'steel', { group: g }));
}

/**
 * A half-built block of flats: four finished floors, a fifth only begun, rebar sticking up, and
 * dark holes where windows will go.
 *
 * @param p Primitives.
 * @param c Centre of the footprint.
 * @param g Group.
 */
function addFlats(p: Prim[], c: V3, g: string): void {
	const hx = 120, hy = 34, floor = 46;
	/**
	 * Dark holes for windows, a bay at a time on each floor, and a line between floors.
	 *
	 * @param lx Local x.
	 * @param ly Local y.
	 * @param lz Local z.
	 * @returns Override.
	 */
	const windows = (lx: number, ly: number, lz: number) => {
		const along = Math.abs(lx) > hx - 1 ? ly : lx;
		const inFloor = ((lz + 4 * floor) % floor + floor) % floor;
		const inBay = ((along + 400) % 26 + 26) % 26;
		return inFloor > 14 && inFloor < 34 && inBay > 7 && inBay < 19 ? { mat: 'charcoal' as const } : inFloor < 2 ? { shift: -1 } : null;
	};
	p.push(box([c[0], c[1], 2 * floor], [hx, hy, 2 * floor], 0.5, 'concrete', { group: g, pattern: windows }));
	// The unfinished floor: a slab, a stretch of wall, and bars.
	p.push(box([c[0] - 40, c[1], 4 * floor + 3], [hx - 40, hy, 3], 0.4, 'concrete', { group: g, pattern: snowTop }));
	p.push(box([c[0] - 70, c[1] + hy - 3, 4 * floor + 22], [50, 3, 18], 0.4, 'concrete', { group: g, pattern: windows }));
	for (let k = 0; k < 7; k++) p.push(roundCone([c[0] + 10 + k * 16, c[1] + hy - 2, 4 * floor + 4], [c[0] + 12 + k * 16, c[1] + hy - 1, 4 * floor + 26], 0.8, 0.6, 'rust', { group: g }));
}

/**
 * A tower crane, its jib swung along x, a cab at the top of the mast.
 *
 * @param p Primitives.
 * @param c Mast base.
 * @param g Group.
 */
function addCrane(p: Prim[], c: V3, g: string): void {
	const hgt = 330;
	/**
	 * Crossed dark lines, standing in for open lattice.
	 *
	 * @param lx Local x.
	 * @param ly Local y.
	 * @param lz Local z.
	 * @returns Override.
	 */
	const lattice = (lx: number, ly: number, lz: number) => (((lz + lx + ly) % 14 + 14) % 14 < 2.5 || ((lz - lx - ly) % 14 + 14) % 14 < 2.5 ? { shift: -2 } : null);
	p.push(box([c[0], c[1], hgt / 2], [6, 6, hgt / 2], 0.3, 'mustard', { group: g, pattern: lattice }));
	p.push(box([c[0] + 70, c[1], hgt + 6], [120, 4, 4], 0.3, 'mustard', { group: g, pattern: lattice }));
	p.push(box([c[0] - 30, c[1], hgt + 6], [26, 4, 4], 0.3, 'mustard', { group: g }));
	p.push(box([c[0] - 46, c[1], hgt - 4], [10, 7, 9], 0.4, 'concrete', { group: g }));
	p.push(box([c[0] + 9, c[1] + 8, hgt - 12], [7, 6, 8], 0.4, 'mustard', { group: g, pattern: (lx: number) => (lx > 5 ? { mat: 'ice' as const } : null) }));
	p.push(cone([c[0], c[1], hgt + 22], 12, 4, 1, 'mustard', { group: g }));
	p.push(roundCone([c[0], c[1], hgt + 34], [c[0] + 180, c[1], hgt + 10], 0.5, 0.5, 'charcoal', { group: g }));
	p.push(roundCone([c[0] + 150, c[1], hgt + 2], [c[0] + 150, c[1], hgt - 90], 0.5, 0.5, 'charcoal', { group: g }));
	p.push(box([c[0] + 150, c[1], hgt - 94], [4, 4, 4], 0.4, 'iron', { group: g }));
}

/**
 * A factory chimney: brick, red and white bands near the top.
 *
 * @param p Primitives.
 * @param c Base.
 * @param hgt Height.
 * @param g Group.
 */
function addChimney(p: Prim[], c: V3, hgt: number, g: string): void {
	/**
	 * Red and white bands near the top.
	 *
	 * @param _lx Local x.
	 * @param _ly Local y.
	 * @param lz Local z.
	 * @returns Override.
	 */
	const bands = (_lx: number, _ly: number, lz: number) => (lz > hgt / 2 - 70 ? (Math.floor((lz - hgt / 2 + 70) / 14) % 2 ? { mat: 'medWhite' as const } : { mat: 'red' as const }) : null);
	p.push(cone([c[0], c[1], hgt / 2], hgt / 2, 17, 11, 'brick', { group: g, pattern: bands }));
}

/**
 * A slag heap, its top dusted with snow.
 *
 * @param p Primitives.
 * @param c Base centre.
 * @param g Group.
 */
function addSlagHeap(p: Prim[], c: V3, g: string): void {
	p.push(cone([c[0], c[1], 36], 36, 78, 14, 'coal', { group: g, pattern: snowTop }));
	p.push(cone([c[0] + 50, c[1] - 30, 20], 20, 44, 8, 'coal', { group: g, pattern: snowTop }));
}

/**
 * A run of rusted pipe on concrete trestles.
 *
 * @param p Primitives.
 * @param a One end.
 * @param b The other.
 * @param g Group.
 */
function addPipe(p: Prim[], a: V3, b: V3, g: string): void {
	p.push(roundCone([a[0], a[1], 18], [b[0], b[1], 18], 6, 6, 'rust', { group: g, pattern: snowTop }));
	for (let t = 0.1; t < 1; t += 0.4) {
		const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
		p.push(box([x, y, 6], [4, 6, 6], 0.3, 'concrete', { group: g }));
	}
}

/**
 * A rusted storage tank.
 *
 * @param p Primitives.
 * @param c Base.
 * @param g Group.
 */
function addTank(p: Prim[], c: V3, g: string): void {
	/**
	 * Snow on the lid, and a dark seam every few plates down the side.
	 *
	 * @param _x Local x.
	 * @param _y Local y.
	 * @param lz Local z.
	 * @param _a Normal x.
	 * @param _b Normal y.
	 * @param nz Normal z.
	 * @returns Override.
	 */
	const plates = (_x: number, _y: number, lz: number, _a: number, _b: number, nz: number) => (nz > 0.7 ? { mat: 'snow' as const } : (((lz + 60) % 12) < 1 * PX + 0.6 ? { shift: -1 } : null));
	p.push(cylinder([c[0], c[1], 30], 34, 30, 2, 'rust', { group: g, pattern: plates }));
}

/**
 * A broken concrete slab lying flat, or tilted against another.
 *
 * @param p Primitives.
 * @param c Centre.
 * @param g Group.
 */
function addSlab(p: Prim[], c: V3, g: string): void {
	p.push(box([c[0], c[1], 4], [28, 18, 4], 0.6, 'concrete', { group: g, pattern: snowTop }));
}

/**
 * Landmarks in painting order: the further one stands (the smaller its x + y), the earlier it is
 * drawn, so nearer ones paint over it.
 *
 * @param marks Landmarks.
 * @returns A sorted copy.
 */
export function farthestFirst(marks: Landmark[]): Landmark[] {
	const depth = (m: Landmark): number => m.prims[0].origin[0] + m.prims[0].origin[1];
	return [...marks].sort((a, b) => depth(a) - depth(b));
}

/** One landmark, as primitives at their place in the world. */
export interface Landmark {
	id: string;
	kind: WasteKind;
	prims: Prim[];
}

/**
 * Every landmark, placed in tiles around the plant (the main hall is 0–24 × 0–20, Siberia 24–32 × 0–10).
 *
 * @returns Landmarks.
 */
export function wasteLandmarks(): Landmark[] {
	const out: Landmark[] = [];
	/**
	 * Add one landmark.
	 *
	 * @param id Id.
	 * @param kind Its side.
	 * @param build Fills its primitives.
	 */
	const put = (id: string, kind: WasteKind, build: (p: Prim[]) => void): void => { const prims: Prim[] = []; build(prims); out.push({ id, kind, prims }); };
	/**
	 * A point on the ground, in tiles.
	 *
	 * @param tx Tile x.
	 * @param ty Tile y.
	 * @returns World point.
	 */
	const at = (tx: number, ty: number): V3 => [tx * L, ty * L, 0];
	// Behind the back walls: far enough out to stand above them.
	put('flats', 'ruin', (p) => addFlats(p, at(-15, -5), 'flats'));
	put('crane', 'ruin', (p) => addCrane(p, at(-3, -11), 'crane'));
	put('chimney-a', 'ruin', (p) => addChimney(p, at(8, -21), 300, 'chimney'));
	put('chimney-b', 'ruin', (p) => addChimney(p, at(13, -23), 250, 'chimney'));
	put('flats-far', 'ruin', (p) => addFlats(p, at(20, -17), 'flats2'));
	// Around Siberia: birches in the snow.
	const birches: [number, number, number][] = [[37, 3, 1], [38.5, 5, 0.9], [40, 2.5, 1.1], [43, 7, 1], [36, 13, 0.95], [37.5, 15, 1.05], [44, 13, 0.9], [47, 4, 1], [34, 17, 1]];
	birches.forEach(([x, y, s], k) => put(`birch-${k}`, 'steppe', (p) => addBirch(p, at(x, y), s, `birch${k}`)));
	// The yard, off the left wall: slag, pipes, a tank, pylons marching away.
	put('slag', 'yard', (p) => addSlagHeap(p, at(-9, 25), 'slag'));
	put('pipe', 'yard', (p) => addPipe(p, at(2, 25), at(-6, 31), 'pipe'));
	put('tank', 'yard', (p) => addTank(p, at(-15, 22), 'tank'));
	put('pylon-a', 'yard', (p) => addPylon(p, at(-2, 25), 230, 'pylon'));
	put('pylon-b', 'yard', (p) => addPylon(p, at(-12, 29), 230, 'pylon2'));
	// In front: only flat things.
	for (const [k, [x, y]] of [[10, 27], [19, 25], [27, 21]].entries()) put(`slab-${k}`, 'apron', (p) => addSlab(p, at(x, y), `slab${k}`));
	return out;
}

/** A landmark rendered, placed in the plant base frame's pixel space. */
export interface LandmarkSprite {
	id: string;
	sprite: Frame;
	x: number;
	y: number;
}

/**
 * Render one landmark, hazed by its distance like the ground under it.
 *
 * @param base The plant's base frame.
 * @param m Landmark.
 * @returns The sprite and where it goes.
 */
export function renderLandmark(base: BaseFrame, m: Landmark): LandmarkSprite {
	const fit = fitBounds(m.prims, base.view, 3);
	const sprite = render(m.prims, { ...fit, view: base.view });
	const x = base.ax - fit.ax, y = base.ay - fit.ay;
	const half = { w: base.w / 2, h: base.h / 2 };
	const [hr, hg, hb] = c3(HAZE);
	for (let j = 0; j < sprite.h; j++) for (let i = 0; i < sprite.w; i++) {
		const k = (j * sprite.w + i) * 4;
		if (!sprite.rgba[k + 3]) continue;
		const q = hazeAt(x + i - half.w, y + j - half.h, half);
		sprite.rgba[k] += (hr - sprite.rgba[k]) * q;
		sprite.rgba[k + 1] += (hg - sprite.rgba[k + 1]) * q;
		sprite.rgba[k + 2] += (hb - sprite.rgba[k + 2]) * q;
	}
	return { id: m.id, sprite, x, y };
}
