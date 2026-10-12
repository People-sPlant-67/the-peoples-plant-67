/**
 * The bridge page's stand-in for localStorage, kept in the plant's folder (prefs.json) instead
 * of the browser. The plant's address is new at every start, so nothing planted on an old
 * address can reach a new one; the browser keeps storage per address, so the owner's choices
 * (the founding form, the layout, the sound) would otherwise be lost at each start. The parts of
 * the plant that remember something call getItem and setItem as before. Unlike the browser's
 * own storage, nothing announces a change made in another tab (there is no storage event).
 *
 * Only what changed is sent, and the bridge merges it into what is on disk, so two tabs of one
 * start never undo each other's different choices; the same choice changed in both keeps the
 * later. What the bridge kept comes back, and is taken in, except where this tab has changed
 * something since; a tab coming back into view takes in the latest too.
 */

import type { PrefsChange } from '../bridge/prefs';

/**
 * A Storage that starts from the choices the plant kept and hands every change on.
 *
 * @param initial The kept choices, or null when they could not be read: then nothing is ever
 *   sent, so the choices on disk are never overwritten by a tab that never saw them.
 * @param save Called with what changed, a moment after the last change.
 * @param waitMs How long after the last change to save.
 * @returns The storage; flush, to save at once; adopt, to take in what the plant kept; again,
 *   to send once more a change that did not arrive.
 */
export function createPlantStorage(initial: Record<string, string> | null, save: (change: PrefsChange) => void, waitMs = 500): { storage: Storage; flush(): void; adopt(kept: Record<string, string>): void; again(change: PrefsChange): void } {
	const items = new Map(Object.entries(initial ?? {}));
	const set = new Map<string, string>();
	const removed = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		if (initial === null || (!set.size && !removed.size)) return;
		const change: PrefsChange = {};
		if (set.size) change.set = Object.fromEntries(set);
		if (removed.size) change.remove = [...removed];
		set.clear();
		removed.clear();
		save(change);
	};
	const changed = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(flush, waitMs);
	};
	const adopt = (kept: Record<string, string>): void => {
		for (const k of [...items.keys()]) if (!Object.hasOwn(kept, k) && !set.has(k)) items.delete(k);
		for (const [k, v] of Object.entries(kept)) if (!set.has(k) && !removed.has(k)) items.set(k, v);
	};
	/**
	 * A save that did not arrive: what it held goes with the next save, except what has changed
	 * since. Not sent again by itself, so a stopped plant's port is not asked over and over.
	 */
	const again = (change: PrefsChange): void => {
		for (const [k, v] of Object.entries(change.set ?? {})) if (!set.has(k) && !removed.has(k)) set.set(k, v);
		for (const k of change.remove ?? []) if (!set.has(k)) removed.add(k);
	};
	const storage: Storage = {
		get length() { return items.size; },
		key: (i) => [...items.keys()][i] ?? null,
		getItem: (k) => items.get(String(k)) ?? null,
		setItem: (k, v) => {
			const key = String(k), value = String(v);
			if (items.get(key) === value) return;
			items.set(key, value);
			set.set(key, value);
			removed.delete(key);
			changed();
		},
		removeItem: (k) => {
			const key = String(k);
			if (!items.delete(key)) return;
			set.delete(key);
			removed.add(key);
			changed();
		},
		clear: () => { for (const k of [...items.keys()]) storage.removeItem(k); },
	};
	return { storage, flush, adopt, again };
}
