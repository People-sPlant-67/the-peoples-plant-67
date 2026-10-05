/**
 * Outfit bank. Named agents get a bespoke outfit; anyone else is dressed from the bank
 * with a seed derived from their agent id, so the same comrade always looks the same.
 */

import { MATERIALS, type MaterialName, rgb } from './palette';
import { hash } from './sdf';

export type Headwear = 'kepka' | 'ushanka' | 'peaked' | 'kosynka' | 'none'
	// The wardrobe:
	| 'budenovka' | 'pilotka' | 'papakha' | 'beret' | 'beskozyrka' | 'helmet' | 'fedora' | 'tyubeteika' | 'platok';
/** Tops. 'dress' is the cloakroom attendant's; 'bare' is a comrade half way through changing. */
export type Torso = 'overalls' | 'tunic' | 'telogreika' | 'trench'
	| 'gymnastyorka' | 'telnyashka' | 'shinel' | 'suit' | 'sweater' | 'labcoat' | 'tulup' | 'vyshyvanka' | 'dress' | 'bare';
/** The tops the random bank dresses comrades in (the wardrobe's are chosen, never rolled). */
export type BankTorso = 'overalls' | 'tunic' | 'telogreika' | 'trench';
export type Face = 'moustache' | 'beard' | 'spectacles' | 'clean' | 'walrus' | 'pencil' | 'roundGlasses';
/** What is on the legs: trousers, breeches with tall boots, a skirt, or nothing (changing). */
export type Legs = 'trousers' | 'galife' | 'skirt' | 'bare';
/** Something in the mouth. */
export type Mouth = 'pipe' | 'papirosa';
/** Worn or carried besides the clothes: medals, badges, an armband, a neckerchief, a bag. */
export type Extra = 'heroStar' | 'orderLenin' | 'komsomol' | 'armband' | 'pioneerTie' | 'satchel' | 'briefcase';

export interface Outfit {
	id: string;
	label: string;
	skin: MaterialName;
	hair: MaterialName;
	headwear: Headwear;
	hatMat: MaterialName;
	torso: Torso;
	torsoMat: MaterialName;
	/** Shirt under overalls. */
	shirtMat: MaterialName;
	legsMat: MaterialName;
	face: Face;
	scarf: MaterialName | null;
	sleeves: 'rolled' | 'long';
	/** Optional; left out, trousers. */
	legs?: Legs;
	/** Optional; left out, nothing. */
	mouth?: Mouth | null;
	/** Optional; left out, none. */
	extras?: Extra[];
}

export const ALEXEI: Outfit = {
	id: 'alexei',
	label: 'Alexei, Stakhanovite',
	skin: 'skinB',
	hair: 'hairDark',
	headwear: 'kepka',
	hatMat: 'greyWool',
	torso: 'overalls',
	torsoMat: 'blueWork',
	shirtMat: 'cream',
	legsMat: 'blueWork',
	face: 'moustache',
	scarf: 'red',
	sleeves: 'rolled',
};

/** The гардероб's attendant: a stern babushka in a flowered headscarf knotted under her chin, and a pinafore. */
export const ATTENDANT: Outfit = {
	id: 'attendant',
	label: 'The cloakroom attendant',
	skin: 'skinA',
	hair: 'hairGrey',
	headwear: 'platok',
	hatMat: 'red',
	torso: 'dress',
	torsoMat: 'fadedBlue',
	shirtMat: 'cream',
	legsMat: 'fadedBlue',
	face: 'clean',
	scarf: null,
	sleeves: 'long',
	legs: 'skirt',
};

/**
 * Cloth that reads as the same grey-olive blob from across the floor. Fine on one garment;
 * a comrade dressed head to toe in it is what made early rerolls look like one man.
 */
export const DULL_MATS: readonly MaterialName[] = ['greyWool', 'oliveDrab', 'padded', 'khaki'];

