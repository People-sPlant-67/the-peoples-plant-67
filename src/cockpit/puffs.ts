/**
 * Little puffs of dust: one at a comrade's middle each time a piece of clothing comes
 * off or goes on at the cloakroom. Three pixel frames, growing and fading, drawn over everything.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import { bitmapCanvas } from './dom';

/** How long each frame of a puff shows (ms). */
export const PUFF_FRAME_MS = 110;

/**
 * Draw a ring of dust as a bitmap.
 *
 * @param r Radius in pixels.
 * @param dots How many specks round it.
 * @returns Bitmap rows.
 */
function ring(r: number, dots: number): (string | null)[][] {
	const size = r * 2 + 3;
	const b: (string | null)[][] = Array.from({ length: size }, () => Array<string | null>(size).fill(null));
	for (let k = 0; k < dots; k++) {
		const a = (k / dots) * Math.PI * 2;
		const x = Math.round(r + 1 + Math.cos(a) * r), y = Math.round(r + 1 + Math.sin(a) * r * 0.7);
		b[y][x] = k % 2 ? '#e8e0cc' : '#b9b09c';
		if (k % 3 === 0 && b[y][x + 1] !== undefined) b[y][x + 1] = '#d7cfbb';
	}
	return b;
}

/** The puffs, for the cockpit. */
export interface Puffs {
	/**
	 * Puff at a point.
	 *
	 * @param x World x (base-layer pixels).
	 * @param y World y.
	 */
	at(x: number, y: number): void;
	/**
	 * Grow and fade the puffs.
	 *
	 * @param dt Milliseconds since the last frame.
	 */
	tick(dt: number): void;
}

/**
 * Set up the puffs.
 *
 * @param layer The container they are drawn in (over the comrades).
 * @returns Puffs.
 */
export function createPuffs(layer: Container): Puffs {
	const tex = [ring(4, 8), ring(7, 12), ring(10, 14)].map((b) => Texture.from(bitmapCanvas(b, 1)));
	const live: { s: Sprite; t: number }[] = [];
	return {
		at(x, y) {
			const s = new Sprite(tex[0]);
			s.anchor.set(0.5);
			s.position.set(Math.round(x), Math.round(y));
			layer.addChild(s);
			live.push({ s, t: 0 });
		},
		tick(dt) {
			for (let k = live.length - 1; k >= 0; k--) {
				const p = live[k];
				p.t += dt;
				const f = Math.floor(p.t / PUFF_FRAME_MS);
				if (f >= tex.length) { p.s.destroy(); live.splice(k, 1); continue; }
				p.s.texture = tex[f];
				p.s.alpha = 1 - f * 0.3;
			}
		},
	};
}
