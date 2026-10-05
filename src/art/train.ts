/**
 * The train: a black Soviet steam locomotive with red wheels and a star on the smokebox, and one
 * green carriage. Built from the same primitives as everything else and rendered once, facing
 * +x, with its front buffers at local x = 0 so it can slide along the track by moving one sprite.
 *
 * Besides the pixels, trainFrame() keeps each pixel's local position (from the depth buffer), so
 * the cockpit can hide whatever part of the train is still inside the wall.
 */
import { type Frame, FAR, fitBounds, makeView, render } from './render';
import { type Prim, box, cylinder, ellipsoid, roundCone } from './sdf';

/** Length from the front buffers to the back of the carriage, world units. */
export const TRAIN_LEN = 262;
/** Local x of the carriage door (negative: behind the front), where passengers step off. */
export const TRAIN_DOOR_X = -152;
/** Half-width across the track. */
export const TRAIN_HALF_W = 19;

/**
 * Whether a point lies inside a five-pointed star of radius r (point up), in the y–z plane.
 *
 * @param y Across.
 * @param z Up.
 * @param r Outer radius.
 * @returns True inside.
 */
function inStar(y: number, z: number, r: number): boolean {
	const a = Math.atan2(y, z);
	const seg = (2 * Math.PI) / 5;
	const k = ((a % seg) + seg) % seg - seg / 2;
	// Radius of the star's edge at this angle: between the outer point and the inner notch.
	const inner = r * 0.42;
	const edge = inner + (r - inner) * (1 - Math.abs(k) / (seg / 2));
	return Math.hypot(y, z) <= edge;
}

/**
 * The train's primitives, front at x = 0, running back along -x, centred on y = 0.
 *
 * @returns Primitives.
 */
