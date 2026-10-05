/**
 * Minimap: the whole plant shrunk into a corner, a dot per comrade coloured by activity, and
 * a rectangle for what the camera sees. Click or drag on it to move the camera there.
 *
 * The coordinate mapping is pure and exported for tests/cockpit-maths.test.ts.
 */
import type { Frame } from '../art/render';
import type { Cam, Size } from './camera';

/** How the world fits the minimap. */
export interface MiniFit {
	/** Minimap pixels per world pixel. */
	scale: number;
	/** Minimap size in pixels (whole numbers). */
	w: number;
	h: number;
}

/**
 * Fit the world inside a box, keeping its shape.
 *
 * @param world World size, world pixels.
 * @param box Largest minimap size allowed.
 * @returns Scale and minimap size.
 */
export function miniFit(world: Size, box: Size): MiniFit {
	const scale = Math.min(box.w / world.w, box.h / world.h);
	return { scale, w: Math.max(1, Math.round(world.w * scale)), h: Math.max(1, Math.round(world.h * scale)) };
}

/**
 * World pixel to minimap pixel.
 *
 * @param m Fit.
 * @param p World point.
 * @returns Minimap point.
 */
export function toMini(m: MiniFit, p: { x: number; y: number }): { x: number; y: number } {
	return { x: p.x * m.scale, y: p.y * m.scale };
}

/**
 * Minimap pixel to world pixel. Points off the minimap are pulled onto its edge first, so a
 * drag that strays outside still aims somewhere in the world.
 *
 * @param m Fit.
 * @param p Minimap point.
 * @returns World point.
 */
export function fromMini(m: MiniFit, p: { x: number; y: number }): { x: number; y: number } {
	const x = Math.min(Math.max(p.x, 0), m.w), y = Math.min(Math.max(p.y, 0), m.h);
	return { x: x / m.scale, y: y / m.scale };
}

/**
 * The camera's view as a rectangle on the minimap.
 *
 * @param m Fit.
 * @param cam Camera.
 * @param view View size, CSS pixels.
 * @returns Rectangle in minimap pixels.
 */
export function viewportOnMini(m: MiniFit, cam: Cam, view: Size): { x: number; y: number; w: number; h: number } {
	return { x: cam.x * m.scale, y: cam.y * m.scale, w: (view.w / cam.zoom) * m.scale, h: (view.h / cam.zoom) * m.scale };
}

/** A dot on the minimap. */
export interface Dot { x: number; y: number; colour: string; alert: boolean }

export interface Minimap {
	el: HTMLElement;
	/** Redraw with comrades (world pixels) and the camera. */
	draw(dots: Dot[], cam: Cam, view: Size): void;
}

/**
 * Build the minimap.
 *
 * @param picture The flattened plant (base and props), drawn once, shrunk.
 * @param box Largest size for the minimap, CSS pixels.
 * @param onJump Called with a world point when the minimap is clicked or dragged.
 * @returns Minimap.
 */
export function createMinimap(picture: Frame, box: Size, onJump: (p: { x: number; y: number }) => void): Minimap {
	const fit = miniFit({ w: picture.w, h: picture.h }, box);
	const el = document.createElement('div');
	el.className = 'p67-minimap';
	el.setAttribute('role', 'img');
	el.setAttribute('aria-label', 'Map of the whole plant. Click to move the view there.');
	const canvas = document.createElement('canvas');
	canvas.width = fit.w; canvas.height = fit.h;
	el.append(canvas);
	const ctx = canvas.getContext('2d')!;

	// Shrink the plant once. Smoothing on: at a tenth of the size a blend reads better than dropped pixels.
	const back = document.createElement('canvas');
	back.width = fit.w; back.height = fit.h;
	const full = document.createElement('canvas');
	full.width = picture.w; full.height = picture.h;
	full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.w, picture.h), 0, 0);
	const bctx = back.getContext('2d')!;
	bctx.imageSmoothingEnabled = true;
	bctx.imageSmoothingQuality = 'high';
	bctx.drawImage(full, 0, 0, fit.w, fit.h);

	let dragging = false;
	/**
	 * Jump the camera to the world point under a pointer event.
	 *
	 * @param e Pointer event.
	 */
	const jump = (e: PointerEvent): void => {
		const r = canvas.getBoundingClientRect();
		onJump(fromMini(fit, { x: (e.clientX - r.left) * (fit.w / r.width), y: (e.clientY - r.top) * (fit.h / r.height) }));
	};
	canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); jump(e); });
	canvas.addEventListener('pointermove', (e) => { if (dragging) jump(e); });
	canvas.addEventListener('pointerup', () => { dragging = false; });
	canvas.addEventListener('pointercancel', () => { dragging = false; });

	return {
		el,
		draw(dots, cam, view) {
			ctx.clearRect(0, 0, fit.w, fit.h);
			ctx.drawImage(back, 0, 0);
			for (const d of dots) {
				const p = toMini(fit, d);
				const x = Math.round(p.x), y = Math.round(p.y);
				ctx.fillStyle = '#16171a';
				ctx.fillRect(x - 3, y - 3, 6, 6);
				ctx.fillStyle = d.colour;
				ctx.fillRect(x - 2, y - 2, 4, 4);
				// A red tick above the dot for anyone who needs the owner.
				if (d.alert) { ctx.fillStyle = '#e0503f'; ctx.fillRect(x - 1, y - 9, 2, 4); }
			}
			const v = viewportOnMini(fit, cam, view);
			ctx.strokeStyle = '#f4efe2';
			ctx.lineWidth = 1;
			ctx.strokeRect(Math.round(v.x) + 0.5, Math.round(v.y) + 0.5, Math.max(2, Math.round(v.w) - 1), Math.max(2, Math.round(v.h) - 1));
		},
	};
}
