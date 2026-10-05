/**
 * Size of the previewer's plain "Checker" stage, derived from the sprite canvas and the speech
 * bubble so neither is ever clipped. Kept apart from main.ts (which needs a DOM and a GPU) so
 * the test suite can check the numbers.
 */

import { SPRITE } from '../art/avatar';
import { bubbleFrame } from '../art/bubble';

/** Side of one checker square, in world pixels. The stage is a whole number of squares. */
export const CHECKER_SQUARE = 8;

/** Clear ground left around the comrade and bubble, in world pixels. */
export const CHECKER_MARGIN = 8;

/** Checker stage size and where the sprite canvas's top-left corner sits on it. */
export interface CheckerStage {
	w: number;
	h: number;
	/** Sprite canvas origin on the stage; the feet are at (x + SPRITE.ax, y + SPRITE.ay). */
	x: number;
	y: number;
}

/**
 * Work out the checker stage from SPRITE and every bubble frame.
 *
 * The bubble's tail tip is pinned to `headTopIn`, which always lies inside the sprite canvas
 * (the art tests keep row 0 clear, so the head's outline and the point above it are at y >= 0).
 * Rather than render frames to find the real head height, the stage assumes the tip could be
 * anywhere in the canvas: the worst case is a tip on the top row or at either side. That makes
 * the answer hold for every outfit, animation, direction and headwear without rendering, and
 * the sprite canvas itself already contains the raised sledgehammer (the art tests fail on a
 * clipped frame).
 *
 * The comrade stays horizontally centred, and the stage is rounded up to whole checker squares
 * so the pattern never ends in a sliver.
 *
 * @returns {CheckerStage} Stage size and sprite origin, all whole pixels.
 */
export function checkerStage(): CheckerStage {
	// How far the bubble reaches from its tail tip, over every pop frame (both kinds share a shape).
	let left = 0, right = 0, above = 0;
	for (let f = 0; f < 5; f++) for (const kind of ['reply', 'alert'] as const) {
		const b = bubbleFrame(f, kind);
		left = Math.max(left, b.tipX);
		right = Math.max(right, b.w - 1 - b.tipX);
		above = Math.max(above, b.tipY);
	}
	// The tail tip is the bubble's lowest point, so nothing hangs below the sprite canvas.
	const side = CHECKER_MARGIN + Math.max(left, right);
	const top = CHECKER_MARGIN + above;
	const bottom = CHECKER_MARGIN;
	const up = (n: number) => Math.ceil(n / CHECKER_SQUARE) * CHECKER_SQUARE;
	const w = up(SPRITE.w + 2 * side);
	const h = up(SPRITE.h + top + bottom);
	// Share the rounding slack: evenly left and right, and all of it above, where the bubble goes.
	return { w, h, x: side + Math.floor((w - SPRITE.w - 2 * side) / 2), y: h - bottom - SPRITE.h };
}
