/**
 * The bridge page's stand-in for localStorage, kept in the plant's folder (prefs.json) instead
 * of the browser. The plant's address is new at every start, so nothing planted on an old
 * address can reach a new one; the browser keeps storage per address, so the owner's choices
 * (the founding form, the layout, the sound) would otherwise be lost at each start. Every part
 * of the plant that remembers something goes on using localStorage as before.
 */

/**
 * A Storage that starts from the choices the plant kept and hands every change to save.
 *
 * @param initial The kept choices.
 * @param save Called with every choice, a moment after the last change.
 * @param waitMs How long after the last change to save.
 * @returns The storage, and flush to save at once (when the page goes away).
 */
export function createPlantStorage(initial: Record<string, string>, save: (all: Record<string, string>) => void, waitMs = 500): { storage: Storage; flush(): void } {
	const items = new Map(Object.entries(initial));
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending = false;
	const flush = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		if (!pending) return;
		pending = false;
		save(Object.fromEntries(items));
	};
	const changed = (): void => {
		pending = true;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(flush, waitMs);
	};
	const storage: Storage = {
		get length() { return items.size; },
		key: (i) => [...items.keys()][i] ?? null,
		getItem: (k) => items.get(String(k)) ?? null,
		setItem: (k, v) => { items.set(String(k), String(v)); changed(); },
		removeItem: (k) => { if (items.delete(String(k))) changed(); },
		clear: () => { if (items.size) { items.clear(); changed(); } },
	};
	return { storage, flush };
}
