/**
 * Pixel rasteriser: orthographic ray-march at exactly one ray per output pixel, then the
 * passes that make it read as pixel art instead of a 3D render: quantised tone ramps,
 * outlines around every part and a floor shadow.
 */

import { MATERIALS, type MaterialName, rgb } from './palette';
import { type Prim, type V3, dot, rotZ, scale, add } from './sdf';

/** Camera basis for 2:1 dimetric projection (yaw 45°, pitch 30°), matching Habbo's grid. */
export interface View {
	R: V3;
	U: V3;
	F: V3;
	L: V3;
	/** Pixels per world unit. Higher means more pixels, and so more detail, on every object. */
	res: number;
}

/**
 * Global pixel density. 1 matches Habbo's scale: a comrade about 62px tall on a 64×32 tile,
 * so screenshots compare like for like. 1.5 was tried and rejected: the extra detail came
 * from comrades being bigger than Habbo's, not better drawn, and every room grew 1.5×.
 */
export const RES = 1;

const S2 = Math.SQRT1_2;
const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;
const R0: V3 = [S2, -S2, 0];
const U0: V3 = [-S30 * S2, -S30 * S2, C30];
const F0: V3 = [-C30 * S2, -C30 * S2, -S30];

/** One iso tile edge in world units. Tile corners land on whole pixels (64×32 at res 1, 96×48 at res 1.5). */
export const TILE = 32 * Math.SQRT2;

/** One screen pixel in world units, for surface patterns that must draw exactly 1px lines. */
export const PX = 1 / RES;

/**
 * Build the view basis for a model rotated by `yawDeg`. Rotating the camera the other way
 * is cheaper than rotating every primitive, and the light turns with it so shading stays
 * fixed in screen space (top-left, like Habbo).
 *
 * @param {number} yawDeg Model facing in degrees (0 = +x, screen south-east).
 * @param {number} res Pixels per world unit.
 * @returns {View} View basis in model space.
 */
export function makeView(yawDeg = 0, res = RES): View {
	const a = (-yawDeg * Math.PI) / 180;
	const R = rotZ(R0, a), U = rotZ(U0, a), F = rotZ(F0, a);
	const l = add(add(scale(R, -0.55), scale(U, 0.7)), scale(F, -0.45));
	const ll = Math.sqrt(dot(l, l));
	return { R, U, F, L: scale(l, 1 / ll), res };
}

export interface Frame {
	w: number;
	h: number;
	/** Pixel of the model origin (feet / world 0,0,0). */
	ax: number;
	ay: number;
	rgba: Uint8ClampedArray;
	depth: Float32Array;
	/** Group index per pixel, -1 = empty. */
	group: Int16Array;
	groups: string[];
	view: View;
}

export interface RenderOpts {
	w: number;
	h: number;
	ax: number;
	ay: number;
	view: View;
	/** Radius of the round floor shadow under the origin, or 0 for none. */
	shadow?: number;
	/** Skip external outlines against empty space (backgrounds want a clean edge). */
	noExternalOutline?: boolean;
}

export const FAR = 2000;
const HIT = 0.04;
const MAX_STEPS = 110;

/**
 * Project a model-space point to pixel coordinates and depth.
 *
 * @param {Frame | RenderOpts} f Frame or render options with anchor and view.
 * @param {V3} p Point.
 * @returns {[number, number, number]} Pixel x, pixel y, depth along the view ray.
 */
export function project(f: { ax: number; ay: number; view: View }, p: V3): [number, number, number] {
	return [dot(p, f.view.R) * f.view.res + f.ax, -dot(p, f.view.U) * f.view.res + f.ay, dot(p, f.view.F) + FAR];
}

/**
 * Compute a canvas size and anchor that fits every primitive.
 *
 * @param {Prim[]} prims Primitives.
 * @param {View} view View basis.
 * @param {number} pad Pixel padding.
 * @returns {{w: number, h: number, ax: number, ay: number}} Size and anchor.
 */
export function fitBounds(prims: Prim[], view: View, pad = 2): { w: number; h: number; ax: number; ay: number } {
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (const p of prims) {
		for (let k = 0; k < 8; k++) {
			const c: V3 = [k & 1 ? p.max[0] : p.min[0], k & 2 ? p.max[1] : p.min[1], k & 4 ? p.max[2] : p.min[2]];
			const [sx, sy] = project({ ax: 0, ay: 0, view }, c);
			x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
		}
	}
	const ax = Math.ceil(-x0) + pad, ay = Math.ceil(-y0) + pad;
	return { w: Math.ceil(x1 - x0) + pad * 2 + 1, h: Math.ceil(y1 - y0) + pad * 2 + 1, ax, ay };
}

/**
 * Rasterise primitives into a pixel-art frame.
 *
 * @param {Prim[]} prims Primitives in model space.
 * @param {RenderOpts} o Canvas size, anchor, view and options.
 * @returns {Frame} Rendered frame with depth and group buffers for decals.
 */
