/**
 * The dictators an owner can hang in the Director's office: six made-up archetypes, drawn as
 * the inside of the portrait frame (PORTRAIT_W × PORTRAIT_H pixels, no frame). None is a real
 * person. The first, The Moustache, is the Chairman the plant has always hung.
 *
 * The painter and the photo pixelator work in the same grid and the same palette.
 */

/** The inside of the gold frame, in bitmap pixels. */
export const PORTRAIT_W = 20;
export const PORTRAIT_H = 26;

/** A portrait: PORTRAIT_H rows of PORTRAIT_W colours, each "#rrggbb". */
export type Portrait = string[][];

/** The dark ground behind every portrait. */
export const PORTRAIT_BG = '#2b2420';

/**
 * The paint box: the plant's own inks, skins and cloths. The painter offers only these, and a
 * photo is snapped to them, so every portrait sits in the plant like it was always there.
 */
export const PORTRAIT_PALETTE: readonly string[] = [
	'#2b2420', '#1a1a20', '#3a2e26', '#5e3a28', '#8c8c8c', '#cbcbcb', '#e4e7e3', '#efe6cf',
	'#fde2cf', '#e3ab8c', '#c9a27e', '#a8825f', '#ad7352', '#794c35', '#b08b40', '#e6b92e',
	'#b02a22', '#7a1712', '#d98a7a', '#5a5440', '#525936', '#86754e', '#2b3858', '#51514d',
];

/** A name for each paint, so a screen reader can say which colour a swatch is. */
export const PORTRAIT_COLOUR_NAMES: Readonly<Record<string, string>> = {
	'#2b2420': 'Portrait ground', '#1a1a20': 'Ink black', '#3a2e26': 'Dark brown', '#5e3a28': 'Chestnut',
	'#8c8c8c': 'Grey', '#cbcbcb': 'Light grey', '#e4e7e3': 'Off-white', '#efe6cf': 'Cream',
	'#fde2cf': 'Pale skin', '#e3ab8c': 'Light skin', '#c9a27e': 'Tan skin', '#a8825f': 'Olive skin',
	'#ad7352': 'Bronze skin', '#794c35': 'Deep skin', '#b08b40': 'Brass', '#e6b92e': 'Gold',
	'#b02a22': 'Party red', '#7a1712': 'Dark red', '#d98a7a': 'Rose', '#5a5440': 'Dark khaki',
	'#525936': 'Army green', '#86754e': 'Khaki', '#2b3858': 'Navy', '#51514d': 'Slate',
};

/** Old-print browns for the photo pixelator's sepia option, darkest first. */
export const SEPIA_PALETTE: readonly string[] = ['#2b2420', '#4a3a2c', '#6e5640', '#937457', '#b89a74', '#d9c29c', '#efe3c4'];

/** One archetype. */
export interface Archetype {
	id: string;
	name: string;
	/** One line under the name in the wizard. */
	line: string;
	pixels: Portrait;
}

/**
 * A portrait of ground colour only.
 *
 * @returns Blank portrait.
 */
export function blankPortrait(): Portrait {
	return Array.from({ length: PORTRAIT_H }, () => Array<string>(PORTRAIT_W).fill(PORTRAIT_BG));
}

/**
 * A copy of a portrait, rows and all.
 *
 * @param p Portrait.
 * @returns Copy.
 */
export function copyPortrait(p: Portrait): Portrait {
	return p.map((r) => r.slice());
}

