/**
 * The life around the plant: pigeons on the back walls, smoke from the wasteland's
 * chimneys, and a freight train crossing the haze far behind the plant. Modelled like everything
 * else, so the light and the pixel scale match.
 */
import { type Frame, fitBounds, makeView, render } from './render';
import { type Prim, type V3, box, cylinder, ellipsoid, roundCone } from './sdf';
import { trainPrims } from './train';

/** A pigeon's frames: sat, pecking, flying. */
export type PigeonFrame = 0 | 1 | 2;

/**
 * A pigeon at the origin, facing +x: grey body, a green sheen on the neck, darker bars on the wings.
 *
 * @param f Frame.
 * @returns Primitives.
 */
export function pigeonPrims(f: PigeonFrame): Prim[] {
	const p: Prim[] = [];
	const lift = f === 2 ? 4 : 0;
	p.push(ellipsoid([0, 0, 3.4 + lift], [4.4, 2.6, 2.6], 'hairGrey', { group: 'pigeon', pattern: (lx, _ly, lz) => (lz > 0.6 && lx < -0.5 && Math.abs(lx + 1.6) < 0.5 ? { shift: -1 } : null) }));
	p.push(roundCone([-3.4, 0, 3.6 + lift], [-7, 0, 3.2 + lift], 1.6, 1, 'hairGrey', { group: 'pigeonTail', pattern: (lx) => (lx < -2.6 ? { mat: 'charcoal' } : null) }));
	const head: V3 = f === 1 ? [4.6, 0, 1.6 + lift] : [3.4, 0, 6.2 + lift];
	p.push(roundCone([2, 0, 4.6 + lift], head, 1.9, 1.5, 'bottleGreen', { group: 'pigeonNeck' }));
	p.push(ellipsoid(head, [1.7, 1.5, 1.6], 'hairGrey', { group: 'pigeonHead' }));
	p.push(roundCone(head, [head[0] + 2.2, 0, head[2] - 0.5], 0.5, 0.3, 'charcoal', { group: 'beak' }));
	if (f === 2) {
		// Wings out and up.
		for (const s of [1, -1]) p.push(ellipsoid([-0.5, s * 6, 6.4 + lift], [3, 4.8, 0.7], 'hairGrey', { group: `wing${s}`, pattern: (lx) => (lx < -1.6 ? { mat: 'charcoal' } : null) }));
	} else for (const s of [1, -1]) p.push(roundCone([0.6, s * 1, 1.2], [0.8, s * 1, 0], 0.4, 0.4, 'brickRed', { group: 'feet' }));
	return p;
}

/**
 * A pigeon drawn alone, its anchor at its feet.
 *
 * @param f Frame.
 * @param yaw Facing in degrees (0 = screen south-east).
 * @returns Frame.
 */
export function renderPigeon(f: PigeonFrame, yaw: number): Frame {
	const prims = pigeonPrims(f);
	// A third bigger than life beside the comrades, or a pigeon is a few grey pixels.
	const view = makeView(yaw, 1.35);
	return render(prims, { ...fitBounds(prims, view, 2), view });
}

/** The sizes a puff of smoke grows through as it rises, world units. */
export const PUFF_SIZES = [4, 6, 8.5, 11, 14] as const;

/**
 * One puff of smoke: a soft grey ball, a little flattened.
 *
 * @param k Size step (see PUFF_SIZES).
 * @returns Frame, anchored at its middle.
 */
export function renderPuff(k: number): Frame {
	const r = PUFF_SIZES[k];
	const prims = [ellipsoid([0, 0, 0], [r, r, r * 0.8], 'hairGrey', { group: 'puff', pattern: (lx, ly, lz) => (lz > r * 0.3 && Math.abs(lx - ly) < r * 0.4 ? { shift: 1 } : null) })];
	const view = makeView(0);
	return render(prims, { ...fitBounds(prims, view, 2), view });
}

/** The tops of the wasteland's two chimneys (see wasteland.ts), where smoke comes out, world units. */
export const CHIMNEY_TOPS: V3[] = [[8 * 32 * Math.SQRT2, -21 * 32 * Math.SQRT2, 300], [13 * 32 * Math.SQRT2, -23 * 32 * Math.SQRT2, 250]];

/** Where the far train runs: a line across the back of the wasteland, world units. */
export const FAR_TRAIN = { y: -25 * 32 * Math.SQRT2, x0: -30 * 32 * Math.SQRT2, x1: 46 * 32 * Math.SQRT2 } as const;

/**
 * A freight train for the far line: the locomotive, then a string of goods wagons and a tanker.
 * Front at x = 0, running along -x.
 *
 * @returns Primitives.
 */
export function farTrainPrims(): Prim[] {
	const p = trainPrims();
	// The passenger carriage stays; behind it, goods wagons and a tanker.
	let x = -270;
	for (let k = 0; k < 5; k++) {
		const tanker = k === 2;
		if (tanker) p.push(cylinder([x - 40, 0, 26], 14, 2, 0.5, 'iron', { group: `wagon${k}` }));
		if (tanker) p.push(roundCone([x - 74, 0, 28], [x - 6, 0, 28], 13, 13, 'charcoal', { group: `wagon${k}` }));
		else p.push(box([x - 40, 0, 27], [37, 15, 14], 1.2, k % 2 ? 'brick' : 'woodDark', { group: `wagon${k}`, pattern: (lx) => (((lx + 200) % 12) < 1 ? { shift: -1 } : null) }));
		for (const dx of [-14, -66]) for (const s of [-1, 1]) p.push(cylinder([x + dx, s * 12, 8], 6, 2, 0.8, 'iron', { group: `wheels${k}` }));
		x -= 84;
	}
	return p;
}

/** The far train's length, front to back. */
export const FAR_TRAIN_LEN = 270 + 5 * 84;

/**
 * The far train drawn once, facing +x, its anchor at the front on the ground.
 *
 * @param base The plant's base frame (for its view).
 * @param base.view View.
 * @returns Frame.
 */
export function renderFarTrain(base: { view: Frame['view'] }): Frame {
	const prims = farTrainPrims();
	return render(prims, { ...fitBounds(prims, base.view, 2), view: base.view });
}
