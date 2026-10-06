/**
 * The toolbar icon: a 16x16 red star with a gold rim, scaled up with hard pixel edges for the
 * other sizes Chrome asks for. The build writes the PNGs (scripts/build-extension.ts), so the
 * repo holds no image files for it.
 */

/** One row per line: R red, Y gold, anything else transparent. */
const STAR = [
	'................',
	'.......YY.......',
	'.......RR.......',
	'......YRRY......',
	'......RRRR......',
	'YYYYYRRRRRRYYYYY',
	'.YRRRRRRRRRRRRY.',
	'..YRRRRRRRRRRY..',
	'...YRRRRRRRRY...',
	'....RRRRRRRR....',
	'...YRRRRRRRRY...',
	'...RRRRYYRRRR...',
	'..YRRRY..YRRRY..',
	'..RRY......YRR..',
	'.YY..........YY.',
	'................',
];

const COLOURS: Record<string, [number, number, number]> = { R: [189, 53, 44], Y: [244, 213, 138] };

/** Sizes Chrome uses: toolbar (16, 32 on high-density screens), the extensions page (48), install (128). */
export const ICON_SIZES = [16, 32, 48, 128] as const;

/**
 * The star as RGBA pixels at a size that is a whole multiple of 16.
 *
 * @param {number} size Width and height in pixels.
 * @returns {Uint8ClampedArray} RGBA, row by row.
 */
export function starPixels(size: number): Uint8ClampedArray {
	if (size % STAR.length) throw new Error(`The icon size must be a multiple of ${STAR.length}.`);
	const k = size / STAR.length;
	const out = new Uint8ClampedArray(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const c = COLOURS[STAR[Math.floor(y / k)][Math.floor(x / k)]];
			if (!c) continue;
			const o = (y * size + x) * 4;
			out.set([c[0], c[1], c[2], 255], o);
		}
	}
	return out;
}
