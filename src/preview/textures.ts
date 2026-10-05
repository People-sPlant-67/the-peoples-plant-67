/**
 * Turning rendered pixels into Pixi objects, shared by the art previewer and the cockpit.
 */
import { Sprite, Texture } from 'pixi.js';
import { toCanvas } from '../art/render';
import type { Scene } from '../art/scene';
import type { SpritePixels } from '../art/sprite-job';

/**
 * Put a worker's pixels on a canvas.
 *
 * @param px Pixels from a render worker.
 * @returns Canvas the size of the frame.
 */
export function pixelsToCanvas(px: SpritePixels): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = px.w; canvas.height = px.h;
	// The buffer was transferred from the worker and is ours alone, so no copy is needed.
	canvas.getContext('2d')!.putImageData(new ImageData(px.rgba as Uint8ClampedArray<ArrayBuffer>, px.w, px.h), 0, 0);
	return canvas;
}

/**
 * One sprite per prop of a scene, already placed in base-layer pixels.
 *
 * @param scene Scene.
 * @returns Sprites keyed by prop id.
 */
export function propSprites(scene: Scene): Map<string, Sprite> {
	return new Map(scene.props.map((p) => {
		const sp = new Sprite(Texture.from(toCanvas(p.sprite)));
		sp.position.set(p.x, p.y);
		return [p.id, sp] as const;
	}));
}

/**
 * A texture from pixels.
 *
 * @param w Width.
 * @param h Height.
 * @param rgba Pixels.
 * @returns Texture.
 */
export function textureOf(w: number, h: number, rgba: Uint8ClampedArray): Texture {
	const c = document.createElement('canvas');
	c.width = w; c.height = h;
	c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
	return Texture.from(c);
}