/** Drawing helpers over one portrait. */
function pen(g: Portrait) {
	const px = (x: number, y: number, c: string): void => { if (x >= 0 && y >= 0 && x < PORTRAIT_W && y < PORTRAIT_H) g[y][x] = c; };
	return {
		px,
		/** Fill an ellipse, optionally only where keep says. */
		ell(cx: number, cy: number, rx: number, ry: number, c: string, keep?: (x: number, y: number) => boolean): void {
			for (let y = 0; y < PORTRAIT_H; y++) for (let x = 0; x < PORTRAIT_W; x++) {
				const u = (x - cx) / rx, v = (y - cy) / ry;
				if (u * u + v * v < 1 && (!keep || keep(x, y))) g[y][x] = c;
			}
		},
		/** Fill a box, corners inclusive. */
		rect(x0: number, y0: number, x1: number, y1: number, c: string): void {
			for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c);
		},
		/** Shoulders widening downwards from row top. */
		shoulders(top: number, c: string, spread = 1.15, base = 3.6): void {
			for (let y = top; y < PORTRAIT_H; y++) for (let x = 0; x < PORTRAIT_W; x++) if (Math.abs(x - 9.5) < base + (y - top) * spread) g[y][x] = c;
		},
	};
}

/**
 * A face: an oval with its right side in shadow.
 *
 * @param g Portrait.
 * @param cy Centre row.
 * @param rx Half width.
 * @param ry Half height.
 * @param skin Lit skin.
 * @param shade Shaded skin.
 */
function face(g: Portrait, cy: number, rx: number, ry: number, skin = '#c9a27e', shade = '#a8825f'): void {
	const p = pen(g);
	p.ell(9.5, cy, rx, ry, skin);
	p.ell(9.5, cy, rx, ry, shade, (x) => x >= 13);
}

/**
 * The Moustache: the Chairman the plant has always hung. Swept-back dark hair, a heavy
 * moustache, a high-collared tunic with red tabs.
 *
 * @returns Portrait.
 */
function moustache(): Portrait {
	const SKIN = '#c9a27e', SHADOW = '#a8825f', HAIR = '#3a2e26', TUNIC = '#5a5440';
	const g = blankPortrait();
	for (let y = 0; y < PORTRAIT_H; y++) for (let x = 0; x < PORTRAIT_W; x++) {
		if (y >= 18 && Math.abs(x - 9.5) < 4 + (y - 18) * 1.1) g[y][x] = TUNIC;
		const hx = (x - 9.5) / 5, hy = (y - 9) / 6.2;
		if (hx * hx + hy * hy < 1) g[y][x] = hx > 0.55 ? SHADOW : SKIN;
		const cx = (x - 9.5) / 5.4, cy = (y - 5.5) / 3.6;
		if (y <= 6 && cx * cx + cy * cy < 1) g[y][x] = HAIR;
	}
	const { px } = pen(g);
	px(4, 9, SHADOW); px(4, 10, SHADOW); px(15, 9, SHADOW); px(15, 10, SHADOW);
	for (const x of [7, 8, 11, 12]) px(x, 7, HAIR);
	px(8, 8, PORTRAIT_BG); px(11, 8, PORTRAIT_BG);
	px(9, 10, SHADOW); px(10, 10, SHADOW);
	for (let x = 6; x < 14; x++) px(x, 12, HAIR);
	for (let x = 7; x < 13; x++) px(x, 11, x === 9 || x === 10 ? SHADOW : HAIR);
	for (let x = 8; x < 12; x++) px(x, 14, '#6e4a3a');
	for (let x = 7; x < 13; x++) px(x, 18, TUNIC);
	px(7, 19, '#b02a22'); px(12, 19, '#b02a22');
	return g;
}

/**
 * The Bald Visionary: a shining dome, a fringe, a goatee, a dark suit and a red tie.
 *
 * @returns Portrait.
 */
