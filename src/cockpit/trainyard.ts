/**
 * The train and the goods doors on the stage. The doors slide open, the train comes out of the
 * tunnel and stops at the platform, and later backs out and the doors close. Whatever part of
 * the train is still inside the wall is hidden, except where the open doorway shows it, darkened.
 *
 * The train is one sprite moved along the track; its pixels are re-masked each frame it moves,
 * from the local position of every pixel that trainFrame() keeps.
 */
import { Graphics, Sprite, Texture } from 'pixi.js';
import { project, toCanvas } from '../art/render';
import type { Actor, Scene } from '../art/scene';
import { TRAIN_HALF_W, TRAIN_LEN, type TrainFrame, trainFrame } from '../art/train';
import { GOODS_DOOR, TRACK, doorwayTest, goodsDoorStates, type Patch } from '../world/zones';
import type { Stage } from './stage';

/** How long the doors take to open or close. */
export const DOORS_MS = 900;
/** How long the train takes to pull in from the tunnel to the platform. */
export const ARRIVE_MS = 3_600;
/** How long it takes to back out into the tunnel. */
export const LEAVE_MS = 3_200;
/** Where the train waits, fully hidden in the tunnel. */
const HIDDEN_X = -TRAIN_LEN - 30;

type State = 'away' | 'opening' | 'arriving' | 'stopped' | 'leaving' | 'closing';

export interface Trainyard {
	/** Open the doors and bring the train in. */
	arrive(): void;
	/** Back the train out and close the doors. */
	leave(): void;
	/** Advance by dt milliseconds. */
	tick(dt: number): void;
	/** The train for depth sorting, or null while it is out of sight. */
	sortable(): { actor: Actor; sprite: Sprite } | null;
	readonly state: State;
}

/**
 * Ease out: fast, then settling.
 *
 * @param t Progress 0 to 1.
 * @returns Eased progress.
 */
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
/**
 * Ease in.
 *
 * @param t Progress 0 to 1.
 * @returns Eased progress.
 */
const easeIn = (t: number): number => t * t * t;

/**
 * Canvas holding a patch's pixels.
 *
 * @param p Patch.
 * @returns Canvas.
 */
function patchCanvas(p: Patch): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = p.w; c.height = p.h;
	c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.w, p.h), 0, 0);
	return c;
}

/**
 * Set up the train and doors on a stage. The train is rendered on first use (about a quarter of
 * a second), so a cockpit that never sees a train never pays for it.
 *
 * @param stage Stage.
 * @param scene The plant's scene.
 * @returns Trainyard.
 */