/**
 * Minimum RGB distance between the mid tones of torso and legs (when they are separate
 * garments). Below this the two read as one colour at 1x; e.g. navyWork on blueWork is ~40.
 */
export const MIN_TORSO_LEGS_CONTRAST = 60;

/**
 * The outfit bank. Torso materials are listed per torso so each garment only comes in cloth it
 * was really made in (quilted telogreikas are not white; overalls are not leather), which also
 * lets the bright dyes sit where they are plausible instead of being filtered out afterwards.
 */
export const BANK: {
	skin: MaterialName[]; hair: MaterialName[]; headwear: Headwear[]; hatMat: MaterialName[]; torso: BankTorso[];
	torsoMat: Record<BankTorso, MaterialName[]>; shirtMat: MaterialName[]; legsMat: MaterialName[];
	legsContrast: MaterialName[]; kosynkaMat: MaterialName[]; face: Face[];
	scarf: (MaterialName | null)[]; sleeves: ('rolled' | 'long')[];
} = {
	skin: ['skinA', 'skinB', 'skinC', 'skinD'],
	hair: ['hairDark', 'hairBrown', 'hairGrey', 'hairBlond', 'hairRed', 'hairBlack', 'hairFlax'],
	headwear: ['kepka', 'ushanka', 'peaked', 'kosynka', 'none'],
	hatMat: ['greyWool', 'blackLeather', 'oliveDrab', 'red', 'navyWork', 'charcoal', 'bottleGreen', 'sand', 'medWhite'],
	torso: ['overalls', 'tunic', 'telogreika', 'trench'],
	torsoMat: {
		overalls: ['blueWork', 'rust', 'bottleGreen', 'sand', 'mustard'],
		tunic: ['khaki', 'oliveDrab', 'skyShirt', 'medWhite', 'bottleGreen', 'brickRed', 'sand'],
		telogreika: ['padded', 'greyWool', 'charcoal', 'bottleGreen', 'navyWork'],
		trench: ['blackLeather', 'brownLeather', 'sand', 'oliveDrab', 'navyWork', 'charcoal'],
	},
	shirtMat: ['cream', 'skyShirt', 'medWhite', 'khaki', 'brickRed'],
	legsMat: ['blueWork', 'fadedBlue', 'navyWork', 'charcoal', 'greyWool', 'oliveDrab', 'khaki', 'blackLeather'],
	// Fallback trousers when the first pick is too close to the torso: one light, several dark,
	// so every torso material is far enough from at least one of them.
	legsContrast: ['blueWork', 'fadedBlue', 'navyWork', 'charcoal', 'sand', 'khaki', 'blackLeather'],
	kosynkaMat: ['red', 'cream', 'medWhite', 'skyShirt', 'mustard', 'bottleGreen'],
	face: ['moustache', 'beard', 'spectacles', 'clean'],
	scarf: [null, null, 'red', 'cream', 'skyShirt', 'mustard'],
	sleeves: ['rolled', 'long'],
};

/**
 * RGB distance between the mid tones of two materials: a cheap stand-in for "do these
 * read as different colours at sprite size".
 *
 * @param {MaterialName} a First material.
 * @param {MaterialName} b Second material.
 * @returns {number} Euclidean distance in 0-255 RGB space.
 */
