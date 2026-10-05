/**
 * Signed-distance primitives. Sprites are modelled as small 3D volumes and rasterised by
 * ray-marching, so all 8 directions and every animation frame come from one model.
 * Hand-authored per-direction pixel grids would take weeks for the same coverage.
 *
 * Coordinates: x/y on the floor, z up. Units are roughly screen pixels.
 */

import type { MaterialName } from './palette';

export type V3 = [number, number, number];

/** Optional per-surface override: swap material and/or shift the tone ramp. */
export interface PatternOut {
	mat?: MaterialName;
	shift?: number;
}

/**
 * Surface pattern callback, evaluated at the hit point.
 * Receives the hit position relative to the primitive's origin, and the surface normal.
 */
export type Pattern = (lx: number, ly: number, lz: number, nx: number, ny: number, nz: number) => PatternOut | null;

export interface Prim {
	sdf: (x: number, y: number, z: number) => number;
	mat: MaterialName;
	/** Outline lines are drawn where different groups overlap at a depth step. */
	group: string;
	min: V3;
	max: V3;
	origin: V3;
	pattern?: Pattern;
}

export interface PrimOpts {
	group: string;
	pattern?: Pattern;
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Rotate a vector about the z axis.
 *
 * @param {V3} v Vector.
 * @param {number} a Angle in radians.
 * @returns {V3} Rotated vector.
 */
export function rotZ(v: V3, a: number): V3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

const bounds = (c: V3, r: number): { min: V3; max: V3 } => ({ min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] });

/**
 * Axis-aligned ellipsoid (Inigo Quilez's bound; slightly inexact, the marcher under-steps to compensate).
 *
 * @param {V3} c Centre.
 * @param {V3} r Radii.
 * @param {string} mat Material name.
 * @param {PrimOpts} o Group and pattern.
 * @returns {Prim} Primitive.
 */
export function ellipsoid(c: V3, r: V3, mat: MaterialName, o: PrimOpts): Prim {
	const [cx, cy, cz] = c;
	const [rx, ry, rz] = r;
	return {
		sdf: (x, y, z) => {
			const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
			const k0 = Math.sqrt(px * px + py * py + pz * pz);
			const qx = px / rx, qy = py / ry, qz = pz / rz;
			const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
			return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
		},
		mat, group: o.group, pattern: o.pattern, origin: c,
		min: [cx - rx, cy - ry, cz - rz], max: [cx + rx, cy + ry, cz + rz],
	};
}

/**
 * Tapered capsule between two points (round cone).
 *
 * @param {V3} a Start point.
 * @param {V3} b End point.
 * @param {number} r1 Radius at a.
 * @param {number} r2 Radius at b.
 * @param {string} mat Material name.
 * @param {PrimOpts} o Group and pattern.
 * @returns {Prim} Primitive.
 */
export function roundCone(a: V3, b: V3, r1: number, r2: number, mat: MaterialName, o: PrimOpts): Prim {
	const ba = sub(b, a);
	const l2 = dot(ba, ba);
	const rr = r1 - r2;
	const a2 = l2 - rr * rr;
	const il2 = 1 / (l2 || 1e-6);
	const r = Math.max(r1, r2);
	return {
		sdf: (x, y, z) => {
			if (l2 < 1e-6) {
				const dx = x - a[0], dy = y - a[1], dz = z - a[2];
				return Math.sqrt(dx * dx + dy * dy + dz * dz) - r1;
			}
			const pax = x - a[0], pay = y - a[1], paz = z - a[2];
			const yy = pax * ba[0] + pay * ba[1] + paz * ba[2];
			const zz = yy - l2;
			const wx = pax * l2 - ba[0] * yy, wy = pay * l2 - ba[1] * yy, wz = paz * l2 - ba[2] * yy;
			const x2 = wx * wx + wy * wy + wz * wz;
			const y2 = yy * yy * l2;
			const z2 = zz * zz * l2;
			const k = Math.sign(rr) * rr * rr * x2;
			if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
			if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
			return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
		},
		mat, group: o.group, pattern: o.pattern, origin: a,
		min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
		max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r],
	};
}

