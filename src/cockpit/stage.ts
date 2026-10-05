/**
 * The Pixi stage: the plant's base layer, one sprite per prop, a depth-sorted layer where
 * props and comrades are painted back to front, and a top layer for speech bubbles. The whole
 * world moves and scales as one container under the camera.
 */
import { Application, Container, Graphics, Sprite, Texture, TextureStyle } from 'pixi.js';
import { toCanvas } from '../art/render';
import type { Scene } from '../art/scene';
import { HAZE } from '../art/wasteland';
import type { Piece } from './backdrop';
import { propSprites } from '../preview/textures';
import type { Cam, Size } from './camera';

export interface Stage {
	app: Application;
	/** Props and comrades; zIndex sets the painting order (see comrades.ts). */
	layer: Container;
	/** Things painted on the walls that change (the goods doors), under everything that stands. */
	wall: Container;
	/** Marks on the floor under everything that stands (the selection ring). */
	floor: Graphics;
	/** Repaint the base layer after its pixels changed (the group photo). */
	refreshBase(): void;
	/**
	 * Add a piece of the wasteland behind the plant (it stays hidden until showBackdrop).
	 *
	 * @param p Piece, in base-layer pixels.
	 */
	addBackdrop(p: Piece): void;
	/** Fade the wasteland in. */
	showBackdrop(): void;
	/** Take away every piece of the wasteland placed so far. */
	clearBackdrop(): void;
	/** Things far out in the wasteland that move (the far train, smoke): over it, behind the plant, and faded in with it. */
	far: Container;
	/** Speech bubbles, above everything. */
	bubbles: Container;
	props: Map<string, Sprite>;
	/** World size in world pixels. */
	size: Size;
	/** Move and scale the world for a camera. */
	setCamera(cam: Cam): void;
}

/** How long the wasteland takes to fade in once baked (ms). */
const BACKDROP_FADE_MS = 600;

/**
 * Start Pixi inside a host element and lay out the plant.
 *
 * @param host Element to fill; the canvas follows its size.
 * @param scene The plant's scene.
 * @returns Stage.
 */
export async function createStage(host: HTMLElement, scene: Scene): Promise<Stage> {
	// Nearest-neighbour everywhere: the art is pixels and zoom is whole steps only.
	TextureStyle.defaultOptions.scaleMode = 'nearest';
	const app = new Application();
	// The wasteland fades into this haze, so past its edge the stage is the same colour.
	await app.init({ resizeTo: host, background: HAZE, antialias: false, resolution: 1, preference: 'webgl' });
	host.append(app.canvas);

	const world = new Container();
	const back = new Container();
	back.alpha = 0;
	const base = new Sprite(Texture.from(toCanvas(scene.base)));
	const wall = new Container();
	const floor = new Graphics();
	const layer = new Container();
	layer.sortableChildren = true;
	const bubbles = new Container();
	const far = new Container();
	far.alpha = 0;
	world.addChild(back, far, base, wall, floor, layer, bubbles);
	app.stage.addChild(world);

	const props = propSprites(scene);
	for (const sp of props.values()) layer.addChild(sp);

	return {
		app, layer, wall, floor, bubbles, props, far,
		refreshBase() {
			const old = base.texture;
			base.texture = Texture.from(toCanvas(scene.base));
			old.destroy(true);
		},
		addBackdrop(p) {
			// The sprite takes its place now, so pieces stay in order; its picture follows, from a
			// bitmap rather than a canvas kept alive behind the texture.
			const sp = new Sprite(Texture.EMPTY);
			sp.position.set(p.x, p.y);
			back.addChild(sp);
			const img = new ImageData(p.rgba as Uint8ClampedArray<ArrayBuffer>, p.w, p.h);
			createImageBitmap(img).then((bmp) => { sp.texture = Texture.from(bmp); }, () => {
				const c = document.createElement('canvas');
				c.width = p.w; c.height = p.h;
				c.getContext('2d')!.putImageData(img, 0, 0);
				sp.texture = Texture.from(c);
			});
		},
		clearBackdrop() {
			for (const sp of back.removeChildren()) sp.destroy({ texture: true, textureSource: true });
		},
		showBackdrop() {
			/** Raise the backdrop a step each frame until it is fully in. */
			const fade = (tk: { deltaMS: number }): void => {
				back.alpha = Math.min(1, back.alpha + tk.deltaMS / BACKDROP_FADE_MS);
				far.alpha = back.alpha;
				if (back.alpha >= 1) app.ticker.remove(fade);
			};
			app.ticker.add(fade);
		},
		size: { w: scene.base.w, h: scene.base.h },
		setCamera(cam) {
			world.scale.set(cam.zoom);
			// Whole screen pixels, so the art never lands between pixels and blurs.
			world.position.set(Math.round(-cam.x * cam.zoom), Math.round(-cam.y * cam.zoom));
		},
	};
}