export function trainPrims(): Prim[] {
	const p: Prim[] = [];
	// Locomotive
	p.push(box([-2, 0, 16], [2.5, 17, 4.5], 0.5, 'red', { group: 'bufferBeam' }));
	for (const s of [-1, 1]) p.push(ellipsoid([2, s * 11, 16], [3, 3, 3], 'iron', { group: 'buffers' }));
	p.push(box([-58, 0, 13], [54, 10, 6], 0.5, 'charcoal', { group: 'frame' }));
	p.push(box([-58, 0, 25], [56, 18, 1.4], 0.4, 'iron', { group: 'runningBoard', pattern: (_lx, ly) => (Math.abs(ly) > 16.5 ? { mat: 'red' } : null) }));
	p.push(roundCone([-8, 0, 41], [-30, 0, 41], 14.5, 14.5, 'charcoal', { group: 'smokebox' }));
	p.push(ellipsoid([6, 0, 41], [1.8, 12, 12], 'iron', {
		group: 'smokeDoor',
		pattern: (_lx, ly, lz) => (inStar(ly, lz, 8) ? { mat: 'red' } : Math.hypot(ly, lz) > 10.5 ? { shift: -1 } : null),
	}));
	p.push(roundCone([-30, 0, 41], [-80, 0, 41], 13.5, 13.5, 'blackLeather', {
		group: 'boiler',
		pattern: (lx) => (((lx % 14) + 14) % 14 < 1.3 ? { mat: 'brass' } : null),
	}));
	p.push(cylinder([-16, 0, 60], 4.2, 6, 0.8, 'charcoal', { group: 'chimney' }));
	p.push(cylinder([-16, 0, 66.5], 5.4, 1.2, 0.6, 'charcoal', { group: 'chimneyLip' }));
	p.push(ellipsoid([-48, 0, 55], [7, 7, 6], 'brass', { group: 'dome' }));
	p.push(box([-100, 0, 47], [18, 17, 21], 1, 'charcoal', {
		group: 'cab',
		pattern: (lx, ly, lz) => (Math.abs(ly) > 16 && lz > 4 && lz < 15 && Math.abs(lx) < 11 ? { mat: 'ice' } : Math.abs(lz + 14) < 1 ? { mat: 'red' } : null),
	}));
	p.push(box([-100, 0, 70], [21, 19.5, 2], 0.8, 'iron', { group: 'cabRoof' }));
	for (const s of [-1, 1]) {
		for (const x of [-46, -68, -90]) {
			p.push(ellipsoid([x, s * 16.5, 13], [12, 2.6, 12], 'red', {
				group: 'wheel',
				pattern: (lx, _ly, lz) => (Math.hypot(lx, lz) < 3 ? { mat: 'iron' } : Math.abs(Math.hypot(lx, lz) - 10.5) < 0.9 ? { shift: -1 } : null),
			}));
		}
		p.push(ellipsoid([-20, s * 15, 8], [7, 2.2, 7], 'red', { group: 'leadWheel' }));
		p.push(roundCone([-90, s * 20, 13], [-46, s * 20, 13], 1.4, 1.4, 'steel', { group: 'rod' }));
	}
	p.push(box([-124, 0, 16], [6, 3, 2], 0.5, 'iron', { group: 'coupler' }));
	// Carriage
	const cx = -195;
	p.push(box([cx, 0, 40], [65, TRAIN_HALF_W - 1, 20], 2, 'bottleGreen', {
		group: 'carriage',
		pattern: (lx, ly, lz) => {
			const door = Math.abs(lx - (TRAIN_DOOR_X - cx)) < 6;
			if (Math.abs(ly) > 16.5 && door) return lz < 14 ? { mat: 'woodDark' } : null;
			if (Math.abs(ly) > 16.5 && lz > 1 && lz < 12 && ((lx + 65) % 15 + 15) % 15 > 4 && ((lx + 65) % 15 + 15) % 15 < 12) return { mat: 'ice' };
			if (Math.abs(lz + 9) < 1.2) return { mat: 'cream' };
			return null;
		},
	}));
	p.push(box([cx, 0, 62], [66, TRAIN_HALF_W + 0.5, 2.6], 2.4, 'iron', { group: 'carriageRoof' }));
	for (const bx of [cx + 38, cx - 38]) {
		p.push(box([bx, 0, 13], [14, 11, 5], 1, 'charcoal', { group: 'bogie' }));
		for (const s of [-1, 1]) for (const dx of [-8, 8]) p.push(ellipsoid([bx + dx, s * 14.5, 8], [6.5, 2, 6.5], 'iron', { group: 'carriageWheel' }));
	}
	return p;
}

/** The rendered train plus, per pixel, its local position (NaN where empty). */
export interface TrainFrame {
	frame: Frame;
	/** Local x, y and z of each pixel's surface point, row-major. */
	lx: Float32Array;
	ly: Float32Array;
	lz: Float32Array;
}

/**
 * Render the train in the plant's view and recover each pixel's local position from depth.
 *
 * @returns Frame and positions.
 */
export function trainFrame(): TrainFrame {
	const view = makeView(0);
	const prims = trainPrims();
	const fit = fitBounds(prims, view, 3);
	const frame = render(prims, { ...fit, view });
	const n = frame.w * frame.h;
	const lx = new Float32Array(n).fill(NaN), ly = new Float32Array(n).fill(NaN), lz = new Float32Array(n).fill(NaN);
	const { R, U, F, res } = view;
	for (let j = 0; j < frame.h; j++) for (let i = 0; i < frame.w; i++) {
		const k = j * frame.w + i;
		const d = frame.depth[k];
		if (!Number.isFinite(d)) continue;
		// The ray for this pixel starts FAR back along F and travels d along it.
		const sx = (i - frame.ax) / res, sy = (j - frame.ay) / res, t = d - FAR;
		lx[k] = sx * R[0] - sy * U[0] + t * F[0];
		ly[k] = sx * R[1] - sy * U[1] + t * F[1];
		lz[k] = sx * R[2] - sy * U[2] + t * F[2];
	}
	return { frame, lx, ly, lz };
}
