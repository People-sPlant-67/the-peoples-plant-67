/**
 * Soviet palette. Every material is a 4-tone ramp (shadow, mid, light, highlight)
 * plus its own outline colour, so parts separate the way hand-drawn Habbo sprites do.
 */

export interface Material {
	tones: [string, string, string, string];
	outline: string;
	/** Whether the brightest tone is allowed. Matte cloth looks wrong with a specular pop. */
	highlight: boolean;
}

const m = (tones: [string, string, string, string], outline: string, highlight = false): Material => ({ tones, outline, highlight });

const DEFS = {
	// Skin
	skinA: m(['#c98a6a', '#e3ab8c', '#f3c9ad', '#fde2cf'], '#5a3325'),
	skinB: m(['#b8775a', '#d69877', '#ebb896', '#f8d4b8'], '#4d2a1e'),
	skinC: m(['#8f5a3e', '#ad7352', '#c48d69', '#d9a883'], '#3b2014'),
	skinD: m(['#5e3a28', '#794c35', '#936146', '#ab7a5c'], '#26150d'),

	// Hair
	hairDark: m(['#241812', '#38261d', '#4e3629', '#664836'], '#0f0906'),
	hairBrown: m(['#4a2f1d', '#66432b', '#84593b', '#a0724e'], '#1f130b'),
	hairGrey: m(['#6b6b6b', '#8c8c8c', '#adadad', '#cbcbcb'], '#2d2d2d'),
	hairBlond: m(['#8a6a2e', '#b08b40', '#cdab5a', '#e3c77d'], '#3d2d10'),
	hairRed: m(['#6e2d17', '#8f3d20', '#ad522d', '#c7693f'], '#2e1209'),
	hairBlack: m(['#101014', '#1a1a20', '#282830', '#3a3a46'], '#040405'),
	hairFlax: m(['#a08f62', '#c2b183', '#dccda2', '#ece2c0'], '#463d26'),

	// Cloth
	blueWork: m(['#2f3c4d', '#435468', '#5c7086', '#7890a8'], '#161d27'),
	oliveDrab: m(['#3c4128', '#525936', '#6b7447', '#858f5b'], '#1b1d11'),
	greyWool: m(['#3a3a38', '#51514d', '#6a6a65', '#84847e'], '#1a1a18'),
	padded: m(['#2d3230', '#3f4643', '#555d59', '#6d7671'], '#121514'),
	khaki: m(['#6b5c3b', '#86754e', '#a18f65', '#baa87d'], '#2f2718'),
	rust: m(['#5e2a17', '#7d3a20', '#9b4f2c', '#b6663d'], '#2a1108'),
	cream: m(['#b3a78c', '#cfc4a8', '#e3dac2', '#f2ecdb'], '#4f4838'),
	red: m(['#6e1616', '#962220', '#bd352c', '#dc5242'], '#300707', true),
	blackLeather: m(['#141416', '#222226', '#34343a', '#5a5a64'], '#050506', true),
	brownLeather: m(['#3b2414', '#55341e', '#70472a', '#8c5d38'], '#1a0f07', true),
	fur: m(['#3d2e22', '#574232', '#715845', '#8c705a'], '#1b130d'),
	boots: m(['#1e1917', '#2e2623', '#433833', '#5c4e47'], '#0c0908', true),

	// Garment dyes for the outfit bank. Muted the way period dyes and faded cotton were
	// (nothing saturated past a poster red), but spread across hue and value so rerolled
	// comrades read as different people at a glance, not the same grey-olive silhouette.
	navyWork: m(['#1d2740', '#2b3858', '#3d4f74', '#546891'], '#0b101d'),
	fadedBlue: m(['#4b6078', '#5f768e', '#7890a6', '#93aabd'], '#1f2833'),
	skyShirt: m(['#5a7896', '#7a99b6', '#9ab7d0', '#bad2e4'], '#283848'),
	brickRed: m(['#772c21', '#983d2b', '#b45237', '#cb6b4b'], '#33120b'),
	mustard: m(['#76571a', '#9b7728', '#bb963c', '#d4b259'], '#33250a'),
	bottleGreen: m(['#163828', '#214f39', '#2e674c', '#418263'], '#07160e'),
	sand: m(['#877a5f', '#a69779', '#c0b294', '#d5c9ae'], '#3b3325'),
	charcoal: m(['#1e2023', '#2c2f34', '#3e4249', '#555a62'], '#0a0b0d'),
	medWhite: m(['#a6aaa8', '#cbcfcc', '#e4e7e3', '#f5f6f3'], '#484c4a'),

	// Metal / wood
	iron: m(['#3a3e44', '#575d64', '#7d848c', '#b4bbc2'], '#16181b', true),
	steel: m(['#46505a', '#606c78', '#7f8c99', '#a8b4bf'], '#1b2026', true),
	brass: m(['#7a5a1c', '#a67e2c', '#cfa444', '#f0cf73'], '#33240a', true),
	bronze: m(['#3e2a14', '#5e4220', '#83602f', '#ad8749'], '#1a1108', true),
	gold: m(['#8a6a10', '#b8901c', '#e0b92e', '#fbe27a'], '#3b2c05', true),
	wood: m(['#5a3c22', '#7a5230', '#976a40', '#b38553'], '#2a1a0d'),
	woodDark: m(['#3e2917', '#553a22', '#6e4d2f', '#88623f'], '#1b1109'),

	// Architecture
	concrete: m(['#5c5a55', '#76736d', '#8f8c85', '#a8a59e'], '#2a2926'),
	grout: m(['#3f3d3a', '#4a4845', '#565350', '#615e5a'], '#1f1e1c'),
	oil: m(['#34322f', '#403e3a', '#4c4945', '#57544f'], '#1a1917'),
	brick: m(['#5e2e22', '#7a3d2d', '#94503c', '#ab634d'], '#2b130d'),
	mortar: m(['#6d6358', '#857a6d', '#9a8f82', '#aea396'], '#302a24'),
	paintGreen: m(['#3d5249', '#4f675c', '#627d71', '#779385'], '#1a2420'),
	paintLine: m(['#6e1616', '#8a1f1c', '#a42b25', '#bd3a31'], '#300707'),
	coal: m(['#16161a', '#25252b', '#383840', '#6a6a78'], '#060607', true),

	// Siberia
	snow: m(['#9fb0c4', '#c3d1e0', '#e2ebf4', '#ffffff'], '#5d6f84', true),
	pine: m(['#15291f', '#1f3a2c', '#2c4f3c', '#3c664f'], '#08120d'),
	log: m(['#3f2a1b', '#5b3e29', '#77553a', '#936c4b'], '#1f140c'),
	ice: m(['#7c9bb8', '#9dbad3', '#c0d6e8', '#e6f1fa'], '#3f5a73', true),
} satisfies Record<string, Material>;

