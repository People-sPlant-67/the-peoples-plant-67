/**
 * The гардероб's attendant: a stern babushka behind her counter in the Palace of
 * Culture. She is scenery, not a comrade from Paperclip: she stands at her place facing the
 * counter, and while anyone at it has nothing on she turns her back and reads her newspaper.
 * Drawn from the same frame bank as the comrades, and depth-sorted with them (an extra, like the
 * train).
 */
import { Sprite, Texture } from 'pixi.js';
import { ANIMS, type Anim, type Dir, SPRITE } from '../art/avatar';
import { ATTENDANT } from '../art/outfits';
import { type Actor, type Scene, feetOnScreen } from '../art/scene';
import type { World } from '../world/types';
import type { FrameBank } from './frames';

/** Her actor id in the depth sort. */
export const BABUSHKA = 'babushka';
/** Which way she reads with her back turned: away from the comrade and the room. */
export const AWAY: Dir = 'NE';

export interface Babushka {
	/**
	 * Turn away behind the newspaper, or back to the counter.
	 *
	 * @param away True to turn away.
	 */
	turn(away: boolean): void;
	readonly away: boolean;
	/** Hand a numbered token across the counter, once; not while turned away. */
	hand(): void;
	/** Her actor and sprite, for the depth sort. */
	extra(): { actor: Actor; sprite: Sprite };
	/** Move her animation along. */
	tick(dt: number): void;
}

/**
 * Put the attendant at her counter.
 *
 * @param scene The plant's scene.
 * @param world The world (for her mark).
 * @param frames The frame bank.
 * @param layer Where she is drawn (the depth-sorted layer).
 * @param layer.addChild Adds her sprite.
 * @returns Babushka.
 */
export function createBabushka(scene: Scene, world: World, frames: FrameBank, layer: { addChild(s: Sprite): unknown }): Babushka {
	const mark = world.marks.attendant;
	const sprite = new Sprite(Texture.EMPTY);
	layer.addChild(sprite);
	frames.retain(ATTENDANT.id);
	// She never walks anywhere.
	frames.still(ATTENDANT.id);
	const [fx, fy] = feetOnScreen(scene, mark.pos);
	sprite.position.set(fx - SPRITE.ax, fy - SPRITE.ay);
	const actor: Actor = { id: BABUSHKA, pos: mark.pos };
	let away = false;
	let anim: Anim = 'idle';
	let dir: Dir = mark.dir;
	let frame = 0, frameT = 0;
	let wanted = '';

	return {
		turn(a) {
			if (a === away) return;
			away = a;
			anim = a ? 'lurk' : 'idle';
			dir = a ? AWAY : mark.dir;
			frame = 0;
			frameT = 0;
		},
		get away() { return away; },
		hand() {
			if (away) return;
			anim = 'token';
			frame = 0;
			frameT = 0;
		},
		extra: () => ({ actor, sprite }),
		tick(dt) {
			const durations = ANIMS[anim];
			frameT += dt;
			while (frameT >= durations[frame]) {
				frameT -= durations[frame];
				frame = (frame + 1) % durations.length;
				// The token is handed over once, then she stands as before.
				if (frame === 0 && anim === 'token') anim = 'idle';
			}
			const view = `${anim}|${dir}`;
			if (view !== wanted) { wanted = view; frames.want(ATTENDANT, anim, dir); }
			// Hold the last frame until the wanted one arrives from the workers.
			const f = frames.get(ATTENDANT, anim, dir, frame);
			if (f) sprite.texture = f.tex;
		},
	};
}
