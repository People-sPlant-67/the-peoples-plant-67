/**
 * Visitors: Sputnik crossing the sky over the wasteland about once every 30 to 60
 * minutes, beeping, and a brown bear lumbering through Siberia about once every 20 to 40 minutes: in
 * from the east, a sniff at the hut door and round its corner, then off between the pines. Each takes
 * about half a minute. Neither comes when less motion is asked for, as with the far train.
 */
import { Sprite, Texture } from 'pixi.js';
import { YAW } from '../art/avatar';
import { type Actor, feetOnScreen } from '../art/scene';
import type { V3 } from '../art/sdf';
import type { AmbientRequest, SpritePixels } from '../art/sprite-job';
import type { World } from '../world/types';
import { createPictures, prefersLessMotion } from './pictures';
import type { Voice } from './sound-cues';
import type { Stage } from './stage';
import { WALK_SPEED, facingOf } from './walk';

/** How long between Sputnik's passes and the bear's visits (s); the first comes as soon as any later one could. */
export const SPUTNIK_GAP: [number, number] = [30 * 60, 60 * 60], BEAR_GAP: [number, number] = [20 * 60, 40 * 60];
/** How long Sputnik takes to cross (s), and how often it beeps (s). */
export const SPUTNIK_S = 28, BEEP_EVERY = 1.6;
/** Sputnik's way across the sky behind the plant, on the base layer: over the far wall, clear of it. */
export const SPUTNIK_FROM: [number, number] = [900, 95], SPUTNIK_TO: [number, number] = [1720, 345];
/** How fast the bear walks, against a comrade. */
export const BEAR_PACE = 0.45;
/** A walking frame (ms), and a sniffing one. */
const BEAR_STEP_MS = 220, BEAR_SNIFF_MS = 450;
/** How far (world units) the bear fades in and out at the snowfield's edge. */
const EDGE_FADE = 40;

/** One leg of the bear's visit: walk to a point (tiles), or sniff for a while (s). */
export type BearLeg = { to: [number, number] } | { sniff: number };
/**
 * The bear's visit: in from the east edge, round the pine, nose down at the hut door, along to its
 * corner for another sniff, and away north between the hut and the pines.
 */
export const BEAR_VISIT: readonly BearLeg[] = [
	{ to: [30.0, 4.6] }, { to: [29.6, 3.05] }, { sniff: 7 },
	{ to: [28.3, 2.9] }, { sniff: 4 }, { to: [28.3, 0.25] },
];
/** Where the bear first steps onto the snow (tiles). */
export const BEAR_IN: [number, number] = [31.75, 6.4];

/** What the visitors need from the cockpit. */
export interface VisitorsDeps {
	stage: Pick<Stage, 'far' | 'layer'>;
	world: World;
	render(req: AmbientRequest): Promise<SpritePixels>;
	/** Where a base-layer point is across the screen, 0 to 1, or null off screen. */
	screenX(x: number, y: number): number | null;
	play(voice: Voice, pan: number, gain: number): void;
	reducedMotion?(): boolean;
	rng?: () => number;
	makeTexture?(w: number, h: number, rgba: Uint8ClampedArray): Texture;
}

/** The visitors, for the cockpit. */
export interface Visitors {
	tick(dt: number): void;
	/** The bear, for the depth sort, while it is here. */
	extras(): { actor: Actor; sprite: Sprite }[];
	/** Send one now (for checks). */
	send(who: 'sputnik' | 'bear'): void;
	/** For checks: Sputnik's way across (0 to 1) or null, the bear's position (tiles) and doing, and seconds until each next comes. */
	state(): { sputnik: number | null; bear: { at: [number, number]; sniffing: boolean } | null; next: { sputnik: number; bear: number } };
}

/**
 * Start the visitors' timers.
 *
 * @param d Dependencies.
 * @returns Visitors.
 */
