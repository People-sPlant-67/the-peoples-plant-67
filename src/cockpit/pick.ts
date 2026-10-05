/**
 * Which comrade is under the pointer. Pure, for tests/cockpit-maths.test.ts.
 */

/** A comrade's clickable box in world pixels, in painting order (later is in front). */
export interface PickBox { id: string; x0: number; y0: number; x1: number; y1: number }

/** Half-width of a comrade's clickable box: the body, not the whole sprite canvas. */
export const PICK_HALF_W = 13;

/**
 * Clickable box for a comrade standing with feet at (fx, fy): from just above the head down
 * to a little below the feet, as wide as the body.
 *
 * @param id Comrade id.
 * @param fx Feet x, world pixels.
 * @param fy Feet y, world pixels.
 * @param headAbove Pixels from the feet up to the top of the head (at least 40 is assumed).
 * @returns Box.
 */
export function pickBox(id: string, fx: number, fy: number, headAbove: number): PickBox {
	return { id, x0: fx - PICK_HALF_W, x1: fx + PICK_HALF_W, y0: fy - Math.max(40, headAbove), y1: fy + 4 };
}

/**
 * The front-most box containing a point.
 *
 * @param boxes Boxes in painting order.
 * @param p World point.
 * @returns Comrade id, or null.
 */
export function pickAt(boxes: PickBox[], p: { x: number; y: number }): string | null {
	for (let k = boxes.length - 1; k >= 0; k--) {
		const b = boxes[k];
		if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) return b.id;
	}
	return null;
}
