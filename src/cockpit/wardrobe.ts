/**
 * The wardrobe: every choice the Wardrobe tab offers, part by part, with the cloths
 * each garment comes in; the looks the owner has kept, saved in this browser per comrade; and
 * the outfit a comrade wears, which is their kept look over their own skin and hair, or their own
 * outfit when nothing is kept. Nothing here is written to Paperclip.
 */
import { BANK, type Extra, type Face, type Headwear, type Legs, type Mouth, type Outfit, type Torso, hasColourName, legsContrast, seedOf } from '../art/outfits';
import type { MaterialName } from '../art/palette';
import { hash } from '../art/sdf';

/** localStorage key. The extension runs on Paperclip's origin, so the key is namespaced. */
export const WARDROBE_KEY = 'plant67.wardrobe';

/** What the owner chooses: everything but the comrade's own skin and hair. */
export interface Look {
	headwear: Headwear;
	hatMat: MaterialName;
	torso: Torso;
	torsoMat: MaterialName;
	shirtMat: MaterialName;
	legs: Legs;
	legsMat: MaterialName;
	face: Face;
	mouth: Mouth | null;
	scarf: MaterialName | null;
	extras: Extra[];
}

/** A garment and the cloths it really came in. */
export interface Garment<K extends string> { kind: K; cloths: readonly MaterialName[] }

/** Hats, bare-headed first. */
export const HATS: readonly Garment<Headwear>[] = [
	{ kind: 'none', cloths: [] },
	{ kind: 'kepka', cloths: ['greyWool', 'charcoal', 'navyWork', 'oliveDrab', 'sand', 'brownLeather'] },
	{ kind: 'ushanka', cloths: ['fur', 'greyWool'] },
	{ kind: 'peaked', cloths: ['navyWork', 'oliveDrab', 'khaki', 'charcoal'] },
	{ kind: 'kosynka', cloths: BANK.kosynkaMat },
	{ kind: 'platok', cloths: ['red', 'bottleGreen', 'navyWork', 'mustard'] },
	{ kind: 'budenovka', cloths: ['khaki', 'greyWool', 'oliveDrab'] },
	{ kind: 'pilotka', cloths: ['khaki', 'oliveDrab', 'red', 'navyWork'] },
	{ kind: 'papakha', cloths: ['greyWool', 'blackLeather', 'fur', 'sand'] },
	{ kind: 'beret', cloths: ['brickRed', 'charcoal', 'navyWork', 'bottleGreen', 'red'] },
	{ kind: 'beskozyrka', cloths: ['medWhite'] },
	{ kind: 'helmet', cloths: ['mustard', 'medWhite', 'red'] },
	{ kind: 'fedora', cloths: ['charcoal', 'brownLeather', 'greyWool', 'sand'] },
	{ kind: 'tyubeteika', cloths: ['bottleGreen', 'charcoal', 'red', 'navyWork'] },
];

/** Tops: the bank's four, then the wardrobe's. */
export const TOPS: readonly Garment<Torso>[] = [
	...BANK.torso.map((t) => ({ kind: t, cloths: BANK.torsoMat[t] })),
	{ kind: 'gymnastyorka', cloths: ['khaki', 'oliveDrab', 'sand'] },
	{ kind: 'telnyashka', cloths: ['medWhite'] },
	{ kind: 'shinel', cloths: ['greyWool', 'oliveDrab', 'charcoal'] },
	{ kind: 'suit', cloths: ['charcoal', 'navyWork', 'greyWool', 'brownLeather', 'sand'] },
	{ kind: 'sweater', cloths: ['mustard', 'bottleGreen', 'brickRed', 'greyWool', 'cream', 'charcoal', 'navyWork'] },
	{ kind: 'labcoat', cloths: ['medWhite'] },
	{ kind: 'tulup', cloths: ['brownLeather', 'sand'] },
	{ kind: 'vyshyvanka', cloths: ['medWhite', 'cream'] },
];

/** Legs. Overalls bring their own (legs and bib are one garment). */
export const LEGS: readonly Garment<Legs>[] = [
	{ kind: 'trousers', cloths: BANK.legsMat },
	{ kind: 'galife', cloths: ['navyWork', 'khaki', 'charcoal', 'blackLeather', 'oliveDrab'] },
	{ kind: 'skirt', cloths: ['navyWork', 'fadedBlue', 'charcoal', 'brickRed', 'bottleGreen', 'sand'] },
];

export const FACES: readonly Face[] = ['clean', 'moustache', 'walrus', 'pencil', 'beard', 'spectacles', 'roundGlasses'];
export const MOUTHS: readonly (Mouth | null)[] = [null, 'pipe', 'papirosa'];
export const SCARVES: readonly (MaterialName | null)[] = [null, 'red', 'cream', 'skyShirt', 'mustard'];
export const EXTRAS: readonly Extra[] = ['heroStar', 'orderLenin', 'komsomol', 'armband', 'pioneerTie', 'satchel', 'briefcase'];
/** Shirts under overalls and a lab coat. */
export const SHIRTS: readonly MaterialName[] = BANK.shirtMat;

