/**
 * Turn a photo into a portrait: crop it to the frame's shape, shrink it to 20 × 26, and paint
 * every pixel in the nearest colour of the plant's palette (or, for a sepia print, the nearest
 * old-print brown by brightness). The photo stays in the browser and is not kept; only the
 * pixels are.
 */
import { PORTRAIT_H, PORTRAIT_PALETTE, PORTRAIT_W, type Portrait, SEPIA_PALETTE } from '../art/archetypes';

/** Photos bigger than this are refused before decoding (bytes). */
const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
/** Photos with more pixels than this are refused before decoding: a small file can unpack huge. */
const PHOTO_MAX_PIXELS = 40_000_000;
const TOO_BIG = 'That photo is too large to shrink here. Choose one under 40 megapixels.';

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
	// A small file can unpack to gigabytes, so the size in its header is checked before decoding.
	const size = headerSize(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
	// Only pictures whose size can be read before decoding are taken: PNG, JPEG, GIF and WebP.
	if (!size) throw new Error('The plant cannot check the size of that photo. Save it as a JPEG or PNG and try again.');
	if (size.w * size.h > PHOTO_MAX_PIXELS) throw new Error(TOO_BIG);
	let img: ImageBitmap;
	try { img = await createImageBitmap(file); } catch { throw new Error('That file is not a picture the browser can open. Try a JPEG or PNG.'); }
	try {
		if (img.width * img.height > PHOTO_MAX_PIXELS) throw new Error(TOO_BIG);
		return shrink(img, img.width, img.height, sepia);
	} finally {
		img.close();
	}
}

/** How much of a file's start is read for its size. JPEG puts it after the metadata, so be generous. */
const HEADER_BYTES = 2 * 1024 * 1024;

/**
 * A picture's size from the start of its file, for PNG, GIF, WebP and JPEG.
 *
 * @param b The file's first bytes.
 * @returns Width and height, or null for a format or header it cannot read.
 */
export function headerSize(b: Uint8Array): { w: number; h: number } | null {
	const u16 = (i: number, le = false): number => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
	const u32 = (i: number): number => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
	const ascii = (i: number, n: number): string => String.fromCharCode(...b.subarray(i, i + n));
	const sized = (s: { w: number; h: number } | null): { w: number; h: number } | null => (s && s.w > 0 && s.h > 0 ? s : null);
	if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return sized({ w: u32(16), h: u32(20) });
	if (b.length >= 13 && ascii(0, 3) === 'GIF') {
		// The browser grows the picture to its first frame, which may be far larger than the
		// screen size in the header: walk past the colour table and extensions to that frame.
		let i = 13;
		if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
		while (i < b.length) {
			if (b[i] === 0x21) {
				i += 2;
				while (i < b.length && b[i] !== 0) i += b[i] + 1;
				i++;
				continue;
			}
			if (b[i] !== 0x2c || i + 9 > b.length) return null;
			return sized({ w: Math.max(u16(6, true), u16(i + 1, true) + u16(i + 5, true)), h: Math.max(u16(8, true), u16(i + 3, true) + u16(i + 7, true)) });
		}
		return null;
	}
	if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
		const kind = ascii(12, 4);
		if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
		if (kind === 'VP8L') return { w: 1 + (b[21] | ((b[22] & 0x3f) << 8)), h: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) };
		if (kind === 'VP8 ') return sized({ w: u16(26, true) & 0x3fff, h: u16(28, true) & 0x3fff });
		return null;
	}
	if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
		// Walk the JPEG's segments to the frame header (SOF0 to SOF15, except DHT, JPG and DAC).
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) return null;
			// Any number of 0xFF fill bytes may come before a marker.
			while (b[i + 1] === 0xff && i + 2 < b.length) i++;
			if (i + 9 >= b.length) return null;
			const m = b[i + 1];
			if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
			if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return sized({ w: u16(i + 7), h: u16(i + 5) });
			i += 2 + u16(i + 2);
		}
	}
	return null;
}

/**
 * Crop, shrink and snap a loaded picture.
 *
 * @param img The picture.
 * @param w Its width.
 * @param h Its height.
 * @param sepia Sepia print.
 * @returns Portrait.
 * @throws Error when the browser cannot draw here.
 */
function shrink(img: CanvasImageSource, w: number, h: number, sepia: boolean): Portrait {
	const c = document.createElement('canvas');
	c.width = PORTRAIT_W; c.height = PORTRAIT_H;
	const ctx = c.getContext('2d');
	if (!ctx) throw new Error('This browser cannot shrink pictures here.');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	const r = coverCrop(w, h);
	ctx.drawImage(img, r.x, r.y, r.w, r.h);
	return snapToPalette(ctx.getImageData(0, 0, PORTRAIT_W, PORTRAIT_H).data, sepia);
}