export function midDistance(a: MaterialName, b: MaterialName): number {
	const [r1, g1, b1] = rgb(MATERIALS[a].tones[1]);
	const [r2, g2, b2] = rgb(MATERIALS[b].tones[1]);
	return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/**
 * Whether trousers stand apart from the jacket above them.
 *
 * @param {MaterialName} torso Torso material.
 * @param {MaterialName} legs Legs material.
 * @returns {boolean} True when the pair has enough contrast and is not dull on dull.
 */
export function legsContrast(torso: MaterialName, legs: MaterialName): boolean {
	if (DULL_MATS.includes(torso) && DULL_MATS.includes(legs)) return false;
	return midDistance(torso, legs) >= MIN_TORSO_LEGS_CONTRAST;
}

/**
 * Turn any string (an agent id) into a numeric seed.
 *
 * @param {string} s Input.
 * @returns {number} Seed.
 */
export function seedOf(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

/**
 * Dress a comrade from the bank. Pure: the same seed always gives the same outfit, as long
 * as BANK, the slot names, the override lists below, `hash` and `seedOf` are unchanged.
 * Real agents are dressed with `randomOutfit(seedOf(agentId))`, so editing any of those
 * redresses existing comrades; tests/outfits.test.ts pins a few as golden snapshots.
 *
 * @param {number} seed Seed; a reroll is just a new seed.
 * @returns {Outfit} Outfit.
 */
export function randomOutfit(seed: number): Outfit {
	// Each slot rolls its own hash of (seed, slot name) rather than sharing a sequential PRNG,
	// so a bank edit's damage is contained, not zero. What each kind of edit costs:
	// - Appending to a list of N: floor(r * len) moves for half of all comrades in
	//   that slot, whatever N is. Removing or reordering entries can move anyone in the slot.
	// - Replacing an entry in place: only comrades who held that entry change.
	// - Knock-on slots: headwear feeds hatMat (ushanka, kosynka) and face (kosynka); torso
	//   feeds torsoMat (each torso has its own list), legsMat and sleeves; torsoMat feeds
	//   legsMat (overalls copy it; other torsos re-pick from legsContrast when the first pick
	//   fails the contrast check). An edit to headwear, torso, torsoMat, legsContrast, the
	//   dull list or the contrast threshold can also change those.
	// - Editing a palette colour can flip the contrast check and so move legsMat.
	// - skin, hair, shirtMat and scarf depend on nothing else, so other edits never touch them.
	// - Renaming a slot string (e.g. 'hatMat') is a new roll: everyone changes in that slot.
	const roll = (slot: string) => hash(seed, seedOf(slot), 67);
	const pick = <T>(slot: string, a: readonly T[]): T => a[Math.floor(roll(slot) * a.length)];
	const headwear = pick('headwear', BANK.headwear);
	const torso = pick('torso', BANK.torso);
	let hatMat = pick('hatMat', BANK.hatMat);
	// A few combinations look like nothing real; steer them to something plausible.
	if (headwear === 'ushanka') hatMat = roll('ushankaMat') < 0.7 ? 'fur' : 'greyWool';
	if (headwear === 'kosynka') hatMat = pick('kosynkaMat', BANK.kosynkaMat);
	const torsoMat = pick('torsoMat', BANK.torsoMat[torso]);
	// Overalls are one garment, so legs match the bib; the shirt under them supplies contrast.
	let legsMat = torso === 'overalls' ? torsoMat : pick('legsMat', BANK.legsMat);
	if (torso !== 'overalls' && !legsContrast(torsoMat, legsMat)) {
		// Every torso material has at least one passing entry here; tests/variety.test.ts checks it.
		legsMat = pick('legsContrast', BANK.legsContrast.filter((l) => legsContrast(torsoMat, l)));
	}
	return {
		id: `seed-${seed}`,
		label: `Comrade #${seed}`,
		skin: pick('skin', BANK.skin),
		hair: pick('hair', BANK.hair),
		headwear,
		hatMat,
		torso,
		torsoMat,
		shirtMat: pick('shirtMat', BANK.shirtMat),
		legsMat,
		face: headwear === 'kosynka' ? pick('kosynkaFace', ['clean', 'spectacles'] as Face[]) : pick('face', BANK.face),
		scarf: pick('scarf', BANK.scarf),
		sleeves: torso === 'overalls' ? pick('sleeves', BANK.sleeves) : 'long',
	};
}

/** Plain-English colour words for the materials an outfit can use. */
const COLOUR: Partial<Record<MaterialName, string>> = {
	hairDark: 'dark brown', hairBrown: 'brown', hairGrey: 'grey', hairBlond: 'blond', hairRed: 'red', hairBlack: 'black', hairFlax: 'flaxen',
	blueWork: 'work-blue', oliveDrab: 'olive', greyWool: 'grey wool', padded: 'dark grey', khaki: 'khaki', rust: 'rust',
	cream: 'cream', red: 'red', blackLeather: 'black leather', brownLeather: 'brown leather', fur: 'fur', navyWork: 'navy',
	fadedBlue: 'faded blue', skyShirt: 'sky-blue', brickRed: 'brick-red', mustard: 'mustard', bottleGreen: 'bottle-green',
	sand: 'sand', charcoal: 'charcoal', medWhite: 'white',
};

export const HEADWEAR_NAME: Record<Exclude<Headwear, 'none'>, string> = {
	kepka: 'flat cap', ushanka: 'ushanka', peaked: 'peaked cap', kosynka: 'headscarf',
	budenovka: 'budenovka', pilotka: 'side cap', papakha: 'papakha', beret: 'beret', beskozyrka: 'sailor\'s cap',
	helmet: 'miner\'s helmet', fedora: 'fedora', tyubeteika: 'tyubeteika', platok: 'flowered headscarf',
};
export const TORSO_NAME: Record<Torso, string> = {
	overalls: 'overalls', tunic: 'tunic', telogreika: 'quilted jacket', trench: 'trench coat',
	gymnastyorka: 'gymnastyorka', telnyashka: 'striped telnyashka', shinel: 'greatcoat', suit: 'suit and tie',
	sweater: 'sweater', labcoat: 'lab coat', tulup: 'sheepskin coat', vyshyvanka: 'embroidered shirt', dress: 'dress', bare: 'nothing',
};

/**
 * Whether a material has a colour word, so it can be named on the page (and so worn from the wardrobe).
 *
 * @param {string} m Material name.
 * @returns {boolean} True when colourName will name it.
 */
export function hasColourName(m: string): m is MaterialName {
	return Object.hasOwn(COLOUR, m);
}

/**
 * Colour word for a material, so internal names like "navyWork" never reach the page.
 *
 * @param {MaterialName} m Material.
 * @returns {string} Colour word.
 */
export function colourName(m: MaterialName): string {
	const c = COLOUR[m];
	if (!c) throw new Error(`No colour word for material "${m}". Add it to COLOUR in outfits.ts.`);
	return c;
}

/**
 * Prefix a noun phrase with "a" or "an".
 *
 * @param {string} phrase Noun phrase.
 * @returns {string} Phrase with its article.
 */
function withArticle(phrase: string): string {
	return `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
}

/**
 * Describe an outfit as one plain-English sentence, for the previewer and later the
 * Personnel File.
 *
 * @param {Outfit} o Outfit.
 * @returns {string} Sentence, e.g. "Comrade #42 wears a navy flat cap, an olive tunic with sand trousers and a beard."
 */
export function describeOutfit(o: Outfit): string {
	const items: string[] = [];
	items.push(o.headwear === 'none'
		? 'no hat'
		: withArticle(`${colourName(o.hatMat)} ${HEADWEAR_NAME[o.headwear]}`));
	items.push(o.torso === 'overalls'
		? `${colourName(o.torsoMat)} overalls over ${withArticle(`${colourName(o.shirtMat)} shirt`)}`
		: `${withArticle(`${colourName(o.torsoMat)} ${TORSO_NAME[o.torso]}`)} with ${colourName(o.legsMat)} trousers`);
	if (o.face === 'moustache') items.push('a moustache');
	if (o.face === 'beard') items.push('a beard');
	if (o.face === 'spectacles') items.push('spectacles');
	if (o.scarf) items.push(withArticle(`${colourName(o.scarf)} neckerchief`));
	const list = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0];
	// A label with a comma in it ("Alexei, Stakhanovite") is an appositive and needs closing.
	return `${o.label}${o.label.includes(',') ? ',' : ''} wears ${list}.`;
}