export function createTrainyard(stage: Stage, scene: Scene): Trainyard {
	const states = goodsDoorStates(scene.base, 8);
	const doorTex = states.map((p) => Texture.from(patchCanvas(p)));
	const doors = new Sprite(doorTex[0]);
	doors.position.set(states[0].x, states[0].y);
	stage.wall.addChild(doors);
	const inDoorway = doorwayTest(scene.base);
	const smoke = new Graphics();
	stage.bubbles.addChild(smoke);
	const puffs: { x: number; y: number; t: number }[] = [];

	let tf: TrainFrame | null = null;
	let canvas: HTMLCanvasElement | null = null;
	let ctx: CanvasRenderingContext2D | null = null;
	let img: ImageData | null = null;
	let sprite: Sprite | null = null;
	let state: State = 'away';
	let t = 0;
	let x = HIDDEN_X;
	let masked = NaN;
	let puffT = 0;

	/** Render the train the first time it is needed. */
	const ensure = (): void => {
		if (sprite) return;
		tf = trainFrame();
		canvas = toCanvas(tf.frame);
		ctx = canvas.getContext('2d')!;
		img = ctx.createImageData(tf.frame.w, tf.frame.h);
		sprite = new Sprite(Texture.from(canvas));
		sprite.visible = false;
		stage.layer.addChild(sprite);
	};

	/**
	 * Place the sprite for the current x and hide what is inside the wall.
	 */
	const draw = (): void => {
		if (!sprite || !tf || !ctx || !img || !canvas) return;
		const [sx, sy] = project(scene.base, [x, TRACK.y, 0]);
		const left = Math.round(sx - tf.frame.ax), top = Math.round(sy - tf.frame.ay);
		sprite.position.set(left, top);
		sprite.visible = x > HIDDEN_X + 1;
		if (masked === x) return;
		masked = x;
		const src = tf.frame.rgba, dst = img.data, { w, h } = tf.frame;
		for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
			const k = j * w + i, o = k * 4;
			const lx = tf.lx[k];
			if (Number.isNaN(lx) || !src[o + 3]) { dst[o + 3] = 0; continue; }
			const wx = lx + x;
			if (wx >= 0) { dst[o] = src[o]; dst[o + 1] = src[o + 1]; dst[o + 2] = src[o + 2]; dst[o + 3] = src[o + 3]; continue; }
			// Inside the wall: seen only through the open doorway, in the tunnel's shadow.
			if (state !== 'away' && inDoorway(left + i, top + j) && tf.lz[k] < GOODS_DOOR.h - 2) {
				const dim = Math.max(0.12, 0.45 + wx / 120);
				dst[o] = src[o] * dim; dst[o + 1] = src[o + 1] * dim; dst[o + 2] = src[o + 2] * dim; dst[o + 3] = src[o + 3];
			} else dst[o + 3] = 0;
		}
		ctx.putImageData(img, 0, 0);
		sprite.texture.source.update();
	};

	/**
	 * Show the door state for a fraction open.
	 *
	 * @param f 0 shut to 1 open.
	 */
	const setDoors = (f: number): void => {
		const k = Math.max(0, Math.min(states.length - 1, Math.round(f * (states.length - 1))));
		doors.texture = doorTex[k];
		doors.position.set(states[k].x, states[k].y);
	};

	/**
	 * Drift and fade the smoke, and puff more while the chimney is out of the tunnel.
	 *
	 * @param dt Milliseconds.
	 */
	const smokeTick = (dt: number): void => {
		const chimneyX = x - 16;
		if (sprite?.visible && chimneyX > 4 && state !== 'away') {
			puffT += dt;
			const every = state === 'stopped' ? 700 : 260;
			while (puffT >= every) {
				puffT -= every;
				const [px, py] = project(scene.base, [chimneyX, TRACK.y, 74]);
				puffs.push({ x: px, y: py, t: 0 });
			}
		}
		smoke.clear();
		for (let i = puffs.length - 1; i >= 0; i--) {
			const p = puffs[i];
			p.t += dt;
			if (p.t > 2600) { puffs.splice(i, 1); continue; }
			const k = p.t / 2600;
			smoke.circle(Math.round(p.x - k * 10), Math.round(p.y - k * 46), 3 + k * 7).fill({ color: 0xd8d4cc, alpha: 0.55 * (1 - k) });
		}
	};

	/**
	 * Move to the next state.
	 *
	 * @param s State.
	 */
	const go = (s: State): void => { state = s; t = 0; };

	return {
		get state() { return state; },
		arrive() {
			ensure();
			x = HIDDEN_X;
			masked = NaN;
			go('opening');
		},
		leave() {
			if (state !== 'away') go('leaving');
		},
		tick(dt) {
			t += dt;
			switch (state) {
				case 'opening':
					setDoors(Math.min(1, t / DOORS_MS));
					if (t >= DOORS_MS) go('arriving');
					break;
				case 'arriving': {
					const k = Math.min(1, t / ARRIVE_MS);
					x = HIDDEN_X + (TRACK.stopX - HIDDEN_X) * easeOut(k);
					if (k >= 1) go('stopped');
					break;
				}
				case 'leaving': {
					const k = Math.min(1, t / LEAVE_MS);
					x = TRACK.stopX + (HIDDEN_X - TRACK.stopX) * easeIn(k);
					if (k >= 1) go('closing');
					break;
				}
				case 'closing':
					setDoors(Math.max(0, 1 - t / DOORS_MS));
					if (t >= DOORS_MS) go('away');
					break;
				default:
			}
			draw();
			smokeTick(dt);
		},
		sortable() {
			if (!sprite || !sprite.visible) return null;
			return {
				sprite,
				actor: { id: 'train', pos: [x, TRACK.y, 0], foot: { x0: Math.max(0, x - TRAIN_LEN), x1: Math.max(1, x + 4), y0: TRACK.y - TRAIN_HALF_W, y1: TRACK.y + TRAIN_HALF_W, z0: 0 } },
			};
		},
	};
}