function bald(): Portrait {
	const g = blankPortrait();
	const p = pen(g);
	p.shoulders(18, '#1a1a20');
	p.rect(8, 18, 11, 25, '#e4e7e3');
	p.rect(9, 19, 10, 25, '#b02a22');
	face(g, 9.5, 4.8, 6.4);
	p.px(8, 5, '#fde2cf'); p.px(7, 6, '#fde2cf'); p.px(8, 6, '#fde2cf');
	for (let y = 8; y <= 11; y++) { p.px(5, y, '#5e3a28'); p.px(14, y, '#5e3a28'); }
	for (const x of [7, 8, 11, 12]) p.px(x, 9, '#5e3a28');
	p.px(8, 10, PORTRAIT_BG); p.px(11, 10, PORTRAIT_BG);
	p.px(9, 12, '#a8825f'); p.px(10, 12, '#a8825f');
	p.rect(8, 13, 11, 13, '#5e3a28');
	p.rect(9, 14, 10, 14, '#794c35');
	p.rect(8, 15, 11, 16, '#5e3a28');
	p.px(9, 17, '#5e3a28'); p.px(10, 17, '#5e3a28');
	return g;
}

/**
 * The Marshal: a peaked cap with a red band and a gold star, epaulettes and medals.
 *
 * @returns Portrait.
 */
function marshal(): Portrait {
	const g = blankPortrait();
	const p = pen(g);
	p.shoulders(19, '#86754e', 1.2, 4);
	face(g, 11.2, 4.5, 5.4);
	p.rect(4, 2, 15, 6, '#525936');
	p.rect(3, 6, 16, 7, '#b02a22');
	p.rect(3, 8, 16, 8, '#1a1a20');
	p.px(9, 4, '#e6b92e'); p.px(10, 4, '#e6b92e'); p.px(9, 5, '#e6b92e'); p.px(10, 3, '#e6b92e');
	p.rect(6, 10, 8, 10, '#3a2e26'); p.rect(11, 10, 13, 10, '#3a2e26');
	p.px(7, 11, PORTRAIT_BG); p.px(12, 11, PORTRAIT_BG);
	p.px(9, 12, '#a8825f'); p.px(10, 12, '#a8825f');
	p.rect(7, 14, 12, 14, '#3a2e26');
	p.rect(3, 19, 5, 19, '#e6b92e'); p.rect(14, 19, 16, 19, '#e6b92e');
	const medals: [number, number, string][] = [[6, 21, '#e6b92e'], [7, 21, '#b02a22'], [8, 21, '#e6b92e'], [6, 22, '#b02a22'], [7, 22, '#e6b92e'], [8, 22, '#b02a22'], [12, 21, '#e6b92e'], [13, 22, '#cbcbcb']];
	for (const [x, y, c] of medals) p.px(x, y, c);
	return g;
}

/**
 * The Iron Lady of the Steppe: grey hair in a tight bun, gold earrings, a navy dress with a high
 * white collar and a brooch.
 *
 * @returns Portrait.
 */
function ironLady(): Portrait {
	const g = blankPortrait();
	const p = pen(g);
	p.shoulders(18, '#2b3858');
	p.rect(7, 17, 12, 18, '#efe6cf');
	p.px(9, 19, '#e6b92e'); p.px(10, 19, '#e6b92e');
	p.ell(9.5, 8.5, 5.6, 6.4, '#51514d');
	face(g, 10.6, 4.2, 5.4);
	p.ell(9.5, 6.4, 4.6, 2.3, '#51514d', (_x, y) => y <= 7);
	p.ell(9.5, 2.4, 2.6, 1.8, '#51514d');
	p.px(7, 9, '#3a2e26'); p.px(12, 9, '#3a2e26');
	p.px(7, 10, PORTRAIT_BG); p.px(12, 10, PORTRAIT_BG);
	p.px(9, 12, '#a8825f'); p.px(10, 12, '#a8825f');
	p.rect(8, 14, 11, 14, '#b02a22');
	p.px(4, 12, '#e6b92e'); p.px(15, 12, '#e6b92e');
	return g;
}

/**
 * The Bureaucrat: a side parting, round spectacles, a grey suit and a dark tie.
 *
 * @returns Portrait.
 */
