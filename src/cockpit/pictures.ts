/**
 * Pictures of the life around the plant, asked of the sprite workers once each and kept as textures
 * (the pigeons and smoke, the parade's flags and banner, Sputnik and the bear). Also whether the
 * computer asks for less motion, which all of them heed.
 */
import type { Texture } from 'pixi.js';
import { type AmbientRequest, type SpritePixels, ambientKey } from '../art/sprite-job';
import { textureOf } from '../preview/textures';

/** A picture ready to draw: its texture and where its anchor is in it. */
export interface Picture { tex: Texture; ax: number; ay: number }

/**
 * A store of pictures: each is asked for on first use and is null until it has been drawn.
 *
 * @param render Draws a picture in the sprite workers.
 * @param makeTexture Makes a texture from pixels; tests pass one that needs no canvas.
 * @returns Look a picture up, asking for it the first time.
 */
export function createPictures(render: (req: AmbientRequest) => Promise<SpritePixels>, makeTexture: (w: number, h: number, rgba: Uint8ClampedArray) => Texture = textureOf): (req: AmbientRequest) => Picture | null {
	const pics = new Map<string, Picture | 'asked'>();
	return (req) => {
		const key = ambientKey(req);
		const p = pics.get(key);
		if (p && p !== 'asked') return p;
		if (!p) {
			pics.set(key, 'asked');
			render(req).then((px) => pics.set(key, { tex: makeTexture(px.w, px.h, px.rgba), ax: px.top.x, ay: px.top.y }), (err: unknown) => { pics.delete(key); console.error(err); });
		}
		return null;
	};
}

/**
 * Whether the computer asks for less motion.
 *
 * @returns True when it does.
 */
export const prefersLessMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
