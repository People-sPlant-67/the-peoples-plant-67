/**
 * Turn a photo into a portrait: crop it to the frame's shape, shrink it to 20 × 26, and paint
 * every pixel in the nearest colour of the plant's palette (or, for a sepia print, the nearest
 * old-print brown by brightness). The photo stays in the browser and is not kept; only the
 * pixels are.
 */
import { PORTRAIT_H, PORTRAIT_PALETTE, PORTRAIT_W, type Portrait, SEPIA_PALETTE } from '../art/archetypes';

/** Photos bigger than this are refused before decoding (bytes). */
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024;

/**
 * A "#rrggbb" colour as numbers.
 *
 * @param hex Colour.
 * @returns Red, green, blue.
 */
function rgbOf(hex: string): [number, number, number] {
	return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * Perceived brightness, 0 to 255.
 *
 * @param r Red.
 * @param g Green.
 * @param b Blue.
 * @returns Brightness.
 */
const luma = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b;

/**
 * Snap shrunk photo pixels to the palette.
 *
 * @param rgba PORTRAIT_W × PORTRAIT_H pixels, RGBA. Transparent pixels count as the dark ground.
 * @param sepia Use the sepia browns, matched on brightness alone.
 * @returns Portrait.
 */
export function snapToPalette(rgba: ArrayLike<number>, sepia: boolean): Portrait {
	const pal = (sepia ? SEPIA_PALETTE : PORTRAIT_PALETTE).map((hex) => ({ hex, rgb: rgbOf(hex), l: luma(...rgbOf(hex)) }));
	const out: Portrait = [];
	for (let y = 0; y < PORTRAIT_H; y++) {
		const row: string[] = [];
		for (let x = 0; x < PORTRAIT_W; x++) {
			const k = (y * PORTRAIT_W + x) * 4;
			const a = (rgba[k + 3] ?? 255) / 255;
			// Over the dark ground, as the frame would show a see-through pixel.
			const [r, g, b] = [0, 1, 2].map((c) => (rgba[k + c] ?? 0) * a + pal[0].rgb[c] * (1 - a));
			let best = pal[0], bd = Infinity;
			for (const p of pal) {
				// Weighted the way the eye weighs the channels, so faces keep their tones.
				const d = sepia ? Math.abs(p.l - luma(r, g, b)) : 0.3 * (p.rgb[0] - r) ** 2 + 0.59 * (p.rgb[1] - g) ** 2 + 0.11 * (p.rgb[2] - b) ** 2;
				if (d < bd) { bd = d; best = p; }
			}
			row.push(best.hex);
		}
		out.push(row);
	}
	return out;
}

/**
 * Where to draw a w × h photo so it covers the frame, cropped evenly at the sides, and from a
 * little above the middle top to bottom (faces sit high in most photos).
 *
 * @param w Photo width.
 * @param h Photo height.
 * @returns Offset and size, in portrait pixels.
 */
export function coverCrop(w: number, h: number): { x: number; y: number; w: number; h: number } {
	const s = Math.max(PORTRAIT_W / w, PORTRAIT_H / h);
	const dw = w * s, dh = h * s;
	return { x: (PORTRAIT_W - dw) / 2, y: (PORTRAIT_H - dh) / 2.6, w: dw, h: dh };
}

/**
 * A photo file as a portrait.
 *
 * @param file The chosen file.
 * @param sepia Sepia print.
 * @returns Portrait.
 * @throws Error with a sentence for the owner when the file is too big or is not a picture.
 */
export async function photoToPortrait(file: Blob, sepia: boolean): Promise<Portrait> {
	if (file.size > PHOTO_MAX_BYTES) throw new Error('That photo is over 20 MB. Choose a smaller one.');
	let img: ImageBitmap;
	try { img = await createImageBitmap(file); } catch { throw new Error('That file is not a picture the browser can open. Try a JPEG or PNG.'); }
	const c = document.createElement('canvas');
	c.width = PORTRAIT_W; c.height = PORTRAIT_H;
	const ctx = c.getContext('2d');
	if (!ctx) throw new Error('This browser cannot shrink pictures here.');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	const r = coverCrop(img.width, img.height);
	ctx.drawImage(img, r.x, r.y, r.w, r.h);
	img.close();
	return snapToPalette(ctx.getImageData(0, 0, PORTRAIT_W, PORTRAIT_H).data, sepia);
}
