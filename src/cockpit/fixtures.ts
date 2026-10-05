/**
 * The things in the plant that open something when clicked, as pure geometry and
 * pixels: which one is under the pointer, the gold outline drawn round it on hover, the
 * telephone's glow and ring marks, and the timing of the wobble and the ring. scenery.ts puts
 * them on the stage.
 */
import type { FixtureId, Patch } from '../world/zones';

/** Tab order: across the director's office from the left, the name on the far wall, then the Repair Brigade's tool wall. */
export const FIXTURE_ORDER: readonly FixtureId[] = ['noticeboard', 'radiogram', 'pravda', 'telephone', 'plaque', 'toolWall'];
/** Pixels round each fixture's drawing that still count as on it (the desk things are small). */
export const FIXTURE_PAD = 3;
/** The hover outline's colour: the posters' gold. */
export const OUTLINE_RGB = [230, 185, 46] as const;
/** One wobble: a pixel each way and back, a step each WOBBLE_STEP_MS. */
export const WOBBLE = [1, -1, 1, -1, 0] as const;
export const WOBBLE_STEP_MS = 60;
/** The emergency lamp flashes on and off this often (ms each way): once a second, well under the 3-a-second limit for flashing. */
export const LAMP_FLASH_MS = 500;
/** The telephone's ring: a burst of hops, then quiet, over and over. */
export const RING_BURST_MS = 1200;
export const RING_GAP_MS = 1800;
export const RING_HOP_MS = 80;

/**
 * Whether a patch has a painted pixel at a point.
 *
 * @param p Patch.
 * @param x X, base-layer pixels.
 * @param y Y.
 * @returns True on a painted pixel.
 */
export function painted(p: Patch, x: number, y: number): boolean {
	const i = Math.floor(x - p.x), j = Math.floor(y - p.y);
	return i >= 0 && j >= 0 && i < p.w && j < p.h && p.rgba[(j * p.w + i) * 4 + 3] > 0;
}

/**
 * The fixture under a point: one whose own pixels are there, else the one whose padded box holds
 * it with the nearest centre.
 *
 * @param patches Each fixture's pixels.
 * @param at Point, base-layer pixels.
 * @param pad Pixels round each box that still count.
 * @returns Fixture, or null.
 */
export function fixtureAt(patches: Readonly<Record<FixtureId, Patch>>, at: { x: number; y: number }, pad = FIXTURE_PAD): FixtureId | null {
	let best: FixtureId | null = null, bestD = Infinity;
	for (const id of FIXTURE_ORDER) {
		const p = patches[id];
		if (painted(p, at.x, at.y)) return id;
		if (at.x < p.x - pad || at.y < p.y - pad || at.x >= p.x + p.w + pad || at.y >= p.y + p.h + pad) continue;
		const d = Math.hypot(at.x - (p.x + p.w / 2), at.y - (p.y + p.h / 2));
		if (d < bestD) { bestD = d; best = id; }
	}
	return best;
}

/**
 * A one-pixel ring round a patch's painted pixels, in a patch one pixel bigger on every side.
 *
 * @param p Patch.
 * @param rgb Colour.
 * @returns Outline.
 */
export function outline(p: Patch, rgb: readonly number[] = OUTLINE_RGB): Patch {
	const w = p.w + 2, h = p.h + 2;
	const rgba = new Uint8ClampedArray(w * h * 4);
	/**
	 * Whether the source has a painted pixel here (in the outline's own coordinates).
	 *
	 * @param i Column.
	 * @param j Row.
	 * @returns True if painted.
	 */
	const on = (i: number, j: number): boolean => i >= 1 && j >= 1 && i <= p.w && j <= p.h && p.rgba[((j - 1) * p.w + i - 1) * 4 + 3] > 0;
	for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
		if (on(i, j) || !(on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1))) continue;
		rgba.set([rgb[0], rgb[1], rgb[2], 255], (j * w + i) * 4);
	}
	return { x: p.x - 1, y: p.y - 1, w, h, rgba };
}

/** How far the telephone's glow reaches from its middle (pixels). */
const GLOW_R = 12;

/** The emergency lamp's glow: wider and stronger, as it must show on red brick. */
export const LAMP_GLOW = { r: 26, alpha: 0.85 } as const;

/**
 * A soft red glow round a patch's middle, a little wider than tall.
 *
 * @param p Patch.
 * @param r How far it reaches (pixels).
 * @param strength Its opacity at the middle, 0 to 1.
 * @returns Glow, centred on the patch.
 */
export function glow(p: Patch, r = GLOW_R, strength = 0.55): Patch {
	const rx = Math.ceil(r * 1.3), ry = r;
	const w = rx * 2 + 1, h = ry * 2 + 1;
	const rgba = new Uint8ClampedArray(w * h * 4);
	for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
		const d = Math.hypot((i - rx) / 1.3, j - ry);
		const a = Math.max(0, 1 - d / r) * strength;
		if (a > 0) rgba.set([255, 96, 64, Math.round(a * 255)], (j * w + i) * 4);
	}
	return { x: Math.round(p.x + p.w / 2) - rx, y: Math.round(p.y + p.h / 2) - ry, w, h, rgba };
}

/** One side's ring marks, as offsets from the telephone's middle (mirrored for the other side). */
const MARKS = [[7, -3], [8, -4], [9, -5], [8, 0], [9, -1], [10, -2], [11, -3]] as const;

/**
 * Cartoon ring marks either side of a patch: they read on any colour, where a red glow alone is
 * lost on the red carpet.
 *
 * @param p Patch.
 * @returns Marks.
 */
export function ringMarks(p: Patch): Patch {
	const cx = Math.round(p.x + p.w / 2), cy = Math.round(p.y + p.h / 2);
	const reach = Math.max(...MARKS.map(([dx]) => dx)), lift = Math.min(...MARKS.map(([, dy]) => dy));
	const w = reach * 2 + 1, h = -lift + 1;
	const rgba = new Uint8ClampedArray(w * h * 4);
	for (const s of [-1, 1]) for (const [dx, dy] of MARKS) rgba.set([255, 236, 190, 255], ((dy - lift) * w + reach + s * dx) * 4);
	return { x: cx - reach, y: cy + lift, w, h, rgba };
}

/**
 * How far the wobble has moved a fixture, this long after it began.
 *
 * @param ms Time since the wobble began.
 * @returns Pixels across (0 once it is over).
 */
export function wobbleAt(ms: number): number {
	const k = Math.floor(ms / WOBBLE_STEP_MS);
	return k >= 0 && k < WOBBLE.length ? WOBBLE[k] : 0;
}

/**
 * The telephone's ring this long after it began: whether it hops up a pixel, and whether the ring
 * marks show (during each burst).
 *
 * @param ms Time since it began ringing.
 * @returns Hop (pixels up) and marks.
 */
export function ringAt(ms: number): { hop: number; marks: boolean } {
	const t = ((ms % (RING_BURST_MS + RING_GAP_MS)) + RING_BURST_MS + RING_GAP_MS) % (RING_BURST_MS + RING_GAP_MS);
	if (t >= RING_BURST_MS) return { hop: 0, marks: false };
	return { hop: Math.floor(t / RING_HOP_MS) % 2, marks: true };
}