function bureaucrat(): Portrait {
	const g = blankPortrait();
	const p = pen(g);
	p.shoulders(18, '#51514d');
	p.rect(8, 18, 11, 25, '#e4e7e3');
	p.rect(9, 19, 10, 25, '#7a1712');
	face(g, 10, 4.6, 5.8);
	p.ell(9.5, 6.4, 5, 3, '#5e3a28', (_x, y) => y <= 7);
	p.px(7, 5, '#ad7352'); p.px(7, 6, '#ad7352');
	for (const ox of [6, 11]) {
		p.rect(ox, 8, ox + 2, 8, '#1a1a20');
		p.rect(ox, 10, ox + 2, 10, '#1a1a20');
		p.px(ox, 9, '#1a1a20'); p.px(ox + 2, 9, '#1a1a20'); p.px(ox + 1, 9, '#cbcbcb');
	}
	p.px(9, 9, '#1a1a20'); p.px(10, 9, '#1a1a20');
	p.px(9, 12, '#a8825f'); p.px(10, 12, '#a8825f');
	p.rect(8, 14, 11, 14, '#794c35');
	return g;
}

/**
 * The Babushka Supreme: a red headscarf with cream dots, knotted under the chin, rosy cheeks.
 *
 * @returns Portrait.
 */
function babushka(): Portrait {
	const g = blankPortrait();
	const p = pen(g);
	p.shoulders(19, '#b08b40', 1.2, 4);
	p.ell(9.5, 9.5, 6.4, 8, '#b02a22');
	p.rect(7, 17, 12, 19, '#b02a22');
	face(g, 11, 3.8, 4.6, '#e3ab8c', '#ad7352');
	for (const [x, y] of [[5, 5], [8, 3], [12, 3], [14, 6], [4, 11], [15, 11], [6, 16], [13, 16]]) p.px(x, y, '#efe6cf');
	p.px(8, 10, '#3a2e26'); p.px(11, 10, '#3a2e26');
	p.px(7, 12, '#d98a7a'); p.px(12, 12, '#d98a7a');
	p.px(9, 12, '#ad7352'); p.px(10, 12, '#ad7352');
	p.rect(9, 14, 10, 14, '#794c35');
	p.px(9, 18, '#7a1712'); p.px(10, 18, '#7a1712');
	return g;
}

/** The six, in the order the wizard shows them. The first is the plant's default. */
export const ARCHETYPES: readonly Archetype[] = [
	{ id: 'moustache', name: 'The Moustache', line: 'Swept hair, a moustache you could lose a spoon in.', pixels: moustache() },
	{ id: 'bald', name: 'The Bald Visionary', line: 'A forehead built for five-year plans.', pixels: bald() },
	{ id: 'marshal', name: 'The Marshal', line: 'Peaked cap, eleven medals, one for each medal.', pixels: marshal() },
	{ id: 'iron-lady', name: 'The Iron Lady of the Steppe', line: 'Never raises her voice. Never needs to.', pixels: ironLady() },
	{ id: 'bureaucrat', name: 'The Bureaucrat', line: 'Has a form for that. Has a form for the form.', pixels: bureaucrat() },
	{ id: 'babushka', name: 'The Babushka Supreme', line: 'Has outlived three regimes and your excuses.', pixels: babushka() },
];

/** The Chairman: the portrait hung until the owner picks or paints their own. */
export const CHAIRMAN: Portrait = ARCHETYPES[0].pixels;

/** A colour the portrait grid accepts. */
const HEX = /^#[0-9a-f]{6}$/;

/**
 * Whether a value is a well-formed portrait: the right size, every pixel a "#rrggbb" colour.
 * Anything read back from storage goes through this first.
 *
 * @param v Value.
 * @returns True for a usable portrait.
 */
export function isPortrait(v: unknown): v is Portrait {
	return Array.isArray(v) && v.length === PORTRAIT_H
		&& v.every((r) => Array.isArray(r) && r.length === PORTRAIT_W && r.every((c) => typeof c === 'string' && HEX.test(c)));
}