/**
 * Rounded box, optionally oriented by an orthonormal basis.
 *
 * @param {V3} c Centre.
 * @param {V3} h Half extents along the basis axes.
 * @param {number} round Corner radius.
 * @param {string} mat Material name.
 * @param {PrimOpts} o Group and pattern.
 * @param {[V3, V3, V3]} basis Local x, y, z axes in world space.
 * @returns {Prim} Primitive.
 */
export function box(c: V3, h: V3, round: number, mat: MaterialName, o: PrimOpts, basis?: [V3, V3, V3]): Prim {
	const [ex, ey, ez] = basis ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
	const hx = h[0] - round, hy = h[1] - round, hz = h[2] - round;
	let min: V3, max: V3;
	if (basis) {
		const r = len(h);
		({ min, max } = bounds(c, r));
	} else {
		min = [c[0] - h[0], c[1] - h[1], c[2] - h[2]];
		max = [c[0] + h[0], c[1] + h[1], c[2] + h[2]];
	}
	return {
		sdf: (x, y, z) => {
			const dx = x - c[0], dy = y - c[1], dz = z - c[2];
			const qx = Math.abs(dx * ex[0] + dy * ex[1] + dz * ex[2]) - hx;
			const qy = Math.abs(dx * ey[0] + dy * ey[1] + dz * ey[2]) - hy;
			const qz = Math.abs(dx * ez[0] + dy * ez[1] + dz * ez[2]) - hz;
			const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
			return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - round;
		},
		mat, group: o.group, pattern: o.pattern, origin: c, min, max,
	};
}

/**
 * Vertical rounded cylinder.
 *
 * @param {V3} c Centre.
 * @param {number} r Radius.
 * @param {number} hh Half height.
 * @param {number} round Edge radius.
 * @param {string} mat Material name.
 * @param {PrimOpts} o Group and pattern.
 * @returns {Prim} Primitive.
 */
export function cylinder(c: V3, r: number, hh: number, round: number, mat: MaterialName, o: PrimOpts): Prim {
	return {
		sdf: (x, y, z) => {
			const dx = x - c[0], dy = y - c[1];
			const qx = Math.sqrt(dx * dx + dy * dy) - r + round;
			const qz = Math.abs(z - c[2]) - hh + round;
			const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
			return Math.min(Math.max(qx, qz), 0) + Math.sqrt(ox * ox + oz * oz) - round;
		},
		mat, group: o.group, pattern: o.pattern, origin: c,
		min: [c[0] - r, c[1] - r, c[2] - hh], max: [c[0] + r, c[1] + r, c[2] + hh],
	};
}

/**
 * Vertical capped cone, centred at c.
 *
 * @param {V3} c Centre.
 * @param {number} hh Half height.
 * @param {number} r1 Bottom radius.
 * @param {number} r2 Top radius.
 * @param {string} mat Material name.
 * @param {PrimOpts} o Group and pattern.
 * @returns {Prim} Primitive.
 */
export function cone(c: V3, hh: number, r1: number, r2: number, mat: MaterialName, o: PrimOpts): Prim {
	const k2x = r2 - r1, k2y = 2 * hh;
	const k2d = k2x * k2x + k2y * k2y;
	const r = Math.max(r1, r2);
	return {
		sdf: (x, y, z) => {
			const dx = x - c[0], dy = y - c[1];
			const qx = Math.sqrt(dx * dx + dy * dy), qy = z - c[2];
			const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - hh;
			const t = Math.min(Math.max(((r2 - qx) * k2x + (hh - qy) * k2y) / k2d, 0), 1);
			const cbx = qx - r2 + k2x * t, cby = qy - hh + k2y * t;
			const s = cbx < 0 && cay < 0 ? -1 : 1;
			return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
		},
		mat, group: o.group, pattern: o.pattern, origin: c,
		min: [c[0] - r, c[1] - r, c[2] - hh], max: [c[0] + r, c[1] + r, c[2] + hh],
	};
}

/**
 * Deterministic 2D/3D hash in [0, 1), used for pixel-stable surface noise.
 *
 * @param {number} a First coordinate.
 * @param {number} b Second coordinate.
 * @param {number} c Third coordinate.
 * @returns {number} Pseudo-random value.
 */
export function hash(a: number, b: number, c = 0): number {
	let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}