/** Every material name. Typing names makes a misspelling a compile error, not a crash mid-render. */
export type MaterialName = keyof typeof DEFS;

export const MATERIALS: Record<MaterialName, Material> = DEFS;

/** Pixel-art colours for decals (eyes, text, sparks). Kept separate from shaded materials. */
export const INK = {
	eye: '#1d1411',
	eyeWhite: '#f4efe6',
	mouth: '#8a4a3a',
	frame: '#2a2a2e',
	spark: '#fff6b0',
	sparkHot: '#ffb238',
	breath: '#e8f2fa',
	/** The newspaper's masthead: Pravda's red. */
	masthead: '#b02a22',
	chalk: '#e8eadf',
	chalkDim: '#a9ad9e',
	boardGreen: '#243b2e',
	boardGreenDark: '#1a2c22',
	posterRed: '#b02a22',
	posterRedDark: '#7a1712',
	posterCream: '#efe3c4',
	posterBlack: '#1c1614',
	posterGold: '#e6b92e',
	stencil: '#d9d3c3',
};

const rgbCache = new Map<string, [number, number, number]>();

/**
 * Convert "#rrggbb" to an RGB triple, cached because the renderer calls this per pixel.
 *
 * @param {string} hex Colour in #rrggbb form.
 * @returns {[number, number, number]} Red, green and blue channels.
 */
export function rgb(hex: string): [number, number, number] {
	let c = rgbCache.get(hex);
	if (!c) {
		const n = parseInt(hex.slice(1), 16);
		c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
		rgbCache.set(hex, c);
	}
	return c;
}
