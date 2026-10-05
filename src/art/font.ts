/**
 * Tiny Cyrillic pixel font (5px tall) for posters, boards and signs.
 * Only the glyphs the slogans need; add more as new signage appears.
 */

const G: Record<string, string[]> = {
	'А': ['.#.', '#.#', '###', '#.#', '#.#'],
	// Б is 4 wide so it cannot be mistaken for 5, which differs by a single pixel at 3 wide.
	'Б': ['####', '#...', '###.', '#..#', '###.'],
	// В is 4 wide: at 3 wide the wall shear opens its right side and it reads as E.
	'В': ['###.', '#..#', '###.', '#..#', '###.'],
	'Г': ['###', '#..', '#..', '#..', '#..'],
	'Д': ['.##.', '#.#.', '#.#.', '####', '#..#'],
	// Flat middle bar, one pixel short, so Е never reads as the digit 5 or as Б.
	'Е': ['###', '#..', '##.', '#..', '###'],
	// Ж is 5 wide: three stems meeting in the middle row.
	'Ж': ['#.#.#', '#.#.#', '.###.', '#.#.#', '#.#.#'],
	'З': ['##.', '..#', '.#.', '..#', '##.'],
	// И is 5 wide so its diagonal survives the 2:1 wall shear.
	'И': ['#...#', '#..##', '#.#.#', '##..#', '#...#'],
	// Й is И squeezed into four rows under a one-pixel breve: a wider breve closed it into an А.
	'Й': ['..#..', '#..##', '#.#.#', '##..#', '#...#'],
	'К': ['#.#', '##.', '#..', '##.', '#.#'],
	// Л needs its splayed left foot, or it reads as П.
	'Л': ['.###', '.#.#', '.#.#', '.#.#', '#..#'],
	// М is 5 wide: at 3 wide its peak fills in and it reads as Н or a block.
	'М': ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
	'Н': ['#.#', '#.#', '###', '#.#', '#.#'],
	'О': ['.#.', '#.#', '#.#', '#.#', '.#.'],
	'П': ['###', '#.#', '#.#', '#.#', '#.#'],
	'Р': ['##.', '#.#', '##.', '#..', '#..'],
	'С': ['.##', '#..', '#..', '#..', '.##'],
	'Т': ['###', '.#.', '.#.', '.#.', '.#.'],
	'У': ['#.#', '#.#', '.##', '..#', '##.'],
	'Х': ['#.#', '#.#', '.#.', '#.#', '#.#'],
	// Ц's tail drops below the right stem into the fifth row, so the body is 4 rows.
	'Ц': ['#.#.', '#.#.', '#.#.', '####', '...#'],
	// Ы is Ь plus a separate stem, 5 wide so the gap between them survives.
	'Ш': ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'],
	'Ы': ['#...#', '#...#', '##..#', '#.#.#', '##..#'],
	'Ь': ['#..', '#..', '##.', '#.#', '##.'],
	// Я is 4 wide with a splayed leg: at 3 wide it is a mirrored Р that reads as a 9.
	'Я': ['.###', '#..#', '.###', '.#.#', '#..#'],
	// № is an N plus a raised hollow o. A solid block over a bar read as a colon ("N:67").
	'№': ['#..#..#.', '##.#.#.#', '#.##..#.', '#..#....', '#..#....'],
	'!': ['#', '#', '#', '.', '#'],
	'—': ['...', '...', '###', '...', '...'],
	' ': ['..', '..', '..', '..', '..'],
	'0': ['###', '#.#', '#.#', '#.#', '###'],
	'1': ['.#', '##', '.#', '.#', '.#'],
	'2': ['##.', '..#', '.#.', '#..', '###'],
	// Flat-topped so 3 doesn't duplicate the round-topped Cyrillic З.
	'3': ['###', '..#', '.##', '..#', '###'],
	'5': ['###', '#..', '##.', '..#', '##.'],
	'6': ['.##', '#..', '###', '#.#', '###'],
	// A 3-wide open 4 is identical to Ч; the diagonal keeps it a digit.
	'4': ['..#.', '.##.', '#.#.', '####', '..#.'],
	'7': ['###', '..#', '.#.', '.#.', '.#.'],
	'8': ['###', '#.#', '###', '#.#', '###'],
	'9': ['###', '#.#', '###', '..#', '##.'],
	// 5 wide with 2x2 dots: the 3-wide version read as a 2.
	'%': ['##..#', '##.#.', '..#..', '.#.##', '#..##'],
	'…': ['...', '...', '...', '...', '#.#'],
};

/** Read-only view of the glyph table, for tests and tooling. */
export const GLYPHS: Readonly<Record<string, readonly string[]>> = G;

/** Longest string, in characters, that `drawText` and `textWidth` will handle; live text can be arbitrarily long. */
export const MAX_TEXT_CHARS = 64;

/**
 * Cap a string at MAX_TEXT_CHARS characters, ending an over-long one with '…'.
 * Counts code points, matching how the font iterates, so a surrogate pair is never split.
 *
 * @param {string} s Text.
 * @returns {string} The text, or its first MAX_TEXT_CHARS - 1 characters plus '…'.
 */
export function clampText(s: string): string {
	const chars = [...s];
	return chars.length <= MAX_TEXT_CHARS ? s : chars.slice(0, MAX_TEXT_CHARS - 1).join('') + '…';
}

/**
 * Measure a string in pixels (1px letter spacing). Text is capped by clampText first.
 *
 * @param {string} s Text.
 * @returns {number} Width in pixels.
 */
export function textWidth(s: string): number {
	let w = 0;
	for (const ch of clampText(s)) w += glyph(ch)[0].length + 1;
	return Math.max(0, w - 1);
}

/**
 * Drawn for any character the font lacks. A crossed, solid-edged box no real glyph uses,
 * so a missing character is obviously wrong rather than passing as a 0 or a blank.
 */
export const TOFU: readonly string[] = ['#####', '##.##', '#.#.#', '##.##', '#####'];

/**
 * Glyph rows for a character, falling back to the tofu box.
 *
 * @param {string} ch Character.
 * @returns {readonly string[]} Rows.
 */
function glyph(ch: string): readonly string[] {
	return G[ch] ?? TOFU;
}

/**
 * Characters in a string that the font cannot draw.
 *
 * @param {string} s Text.
 * @returns {string[]} Missing characters, deduplicated.
 */
export function missingGlyphs(s: string): string[] {
	return [...new Set([...s].filter((ch) => !G[ch]))];
}

/**
 * Draw text by calling `plot` for every lit pixel. Text is capped by clampText first.
 *
 * @param {string} s Text.
 * @param {number} x Left pixel.
 * @param {number} y Top pixel.
 * @param {(x: number, y: number) => void} plot Pixel callback.
 */
export function drawText(s: string, x: number, y: number, plot: (x: number, y: number) => void): void {
	let cx = x;
	for (const ch of clampText(s)) {
		const g = glyph(ch);
		for (let r = 0; r < g.length; r++) {
			for (let c = 0; c < g[r].length; c++) if (g[r][c] === '#') plot(cx + c, y + r);
		}
		cx += g[0].length + 1;
	}
}