export function render(prims: Prim[], o: RenderOpts): Frame {
	const { w, h, ax, ay, view } = o;
	const { R, U, F, L, res } = view;
	const n = w * h;
	const rgba = new Uint8ClampedArray(n * 4);
	const depth = new Float32Array(n).fill(Infinity);
	const group = new Int16Array(n).fill(-1);
	const matIdx = new Int16Array(n).fill(-1);
	const groups: string[] = [];
	const mats: MaterialName[] = [];
	const gIndex = (g: string): number => {
		let i = groups.indexOf(g);
		if (i < 0) { i = groups.length; groups.push(g); }
		return i;
	};
	const mIndex = (m: MaterialName): number => {
		let i = mats.indexOf(m);
		if (i < 0) { i = mats.length; mats.push(m); }
		return i;
	};

	// Screen-space bounding boxes let each pixel test only the primitives that can cover it.
	const sb = prims.map((p) => {
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (let k = 0; k < 8; k++) {
			const c: V3 = [k & 1 ? p.max[0] : p.min[0], k & 2 ? p.max[1] : p.min[1], k & 4 ? p.max[2] : p.min[2]];
			const sx = dot(c, R) * res + ax, sy = -dot(c, U) * res + ay;
			x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
		}
		return [x0 - 1, y0 - 1, x1 + 1, y1 + 1];
	});

	const cand: Prim[] = [];
	const oo = [0, 0, 0];
	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			cand.length = 0;
			for (let k = 0; k < prims.length; k++) {
				const b = sb[k];
				if (i >= b[0] && i <= b[2] && j >= b[1] && j <= b[3]) cand.push(prims[k]);
			}
			if (!cand.length) continue;
			const sx = (i - ax) / res, sy = (j - ay) / res;
			const ox = sx * R[0] - sy * U[0] - FAR * F[0];
			const oy = sx * R[1] - sy * U[1] - FAR * F[1];
			const oz = sx * R[2] - sy * U[2] - FAR * F[2];

			// Union of candidate AABB slabs bounds the march.
			let tmin = Infinity, tmax = -Infinity;
			oo[0] = ox; oo[1] = oy; oo[2] = oz;
			for (const p of cand) {
				let t0 = -Infinity, t1 = Infinity;
				let miss = false;
				for (let a = 0; a < 3; a++) {
					const d = F[a];
					if (Math.abs(d) < 1e-9) {
						if (oo[a] < p.min[a] || oo[a] > p.max[a]) { miss = true; break; }
						continue;
					}
					let ta = (p.min[a] - oo[a]) / d, tb = (p.max[a] - oo[a]) / d;
					if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
					t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
				}
				if (miss || t0 > t1) continue;
				tmin = Math.min(tmin, t0); tmax = Math.max(tmax, t1);
			}
			if (tmin === Infinity) continue;

			let t = tmin - 0.5;
			let hit: Prim | null = null;
			for (let s = 0; s < MAX_STEPS && t <= tmax + 0.5; s++) {
				const px = ox + F[0] * t, py = oy + F[1] * t, pz = oz + F[2] * t;
				let d = Infinity, best: Prim | null = null;
				for (const p of cand) {
					const v = p.sdf(px, py, pz);
					if (v < d) { d = v; best = p; }
				}
				if (d < HIT) { hit = best; break; }
				t += Math.max(d * 0.85, 0.05);
			}
			if (!hit) continue;

			const px = ox + F[0] * t, py = oy + F[1] * t, pz = oz + F[2] * t;
			const e = 0.3;
			const sd = (x: number, y: number, z: number): number => {
				let d = Infinity;
				for (const p of cand) d = Math.min(d, p.sdf(x, y, z));
				return d;
			};
			let nx = sd(px + e, py, pz) - sd(px - e, py, pz);
			let ny = sd(px, py + e, pz) - sd(px, py - e, pz);
			let nz = sd(px, py, pz + e) - sd(px, py, pz - e);
			const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
			nx /= nl; ny /= nl; nz /= nl;

			let mat = hit.mat;
			let shift = 0;
			if (hit.pattern) {
				const po = hit.pattern(px - hit.origin[0], py - hit.origin[1], pz - hit.origin[2], nx, ny, nz);
				if (po) { if (po.mat) mat = po.mat; if (po.shift) shift = po.shift; }
			}
			const M = MATERIALS[mat];
			const v = nx * L[0] + ny * L[1] + nz * L[2];
			let tone = v < 0.12 ? 0 : v < 0.52 ? 1 : v < 0.86 ? 2 : 3;
			if (tone === 3 && !M.highlight) tone = 2;
			tone = Math.max(0, Math.min(3, tone + shift));
			const [r, g, b] = rgb(M.tones[tone]);
			const idx = j * w + i;
			rgba[idx * 4] = r; rgba[idx * 4 + 1] = g; rgba[idx * 4 + 2] = b; rgba[idx * 4 + 3] = 255;
			depth[idx] = t;
			group[idx] = gIndex(hit.group);
			matIdx[idx] = mIndex(mat);
		}
	}

	// Inner outlines: where a nearer part overlaps a different part, the far pixel takes the
	// near part's outline colour. This is what separates arm from torso, cap from head.
	const paint: [number, string][] = [];
	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			const idx = j * w + i;
			if (group[idx] < 0) continue;
			const nb = [i > 0 ? idx - 1 : -1, i < w - 1 ? idx + 1 : -1, j > 0 ? idx - w : -1, j < h - 1 ? idx + w : -1];
			for (const q of nb) {
				if (q < 0 || group[q] < 0 || group[q] === group[idx]) continue;
				if (depth[idx] - depth[q] > 2.2) { paint.push([idx, MATERIALS[mats[matIdx[q]]].outline]); break; }
			}
		}
	}

	// Outer outline: empty pixels touching the silhouette take the nearest neighbour's outline.
	if (!o.noExternalOutline) {
		for (let j = 0; j < h; j++) {
			for (let i = 0; i < w; i++) {
				const idx = j * w + i;
				if (group[idx] >= 0) continue;
				let best = -1, bd = Infinity;
				const nb = [i > 0 ? idx - 1 : -1, i < w - 1 ? idx + 1 : -1, j > 0 ? idx - w : -1, j < h - 1 ? idx + w : -1];
				for (const q of nb) if (q >= 0 && group[q] >= 0 && depth[q] < bd) { bd = depth[q]; best = q; }
				if (best < 0) continue;
				// Selective outline: edges facing the top-left light get the material's own shadow
				// tone instead of the hard outline, which softens the silhouette the way hand-drawn
				// sprites do. The shadowed bottom-right edges keep the dark line.
				const M = MATERIALS[mats[matIdx[best]]];
				const lit = best === idx + 1 || best === idx + w;
				paint.push([idx, lit ? M.tones[0] : M.outline]);
			}
		}
	}
	for (const [idx, col] of paint) {
		const [r, g, b] = rgb(col);
		rgba[idx * 4] = r; rgba[idx * 4 + 1] = g; rgba[idx * 4 + 2] = b; rgba[idx * 4 + 3] = 255;
	}

	// Floor shadow: a soft-edged disc on z=0, dithered at the rim so it stays pixel-crisp.
	if (o.shadow) {
		const rs = o.shadow;
		for (let j = 0; j < h; j++) {
			for (let i = 0; i < w; i++) {
				const idx = j * w + i;
				if (rgba[idx * 4 + 3]) continue;
				const sx = (i - ax) / res, sy = (j - ay) / res;
				const ox = sx * R[0] - sy * U[0] - FAR * F[0];
				const oy = sx * R[1] - sy * U[1] - FAR * F[1];
				const oz = sx * R[2] - sy * U[2] - FAR * F[2];
				const t = -oz / F[2];
				const gx = ox + F[0] * t, gy = oy + F[1] * t;
				const d = Math.sqrt(gx * gx + gy * gy) / rs;
				if (d < 0.8 || (d < 1 && (i + j) % 2 === 0)) {
					rgba[idx * 4] = 12; rgba[idx * 4 + 1] = 10; rgba[idx * 4 + 2] = 16; rgba[idx * 4 + 3] = 90;
				}
			}
		}
	}

	return { w, h, ax, ay, rgba, depth, group, groups, view };
}