export function createVisitors(d: VisitorsDeps): Visitors {
	const rng = d.rng ?? Math.random;
	const reduced = d.reducedMotion ?? prefersLessMotion;
	const L = d.world.tile;
	const scene = d.world.scene;
	/**
	 * A random time between two.
	 *
	 * @param r Shortest and longest.
	 * @returns Seconds.
	 */
	const between = (r: [number, number]): number => r[0] + rng() * (r[1] - r[0]);
	const picture = createPictures(d.render, d.makeTexture);

	let nextSputnik = between(SPUTNIK_GAP), nextBear = between(BEAR_GAP);
	/** Sputnik: seconds into its pass, which way (1 left to right), seconds to the next beep. */
	let sputnik: { t: number; way: number; beep: number } | null = null;
	const sat = new Sprite(Texture.EMPTY);
	sat.visible = false;
	d.stage.far.addChild(sat);

	/** The bear: where, which leg, time in it (ms), and its frame. */
	let bear: { pos: V3; leg: number; t: number; frame: number; yaw: number; huffed: boolean } | null = null;
	const bearSprite = new Sprite(Texture.EMPTY);
	bearSprite.visible = false;
	d.stage.layer.addChild(bearSprite);
	const bearActor: Actor = { id: 'bear', pos: [0, 0, 0], radius: 20 };

	/**
	 * Play a sound from a base-layer point, if it is on screen.
	 *
	 * @param v Voice.
	 * @param x Base-layer x.
	 * @param y Base-layer y.
	 * @param gain Level.
	 */
	const hear = (v: Voice, x: number, y: number, gain: number): void => {
		const sx = d.screenX(x, y);
		if (sx !== null) d.play(v, sx * 2 - 1, gain);
	};

	/**
	 * Move the bear along its visit.
	 *
	 * @param dt Milliseconds.
	 */
	const stepBear = (dt: number): void => {
		const b = bear!;
		b.t += dt;
		const leg = BEAR_VISIT[b.leg];
		if (!leg) { bear = null; return; }
		if ('sniff' in leg) {
			if (!b.huffed) { b.huffed = true; const [x, y] = feetOnScreen(scene, b.pos); hear('huff', x, y - 20, 0.5); }
			b.frame = 4 + (Math.floor(b.t / BEAR_SNIFF_MS) % 2);
			if (b.t >= leg.sniff * 1000) { b.leg++; b.t = 0; b.huffed = false; }
			return;
		}
		const to: V3 = [leg.to[0] * L, leg.to[1] * L, 0];
		const dx = to[0] - b.pos[0], dy = to[1] - b.pos[1], dist = Math.hypot(dx, dy);
		const go = WALK_SPEED * BEAR_PACE * dt;
		b.yaw = YAW[facingOf(dx, dy)];
		b.frame = Math.floor(b.t / BEAR_STEP_MS) % 4;
		if (go >= dist) { b.pos = to; b.leg++; b.t = 0; b.huffed = false; return; }
		b.pos = [b.pos[0] + (dx / dist) * go, b.pos[1] + (dy / dist) * go, 0];
	};

	/**
	 * How far the bear has faded in at the snowfield's edges: east (where it comes in) and north (where it goes).
	 *
	 * @param p Where it is.
	 * @returns Opacity, 0 to 1.
	 */
	const edgeAlpha = (p: V3): number => Math.max(0, Math.min(1, (32 * L - p[0]) / EDGE_FADE - 0.3, p[1] / EDGE_FADE - 0.3));

	return {
		tick(dt) {
			const s = dt / 1000;
			const still = reduced();
			if (!still) {
				if (!sputnik && (nextSputnik -= s) <= 0) { sputnik = { t: 0, way: rng() < 0.5 ? 1 : -1, beep: 0.5 }; nextSputnik = between(SPUTNIK_GAP); }
				if (!bear && (nextBear -= s) <= 0) { bear = { pos: [BEAR_IN[0] * L, BEAR_IN[1] * L, 0], leg: 0, t: 0, frame: 0, yaw: 0, huffed: false }; nextBear = between(BEAR_GAP); }
			}
			// Sputnik.
			if (sputnik) {
				sputnik.t += s;
				const k = sputnik.t / SPUTNIK_S;
				if (k >= 1 || still) { sputnik = null; sat.visible = false; }
				else {
					const u = sputnik.way > 0 ? k : 1 - k;
					const x = SPUTNIK_FROM[0] + (SPUTNIK_TO[0] - SPUTNIK_FROM[0]) * u, y = SPUTNIK_FROM[1] + (SPUTNIK_TO[1] - SPUTNIK_FROM[1]) * u;
					const t = picture({ ambient: 'sputnik' });
					sat.visible = !!t;
					if (t) {
						sat.texture = t.tex;
						// Drawn flying left to right, its antennae trailing; the other way, mirrored.
						sat.scale.x = sputnik.way;
						sat.position.set(Math.round(x - t.ax * sputnik.way), Math.round(y - t.ay));
					}
					sputnik.beep -= s;
					if (sputnik.beep <= 0) { sputnik.beep = BEEP_EVERY; hear('beep', x, y, 0.35); }
				}
			}
			// The bear.
			if (bear && still) bear = null;
			if (bear) stepBear(dt);
			bearSprite.visible = false;
			if (bear) {
				const t = picture({ ambient: 'bear', f: bear.frame, yaw: bear.yaw });
				bearActor.pos = bear.pos;
				if (t) {
					const [x, y] = feetOnScreen(scene, bear.pos);
					bearSprite.texture = t.tex;
					bearSprite.position.set(Math.round(x - t.ax), Math.round(y - t.ay));
					bearSprite.alpha = edgeAlpha(bear.pos);
					bearSprite.visible = true;
				}
			}
		},
		extras: () => (bear && bearSprite.visible ? [{ actor: bearActor, sprite: bearSprite }] : []),
		send(who) {
			if (who === 'sputnik') { if (!sputnik) sputnik = { t: 0, way: rng() < 0.5 ? 1 : -1, beep: 0.5 }; }
			else if (!bear) bear = { pos: [BEAR_IN[0] * L, BEAR_IN[1] * L, 0], leg: 0, t: 0, frame: 0, yaw: 0, huffed: false };
		},
		state: () => ({
			sputnik: sputnik ? sputnik.t / SPUTNIK_S : null,
			bear: bear ? { at: [bear.pos[0] / L, bear.pos[1] / L], sniffing: 'sniff' in (BEAR_VISIT[bear.leg] ?? {}) } : null,
			next: { sputnik: nextSputnik, bear: nextBear },
		}),
	};
}
