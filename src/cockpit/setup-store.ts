/**
 * What the owner chose when founding the plant: their party card, their portrait, the company
 * and their own seat, the regime, and how far through the wizard they got. One record in this
 * browser's localStorage. The extension runs on Paperclip's own origin, so the record is per
 * Paperclip host, and the key is namespaced like the plant's other keys.
 *
 * Nothing here is sent anywhere. A photo is never kept: only the 20 × 26 pixels made from it.
 */
import { type Portrait, isPortrait } from '../art/archetypes';

/** localStorage key for the setup record. Bump the version if the shape changes incompatibly. */
export const SETUP_KEY = 'plant67.setup.v1';

/** How many live strikes before the Director refers an agent to the tribunal. */
export type Regime = 'lenient' | 'standard' | 'purge';

/** Each regime: its threshold, its stamp word, its name and its line in the wizard. */
export const REGIMES: Record<Regime, { strikes: number; word: string; name: string; line: string; tone: 'green' | 'amber' | 'red' }> = {
	lenient: { strikes: 5, word: 'МЯГКИЙ', name: 'Lenient', line: 'Five live strikes before a tribunal. For a young plant.', tone: 'green' },
	standard: { strikes: 3, word: 'СТАНДАРТ', name: 'Standard', line: 'Three live strikes. The founding rule.', tone: 'amber' },
	purge: { strikes: 1, word: 'ЧИСТКА', name: 'Purge Season', line: 'One strike and they stand trial. Entertaining. Not wise.', tone: 'red' },
};

/** The regimes, in the order the wizard shows them. */
export const REGIME_ORDER: readonly Regime[] = ['lenient', 'standard', 'purge'];

/** The wizard's pages, in order: party card, dictator, connect, coffee, Ministry, inspection. */
export const STEPS = ['party', 'dictator', 'connect', 'coffee', 'ministry', 'inspection'] as const;
export type Step = (typeof STEPS)[number];

/** Longest name and title the party card takes. */
export const NAME_MAX = 32;
export const TITLE_MAX = 28;

/** The titles offered; anything else typed is the owner's own. */
export const TITLES: readonly string[] = ['Chairman of the Board', 'General Secretary', 'Premier', 'Supreme Leader', 'Director General'];

export interface Setup {
	/** The page the wizard reopens on. */
	step: Step;
	/** The owner has been through the wizard once (it no longer opens by itself). */
	done: boolean;
	name: string;
	title: string;
	/** The portrait's inside, or null for the Chairman. */
	portrait: Portrait | null;
	/** The archetype picked, while the portrait is still exactly that archetype. */
	archetype: string | null;
	/** The company the plant draws, or null for the only one there is. */
	companyId: string | null;
	/** The agent who is the owner's own seat, or null for none. */
	seatAgentId: string | null;
	/** The Buy Me a Coffee page has been shown; it never shows again. */
	coffeeSeen: boolean;
	regime: Regime;
	/** The last inspection passed, so the plaque hangs instead of the poster. Rechecked while the plant runs. */
	founded: boolean;
}

/** A fresh plant. */
export const DEFAULT_SETUP: Readonly<Setup> = {
	step: 'party', done: false, name: '', title: TITLES[0], portrait: null, archetype: 'moustache',
	companyId: null, seatAgentId: null, coffeeSeen: false, regime: 'standard', founded: false,
};

/** Paperclip's ids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trim a typed name or title to one line of at most max characters.
 *
 * @param v Value.
 * @param max Most characters.
 * @returns Clean text, or null when it is not text.
 */
export function cleanText(v: unknown, max: number): string | null {
	if (typeof v !== 'string') return null;
	return v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/**
 * Read a stored record field by field. A field that is missing or malformed falls back to its
 * default on its own, so one bad value never loses the rest of the owner's choices.
 *
 * @param raw Parsed JSON.
 * @returns Setup.
 */
export function readSetup(raw: unknown): Setup {
	const s: Setup = { ...DEFAULT_SETUP };
	if (!raw || typeof raw !== 'object') return s;
	const o = raw as Record<string, unknown>;
	if (typeof o.step === 'string' && (STEPS as readonly string[]).includes(o.step)) s.step = o.step as Step;
	if (typeof o.done === 'boolean') s.done = o.done;
	s.name = cleanText(o.name, NAME_MAX) ?? s.name;
	s.title = cleanText(o.title, TITLE_MAX) || s.title;
	if (isPortrait(o.portrait)) s.portrait = o.portrait;
	if (o.archetype === null || typeof o.archetype === 'string') s.archetype = o.archetype as string | null;
	if (typeof o.companyId === 'string' && UUID.test(o.companyId)) s.companyId = o.companyId;
	if (typeof o.seatAgentId === 'string' && UUID.test(o.seatAgentId)) s.seatAgentId = o.seatAgentId;
	if (typeof o.coffeeSeen === 'boolean') s.coffeeSeen = o.coffeeSeen;
	if (typeof o.regime === 'string' && o.regime in REGIMES) s.regime = o.regime as Regime;
	if (typeof o.founded === 'boolean') s.founded = o.founded;
	return s;
}

/**
 * Load the setup. Storage that refuses (privacy settings) or holds junk reads as a fresh plant.
 *
 * @param storage Storage, injectable for tests.
 * @returns Setup.
 */
export function loadSetup(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Setup {
	try {
		const v = storage?.getItem(SETUP_KEY);
		return readSetup(v ? JSON.parse(v) : null);
	} catch {
		return { ...DEFAULT_SETUP };
	}
}

/**
 * Save the setup, ignoring storage that refuses: the choices then last until the page closes.
 *
 * @param s Setup.
 * @param storage Storage, injectable for tests.
 */
export function saveSetup(s: Setup, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
	try { storage?.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* Kept for this visit only. */ }
}

/**
 * localStorage, or null where touching it throws.
 *
 * @returns Storage or null.
 */
function safeStorage(): Storage | null {
	try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/**
 * How the owner is addressed: "Chairman of the Board Sasha", or just the title before a name is given.
 *
 * @param s Setup.
 * @returns Words.
 */
export function addressOf(s: Pick<Setup, 'name' | 'title'>): string {
	return s.name ? `${s.title} ${s.name}` : s.title;
}
