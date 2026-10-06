/**
 * Minimal PNG writer for the offline render scripts (no browser, no image library).
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

/**
 * CRC32 as PNG chunks require.
 *
 * @param {Buffer} b Bytes.
 * @returns {number} CRC.
 */
function crc32(b: Buffer): number {
	let c = 0xffffffff;
	for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * Wrap data in a PNG chunk.
 *
 * @param {string} type Chunk type.
 * @param {Buffer} data Payload.
 * @returns {Buffer} Chunk bytes.
 */
function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
}

/** An RGBA image in memory. */
export interface Image {
	w: number;
	h: number;
	rgba: Uint8ClampedArray;
}

/**
 * Create a blank RGBA image filled with one colour.
 *
 * @param {number} w Width.
 * @param {number} h Height.
 * @param {number[]} rgb Fill colour.
 * @returns {Image} Image.
 */
export function blank(w: number, h: number, rgb: number[]): Image {
	const rgba = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) { rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2]; rgba[i * 4 + 3] = 255; }
	return { w, h, rgba };
}

/**
 * Alpha-composite `src` onto `dst` with its top-left at (x, y).
 *
 * @param {Image} dst Destination.
 * @param {Image} src Source.
 * @param {number} x Left.
 * @param {number} y Top.
 */
export function blit(dst: Image, src: Image, x: number, y: number): void {
	// Fractional offsets would index between channels and scramble colours.
	x = Math.round(x); y = Math.round(y);
	for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) {
		const dx = x + i, dy = y + j;
		if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
		const s = (j * src.w + i) * 4, d = (dy * dst.w + dx) * 4;
		const a = src.rgba[s + 3] / 255;
		if (!a) continue;
		for (let c = 0; c < 3; c++) dst.rgba[d + c] = src.rgba[s + c] * a + dst.rgba[d + c] * (1 - a);
		dst.rgba[d + 3] = 255;
	}
}

/**
 * Encode an image as an opaque PNG, upscaled by an integer factor with nearest neighbour.
 *
 * @param {Image} img Image (transparent pixels are flattened onto `bg`).
 * @param {number} scale Integer scale.
 * @param {number[]} bg Background colour.
 * @param {[number, number, number, number]} crop Optional x, y, w, h crop applied before scaling.
 * @returns {Buffer} PNG bytes.
 */
export function encodePng(img: Image, scale = 1, bg = [150, 148, 142], crop?: [number, number, number, number]): Buffer {
	const [cx, cy, cw, ch] = crop ?? [0, 0, img.w, img.h];
	const W = cw * scale, H = ch * scale;
	const raw = Buffer.alloc((W * 3 + 1) * H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const sx = cx + Math.floor(x / scale), sy = cy + Math.floor(y / scale);
			const o = y * (W * 3 + 1) + 1 + x * 3;
			if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) { raw[o] = bg[0]; raw[o + 1] = bg[1]; raw[o + 2] = bg[2]; continue; }
			const k = (sy * img.w + sx) * 4, a = img.rgba[k + 3] / 255;
			for (let c = 0; c < 3; c++) raw[o + c] = Math.round(img.rgba[k + c] * a + bg[c] * (1 - a));
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Encode RGBA pixels as a PNG that keeps transparency, at their own size.
 *
 * @param {number} w Width.
 * @param {number} h Height.
 * @param {Uint8ClampedArray} rgba Pixels, row by row.
 * @returns {Buffer} PNG bytes.
 */
export function encodePngRgba(w: number, h: number, rgba: Uint8ClampedArray): Buffer {
	const raw = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
