/**
 * Comrade frames as Pixi textures, rendered by the sprite client's worker pool (or on the main
 * thread if workers cannot start). The frame on screen is asked for first; each comrade's
 * current animation and direction next; then, in the background, the walk cycle in all 8
 * directions (what a status change needs next). Nothing else is baked ahead: work and shiver
 * in other directions are rendered when first needed.
 *
 * Memory is capped: ready frames live in a least-recently-used map of MAX_FRAMES. Every frame
 * a comrade is showing is touched each tick, so a frame on screen is never evicted. Outfits
 * are reference-counted, because two comrades can share one, and an outfit's frames are
 * cancelled and destroyed when the last comrade wearing it leaves.
 */
import { Texture } from 'pixi.js';
import { ANIMS, type Anim, DIRS, type Dir } from '../art/avatar';
import type { Outfit } from '../art/outfits';
import { type SpritePixels, spriteKey } from '../art/sprite-job';
import { isCancelled } from '../preview/render-queue';
import { PRI, type SpriteClient } from '../preview/sprite-client';
import { pixelsToCanvas } from '../preview/textures';
import { createLru } from './lru';

/**
 * Most frames held at once. A frame is 84×112 RGBA (about 37 KB, held once as a canvas and
 * once on the GPU), so 1,024 frames is roughly 75 MB in all: about 25 comrades' walk cycles
 * plus their current animation.
 */
export const MAX_FRAMES = 1024;

/** A frame ready to draw, plus the head-top point for bubbles (sprite pixels). */
export interface ReadyFrame { key: string; tex: Texture; top: { x: number; y: number } }

export interface FrameBank {
	/** The frame if it has arrived; otherwise asks for it at the top priority and returns null. */
	get(outfit: Outfit, anim: Anim, dir: Dir, frame: number): ReadyFrame | null;
	/** Queue this animation and direction now, and the outfit's walk cycle in the background (once). */
	want(outfit: Outfit, anim: Anim, dir: Dir): void;
	/** Mark a frame still on screen (held while its successor renders) as in use. */
	touch(key: string): void;
	/**
	 * Never bake a walk cycle for this outfit: it is only ever seen standing (a step of changing,
	 * the cloakroom's attendant). Forgotten when the outfit is let go.
	 *
	 * @param outfitId Outfit.
	 */
	still(outfitId: string): void;
	/** A comrade started wearing this outfit. */
	retain(outfitId: string): void;
	/** A comrade stopped wearing this outfit; the last one out frees its frames. */
	release(outfitId: string): void;
	/** Frames held, for the status line. */
	readonly size: number;
	describe(): string;
}

/**
 * Turn worker pixels into a texture.
 *
 * @param key Frame key.
 * @param px Pixels and head-top point.
 * @returns Ready frame.
 */
function toReady(key: string, px: SpritePixels): ReadyFrame {
	return { key, tex: Texture.from(pixelsToCanvas(px)), top: px.top };
}

/**
 * Create the bank.
 *
 * @param client Sprite client (worker pool plus queue).
 * @param onError Reports a frame that failed to render (not a cancellation).
 * @returns Frame bank.
 */
export function createFrameBank(client: SpriteClient, onError: (err: unknown) => void): FrameBank {
	const asked = new Set<string>();
	const ready = createLru<ReadyFrame>(MAX_FRAMES, (key, v) => {
		// Evicted: forget it was asked for, so it is rendered again if it is ever needed.
		asked.delete(key);
		v.tex.destroy(true);
	});
	const refs = new Map<string, number>();
	const baked = new Set<string>();
	/** Outfits only ever seen standing. */
	const stills = new Set<string>();

	/**
	 * Ask for one frame unless it is already here or on its way.
	 *
	 * @param o Outfit.
	 * @param anim Animation.
	 * @param dir Direction.
	 * @param f Frame index.
	 * @param priority Queue level.
	 */
	const ask = (o: Outfit, anim: Anim, dir: Dir, f: number, priority: number): void => {
		const key = spriteKey(o.id, anim, dir, f);
		if (ready.has(key)) return;
		// Asking again at a more urgent level moves a queued job up; the queue shares the promise.
		const first = !asked.has(key);
		asked.add(key);
		const p = client.request(o, anim, dir, f, priority);
		if (!first) return;
		p.then((px) => {
			// The outfit may have been released while this frame was in a worker: nothing
			// would ever destroy the texture, so do not make one.
			if (!refs.get(o.id)) return;
			if (!ready.has(key)) ready.set(key, toReady(key, px));
		}).catch((err) => {
			asked.delete(key);
			if (!isCancelled(err)) onError(err);
		});
	};

	return {
		get size() { return ready.size; },
		describe: () => client.describe(),
		get(o, anim, dir, frame) {
			const hit = ready.get(spriteKey(o.id, anim, dir, frame));
			if (hit) return hit;
			ask(o, anim, dir, frame, PRI.VISIBLE);
			return null;
		},
		want(o, anim, dir) {
			for (let f = 0; f < ANIMS[anim].length; f++) ask(o, anim, dir, f, PRI.ANIM);
			if (baked.has(o.id) || stills.has(o.id)) return;
			baked.add(o.id);
			// Walking in every direction: it is what a status change needs next.
			for (const d of DIRS) for (let f = 0; f < ANIMS.walk.length; f++) ask(o, 'walk', d, f, PRI.PREBAKE);
		},
		still(id) {
			stills.add(id);
		},
		touch(key) {
			ready.touch(key);
		},
		retain(id) {
			refs.set(id, (refs.get(id) ?? 0) + 1);
		},
		release(id) {
			const n = (refs.get(id) ?? 0) - 1;
			if (n > 0) { refs.set(id, n); return; }
			refs.delete(id);
			baked.delete(id);
			stills.delete(id);
			client.drop(id);
			const prefix = `${id}|`;
			for (const k of [...asked]) if (k.startsWith(prefix)) asked.delete(k);
			for (const k of [...ready.keys()]) {
				if (!k.startsWith(prefix)) continue;
				ready.get(k)!.tex.destroy(true);
				ready.delete(k);
			}
		},
	};
}