/** Words for the Wardrobe tab. */
export const WORDS = {
	face: { clean: 'Clean-shaven', moustache: 'Moustache', walrus: 'Walrus moustache', pencil: 'Pencil moustache', beard: 'Beard', spectacles: 'Spectacles', roundGlasses: 'Round glasses' } satisfies Record<Face, string>,
	mouth: { none: 'Nothing', pipe: 'Pipe', papirosa: 'Papirosa' },
	legs: { trousers: 'Trousers', galife: 'Galife breeches', skirt: 'Skirt', bare: 'Nothing' } satisfies Record<Legs, string>,
	extras: { heroStar: 'Hero of Socialist Labour', orderLenin: 'Order of Lenin', komsomol: 'Komsomol badge', armband: 'Red armband', pioneerTie: 'Pioneer\'s neckerchief', satchel: 'Satchel', briefcase: 'Briefcase' } satisfies Record<Extra, string>,
};

/**
 * The look a comrade has on now, read off their outfit.
 *
 * @param o Outfit.
 * @returns Look.
 */
export function lookOf(o: Outfit): Look {
	return {
		headwear: o.headwear, hatMat: o.hatMat, torso: o.torso, torsoMat: o.torsoMat, shirtMat: o.shirtMat,
		legs: o.legs ?? 'trousers', legsMat: o.legsMat, face: o.face, mouth: o.mouth ?? null, scarf: o.scarf, extras: [...(o.extras ?? [])],
	};
}

/**
 * A look with every part that cannot be seen set to one value: a hat's cloth with no hat, the
 * shirt under anything but overalls and a lab coat, the legs under overalls. Two looks that look
 * the same are then the same look.
 *
 * @param l Look.
 * @returns The same look, tidied.
 */
export function normalLook(l: Look): Look {
	const overalls = l.torso === 'overalls';
	return {
		...l,
		hatMat: l.headwear === 'none' ? 'greyWool' : l.hatMat,
		shirtMat: overalls || l.torso === 'labcoat' ? l.shirtMat : 'cream',
		legs: overalls ? 'trousers' : l.legs,
		legsMat: overalls ? l.torsoMat : l.legsMat,
		extras: [...l.extras].sort(),
	};
}

/**
 * A short key for a look, so every different look is a different outfit to the frame bank (and
 * two that look the same are one).
 *
 * @param l Look.
 * @returns Key.
 */
export function lookKey(l: Look): string {
	const n = normalLook(l);
	return (seedOf(JSON.stringify([n.headwear, n.hatMat, n.torso, n.torsoMat, n.shirtMat, n.legs, n.legsMat, n.face, n.mouth, n.scarf, n.extras])) >>> 0).toString(36);
}

/**
 * Put an extra on or take it off; a satchel and a briefcase are never carried together.
 *
 * @param extras Extras now.
 * @param e The extra.
 * @param on Put it on.
 * @returns Extras after.
 */
export function withExtra(extras: readonly Extra[], e: Extra, on: boolean): Extra[] {
	const rest = extras.filter((x) => x !== e);
	if (!on) return rest;
	const other: Extra | null = e === 'satchel' ? 'briefcase' : e === 'briefcase' ? 'satchel' : null;
	return [...rest.filter((x) => x !== other), e];
}

/**
 * A comrade's own outfit wearing a look: their skin and hair, the look's clothes. Overalls keep
 * their legs and bib one cloth, and sleeves stay rolled only under overalls.
 *
 * @param own The comrade's own outfit.
 * @param l The look.
 * @returns Outfit, with an id of its own.
 */
export function wear(own: Outfit, l: Look): Outfit {
	const overalls = l.torso === 'overalls';
	return {
		...own,
		id: `${own.id}+${lookKey(l)}`,
		headwear: l.headwear, hatMat: l.hatMat, torso: l.torso, torsoMat: l.torsoMat, shirtMat: l.shirtMat,
		legs: overalls ? 'trousers' : l.legs, legsMat: overalls ? l.torsoMat : l.legsMat,
		face: l.face, mouth: l.mouth, scarf: l.scarf, extras: [...l.extras],
		sleeves: overalls ? own.sleeves : 'long',
	};
}

/**
 * A random look from the whole wardrobe, for Surprise me. Trousers keep their distance from the
 * top's colour, as the bank's do.
 *
 * @param seed Any number.
 * @returns Look.
 */