/**
 * Set one pixel on a frame.
 *
 * @param {Frame} f Frame.
 * @param {number} i Pixel x.
 * @param {number} j Pixel y.
 * @param {string} hex Colour.
 * @param {number} alpha Alpha 0-255.
 */
export function put(f: Frame, i: number, j: number, hex: string, alpha = 255): void {
	i = Math.round(i); j = Math.round(j);
	if (i < 0 || j < 0 || i >= f.w || j >= f.h) return;
	const [r, g, b] = rgb(hex);
	const k = (j * f.w + i) * 4;
	f.rgba[k] = r; f.rgba[k + 1] = g; f.rgba[k + 2] = b; f.rgba[k + 3] = alpha;
}

/**
 * Whether a model-space point is on the visible surface (not hidden behind something).
 *
 * @param {Frame} f Frame.
 * @param {V3} p Point.
 * @param {number} tol Depth tolerance.
 * @returns {[number, number] | null} Pixel coordinates if visible.
 */
export function visible(f: Frame, p: V3, tol = 1.6): [number, number] | null {
	const [sx, sy, d] = project(f, p);
	const i = Math.round(sx), j = Math.round(sy);
	if (i < 0 || j < 0 || i >= f.w || j >= f.h) return null;
	return d <= f.depth[j * f.w + i] + tol ? [i, j] : null;
}

/**
 * Convert a frame to a canvas.
 *
 * @param {Frame} f Frame.
 * @returns {HTMLCanvasElement} Canvas holding the pixels.
 */
export function toCanvas(f: Frame): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = f.w; c.height = f.h;
	const ctx = c.getContext('2d')!;
	ctx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), f.w, f.h), 0, 0);
	return c;
}
