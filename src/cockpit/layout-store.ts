/**
 * Where furnishing is kept: in this browser's storage, one layout per company, never in
 * Paperclip. What comes back is read through readLayout, so a damaged entry only loses itself.
 */
import { type Layout, emptyLayout, readLayout } from '../world/layout';

/** The storage key. The extension runs on Paperclip's origin, so it is namespaced. */
export const LAYOUT_KEY = 'plant67.layout';
/** The most companies kept: the oldest is dropped past this. */
const MAX_COMPANIES = 20;

/** The layouts kept in this browser. */
export interface LayoutStore {
	/** The layout kept for a company, or an empty one. */
	load(companyId: string): Layout;
	/** Keep a company's layout; an empty one is forgotten. */
	save(companyId: string, layout: Layout): void;
}

/**
 * Whether a layout changes nothing.
 *
 * @param l Layout.
 * @returns True when empty.
 */
const isEmpty = (l: Layout): boolean => !l.pieces.length && !l.posters.length && !Object.keys(l.moved).length && !Object.keys(l.hung).length;

/**
 * Set up the store.
 *
 * @param storage Where to keep it; null when storage is refused (nothing is kept).
 * @returns Store.
 */
export function createLayoutStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): LayoutStore {
	/**
	 * Every company's entry, as stored (unchecked).
	 *
	 * @returns Entries, in the order they were last saved.
	 */
	const all = (): Record<string, unknown> => {
		try {
			const v = JSON.parse(storage?.getItem(LAYOUT_KEY) ?? '{}') as unknown;
			return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
		} catch { return {}; }
	};
	return {
		load(companyId) {
			const a = all();
			return Object.hasOwn(a, companyId) ? readLayout(a[companyId]) : emptyLayout();
		},
		save(companyId, layout) {
			const a = all();
			delete a[companyId];
			if (!isEmpty(layout)) a[companyId] = layout;
			const keys = Object.keys(a);
			for (const k of keys.slice(0, Math.max(0, keys.length - MAX_COMPANIES))) delete a[k];
			try { storage?.setItem(LAYOUT_KEY, JSON.stringify(a)); } catch { /* Full or refused: the layout lasts until the page closes. */ }
		},
	};
}

/**
 * The page's localStorage, or null where touching it throws (privacy settings).
 *
 * @returns Storage.
 */
function safeStorage(): Storage | null {
	try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
