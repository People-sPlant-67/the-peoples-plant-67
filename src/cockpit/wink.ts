/**
 * The bust that winks: click a bust of Lenin five times in quick succession (the
 * Palace's own, or any the owner has put up) and he winks, a speech bubble over his head, with a
 * soft ding. Clicking a bust otherwise does what clicking the floor does.
 */
import { Sprite, Texture } from 'pixi.js';
import { BUBBLE_MS, bubbleFrame } from '../art/bubble';
import { textureOf } from '../preview/textures';
import type { Voice } from './sound-cues';
import type { Stage } from './stage';

/** Clicks it takes, the longest gap between two of them (ms), and how long the wink shows (ms). */
export const WINK_CLICKS = 5, WINK_GAP_MS = 700, WINK_SHOW_MS = 1800;

/** What the wink needs from the cockpit. */
export interface WinkDeps {
	stage: Pick<Stage, 'bubbles'>;
	/** The bust under a base-layer point, and its box there; null when there is none. */
	bustAt(x: number, y: number): { id: string; box: { x: number; y: number; w: number; h: number } } | null;
	/** Where a base-layer point is across the screen, 0 to 1, or null off screen. */
	screenX(x: number, y: number): number | null;
	play(voice: Voice, pan: number, gain: number): void;
	/** The time in ms; tests pass their own clock. */
	now?(): number;
	makeTexture?(w: number, h: number, rgba: Uint8ClampedArray): Texture;
}

/** The wink, for the cockpit. */
export interface Wink {
	/** A click on the plant, at a base-layer point. */
	click(at: { x: number; y: number }): void;
	/** Something else was clicked (a comrade): start counting again. */
	reset(): void;
	tick(dt: number): void;
	/** For checks: clicks counted so far, and the bust winking now. */
	state(): { clicks: number; winking: string | null };
}

/**
 * Set up the wink.
 *
 * @param d Dependencies.
 * @returns Wink.
 */
export function createWink(d: WinkDeps): Wink {
	const now = d.now ?? (() => performance.now());
	const makeTexture = d.makeTexture ?? textureOf;
	let tex: { tex: Texture; tipX: number; tipY: number }[] | null = null;
	const bubble = new Sprite(Texture.EMPTY);
	bubble.visible = false;
	d.stage.bubbles.addChild(bubble);
	/** The clicks so far: on which bust, how many, and when the last was. */
	let run: { id: string; n: number; at: number } | null = null;
	/** The wink showing: over which bust, where its tip goes, and time shown (ms). */
	let wink: { id: string; x: number; y: number; t: number } | null = null;

	return {
		click(at) {
			const b = d.bustAt(at.x, at.y);
			const t = now();
			if (!b) { run = null; return; }
			run = run && run.id === b.id && t - run.at <= WINK_GAP_MS ? { id: b.id, n: run.n + 1, at: t } : { id: b.id, n: 1, at: t };
			if (run.n < WINK_CLICKS) return;
			run = null;
			wink = { id: b.id, x: b.box.x + b.box.w / 2, y: b.box.y + 1, t: 0 };
			const sx = d.screenX(wink.x, wink.y);
			d.play('ding', sx === null ? 0 : sx * 2 - 1, 0.6);
		},
		reset() { run = null; },
		tick(dt) {
			if (!wink) return;
			wink.t += dt;
			if (wink.t >= WINK_SHOW_MS) { wink = null; bubble.visible = false; return; }
			tex ??= [0, 1, 2, 3, 4].map((f) => { const b = bubbleFrame(f, 'wink'); return { tex: makeTexture(b.w, b.h, b.rgba), tipX: b.tipX, tipY: b.tipY }; });
			// It pops in as the comrades' bubbles do, then stays.
			let f = 0, left = wink.t;
			while (f < 4 && left >= BUBBLE_MS[f]) { left -= BUBBLE_MS[f]; f++; }
			bubble.texture = tex[f].tex;
			bubble.position.set(Math.round(wink.x - tex[f].tipX), Math.round(wink.y - tex[f].tipY));
			bubble.visible = true;
		},
		state: () => ({ clicks: run?.n ?? 0, winking: wink?.id ?? null }),
	};
}