export function surprise(seed: number): Look {
	/**
	 * A number in [0, 1) for one part of the look.
	 *
	 * @param slot Part.
	 * @returns Number.
	 */
	const roll = (slot: string) => hash(seed, seedOf(slot), 91);
	/**
	 * One of a list, for one part of the look.
	 *
	 * @param slot Part.
	 * @param a Choices.
	 * @returns Choice.
	 */
	const pick = <T>(slot: string, a: readonly T[]): T => a[Math.floor(roll(slot) * a.length)];
	const hat = pick('hat', HATS), top = pick('top', TOPS), legs = pick('legs', LEGS);
	const torsoMat = pick('torsoMat', top.cloths);
	const fits = legs.cloths.filter((m) => legsContrast(torsoMat, m));
	const extras = EXTRAS.filter((e) => roll(`extra-${e}`) < 0.18).reduce<Extra[]>((all, e) => withExtra(all, e, true), []);
	return {
		headwear: hat.kind, hatMat: hat.cloths.length ? pick('hatMat', hat.cloths) : 'greyWool',
		torso: top.kind, torsoMat, shirtMat: pick('shirt', SHIRTS),
		legs: legs.kind, legsMat: pick('legsMat', fits.length ? fits : legs.cloths),
		face: pick('face', FACES), mouth: roll('mouthy') < 0.3 ? pick('mouth', MOUTHS) : null,
		scarf: roll('scarfy') < 0.25 ? pick('scarf', SCARVES) : null, extras,
	};
}

/**
 * Whether a value read back from storage is a look the wardrobe can dress anyone in.
 *
 * @param x Value.
 * @returns True when every part is a real choice.
 */
export function validLook(x: unknown): x is Look {
	const l = x as Look;
	if (!l || typeof l !== 'object') return false;
	// Cloths need only be ones the plant can name: a comrade's own outfit (a persona's, say) can wear
	// one the tab does not offer, and keeping it unchanged must still work.
	/**
	 * Whether a stored value is a cloth.
	 *
	 * @param m Value.
	 * @returns True for a named cloth.
	 */
	const cloth = (m: unknown): boolean => typeof m === 'string' && hasColourName(m);
	return HATS.some((h) => h.kind === l.headwear) && TOPS.some((t) => t.kind === l.torso) && LEGS.some((g) => g.kind === l.legs)
		&& cloth(l.hatMat) && cloth(l.torsoMat) && cloth(l.shirtMat) && cloth(l.legsMat)
		&& FACES.includes(l.face) && MOUTHS.includes(l.mouth) && (l.scarf === null || cloth(l.scarf))
		&& Array.isArray(l.extras) && l.extras.every((e) => EXTRAS.includes(e));
}

/** The slice of localStorage used here. */
export interface StoreLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** The looks kept in this browser. */
export interface Wardrobe {
	/** The look kept for a comrade, or null. */
	get(agentId: string): Look | null;
	/** Keep a look for a comrade. */
	set(agentId: string, look: Look): void;
	/** Forget a comrade's look: they go back to their own. */
	clear(agentId: string): void;
	/**
	 * What a comrade wears: their kept look, or their own outfit.
	 *
	 * @param agentId Comrade.
	 * @param own Their own outfit.
	 * @returns Outfit.
	 */
	wearing(agentId: string, own: Outfit): Outfit;
}

/**
 * Open the wardrobe.
 *
 * @param store Storage, or null for memory only (defaults to localStorage).
 * @returns Wardrobe.
 */
export function createWardrobe(store: StoreLike | null = defaultStore()): Wardrobe {
	let looks: Record<string, Look> = {};
	/** Read what is kept, dropping anything that is not a real look. Unreadable storage keeps memory's copy. */
	const load = (): void => {
		try {
			const raw = store?.getItem(WARDROBE_KEY);
			if (raw === null || raw === undefined) return;
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
			looks = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => typeof k === 'string' && validLook(v))) as Record<string, Look>;
		} catch { /* Keep what is in memory. */ }
	};
	/** Write back, ignoring storage that refuses. */
	const save = (): void => {
		try { store?.setItem(WARDROBE_KEY, JSON.stringify(looks)); } catch { /* It just won't survive a reload. */ }
	};
	load();
	return {
		get: (id) => (Object.hasOwn(looks, id) ? looks[id] : null),
		set(id, look) {
			if (!validLook(look)) return;
			// Read first, so two plant tabs do not overwrite each other's choices.
			load();
			looks[id] = { ...look, extras: [...look.extras] };
			save();
		},
		clear(id) {
			load();
			delete looks[id];
			save();
		},
		wearing(id, own) {
			return Object.hasOwn(looks, id) ? wear(own, looks[id]) : own;
		},
	};
}

/**
 * The browser's storage, or null where there is none (or it refuses).
 *
 * @returns Storage or null.
 */
function defaultStore(): StoreLike | null {
	try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
