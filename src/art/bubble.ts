/**
 * Speech-bubble pop overlay: 5 frames (dot, small, overshoot, settle, content). Direction
 * independent; the plant draws it above an agent's head when a comment lands. The "writing"
 * kind is a thought bubble (two small rings for a tail) holding three dots, one dark in turn.
 */

import { rgb } from './palette';

export const BUBBLE_MS = [60, 60, 70, 70, 0];

export interface BubbleFrame {
	w: number;
	h: number;
	rgba: Uint8ClampedArray;
	/** Pixel of the tail tip, which is placed just above the agent's head. */
	tipX: number;
	tipY: number;
}

const FILL = '#f4efe2', LINE = '#1f1a17', SHADE = '#cfc6b2', MARK = '#1f1a17', ALERT = '#bd352c', SEAL = '#bd352c', DIM = '#9a917e';

/** The bubbles: a sealed letter (a reply), a red "!" (needs the State), "…" (writing an answer), a wink (the bust of Lenin). */
export type BubbleArt = 'reply' | 'alert' | 'writing' | 'wink';

/** Frames of the "…" dots' turn: one per dot. */
export const WRITING_PHASES = 3;
/** How long each dot stays dark (ms). */
export const WRITING_PHASE_MS = 350;

/**
 * Render one bubble frame.
 *
 * @param {number} f Frame index 0-4.
 * @param {BubbleArt} kind A sealed letter for a reply, a red "!" when something needs the State, "…" while writing.
 * @param {number} phase For "…", which dot is dark (0 to WRITING_PHASES - 1).
 * @returns {BubbleFrame} Pixels.
 */
export function bubbleFrame(f: number, kind: BubbleArt = 'reply', phase = 0): BubbleFrame {
	// Even widths once open, so a two-pixel mark sits dead centre.
	const sizes: [number, number][] = [[4, 4], [11, 8], [24, 14], [22, 13], [22, 13]];
	const [bw, bh] = sizes[Math.min(f, 4)];
	// The thought bubble's tail reaches a row lower than the speech tail.
	const w = bw + 2, h = bh + (kind === 'writing' ? 6 : 5);
	const rgba = new Uint8ClampedArray(w * h * 4);
	const put = (x: number, y: number, hex: string) => {
		if (x < 0 || y < 0 || x >= w || y >= h) return;
		const [r, g, b] = rgb(hex);
		const k = (y * w + x) * 4;
		rgba[k] = r; rgba[k + 1] = g; rgba[k + 2] = b; rgba[k + 3] = 255;
	};
	const r = bh > 6 ? 3 : 1;
	const inside = (x: number, y: number) => {
		if (x < 0 || y < 0 || x >= bw || y >= bh) return false;
		const cx = x < r ? r - x : x >= bw - r ? x - (bw - r - 1) : 0;
		const cy = y < r ? r - y : y >= bh - r ? y - (bh - r - 1) : 0;
		return cx * cx + cy * cy <= r * r + 1;
	};
	for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
		if (!inside(x, y)) continue;
		const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
		put(x + 1, y + 1, edge ? LINE : y >= bh - 3 ? SHADE : FILL);
	}
	// Tail, pointing down-left towards the speaker's head.
	const tx = Math.max(2, Math.floor(bw * 0.3));
	if (kind === 'writing') {
		// A thought, not speech: a small ring under the bubble and a dot below it, towards the head.
		if (bh > 6) {
			put(tx + 1, bh + 2, LINE); put(tx, bh + 3, LINE); put(tx + 1, bh + 3, FILL); put(tx + 2, bh + 3, LINE); put(tx + 1, bh + 4, LINE);
			put(tx - 1, bh + 5, LINE);
		}
		if (f === 4) {
			const mid = Math.floor(w / 2), y = Math.floor((bh + 2) / 2) - 1;
			for (let k = 0; k < 3; k++) {
				const x = mid - 6 + k * 5, c = k === phase % WRITING_PHASES ? MARK : DIM;
				put(x, y, c); put(x + 1, y, c); put(x, y + 1, c); put(x + 1, y + 1, c);
			}
		}
		return { w, h, rgba, tipX: tx - 1, tipY: bh + 5 };
	}
	if (bh > 6) {
		put(tx + 1, bh, FILL); put(tx + 2, bh, FILL); put(tx, bh, LINE); put(tx + 3, bh, LINE);
		put(tx, bh + 1, FILL); put(tx + 1, bh + 1, FILL); put(tx - 1, bh + 1, LINE); put(tx + 2, bh + 1, LINE);
		put(tx - 1, bh + 2, LINE); put(tx, bh + 2, LINE);
	}
	if (f === 4) {
		const cy = Math.floor(bh / 2);
		if (kind === 'reply') {
			// A letter, not three dots: dots read as "is typing", and this means "has answered".
			const x0 = Math.floor(w / 2) - 6, y0 = cy - 3, ew = 12, eh = 8;
			for (let x = 0; x < ew; x++) { put(x0 + x, y0, MARK); put(x0 + x, y0 + eh - 1, MARK); }
			for (let y = 0; y < eh; y++) { put(x0, y0 + y, MARK); put(x0 + ew - 1, y0 + y, MARK); }
			// The flap: a V from the top corners to the middle.
			for (let k = 1; k < ew / 2; k++) { put(x0 + k, y0 + Math.min(k, 4), MARK); put(x0 + ew - 1 - k, y0 + Math.min(k, 4), MARK); }
			put(x0 + ew / 2 - 1, y0 + 4, SEAL); put(x0 + ew / 2, y0 + 4, SEAL); put(x0 + ew / 2 - 1, y0 + 5, SEAL); put(x0 + ew / 2, y0 + 5, SEAL);
		} else if (kind === 'wink') {
			// A winking face: one eye open, the other shut in a little arc, and a grin.
			const mid = Math.floor(w / 2), y = cy - 2;
			put(mid - 5, y, MARK); put(mid - 4, y, MARK); put(mid - 5, y + 1, MARK); put(mid - 4, y + 1, MARK);
			put(mid + 2, y + 1, MARK); put(mid + 3, y, MARK); put(mid + 4, y + 1, MARK);
			for (let x = -4; x <= 4; x++) put(mid + x, y + 5, MARK);
			put(mid - 5, y + 4, MARK); put(mid + 5, y + 4, MARK);
		} else {
			// A 2×4 bar, a gap, a 2×2 dot: seven rows centred in the bubble, two clear rows above and below.
			const mid = Math.floor(w / 2), top = Math.floor((bh + 2) / 2) - 3;
			for (let y = top; y < top + 4; y++) { put(mid - 1, y, ALERT); put(mid, y, ALERT); }
			for (let y = top + 5; y < top + 7; y++) { put(mid - 1, y, ALERT); put(mid, y, ALERT); }
		}
	}
	return { w, h, rgba, tipX: tx - 1, tipY: bh + 2 };
}
