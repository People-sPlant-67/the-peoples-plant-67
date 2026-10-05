/**
 * A least-recently-used map with a size cap. Reading an entry with get() or touch() makes it
 * the most recent; adding past the cap evicts the least recent and hands it to onEvict.
 * Pure and DOM-free, so the frame bank's memory rule is tested under Node.
 */

export interface Lru<V> {
	get(key: string): V | undefined;
	has(key: string): boolean;
	/** Mark an entry as just used, without reading it. Unknown keys are ignored. */
	touch(key: string): void;
	/** Add or replace an entry, then evict down to the cap. */
	set(key: string, value: V): void;
	/** Remove an entry without calling onEvict. */
	delete(key: string): boolean;
	keys(): IterableIterator<string>;
	readonly size: number;
}

/**
 * Create an LRU map.
 *
 * @param cap Most entries kept.
 * @param onEvict Called with each entry pushed out by the cap.
 * @returns LRU map.
 */
export function createLru<V>(cap: number, onEvict: (key: string, value: V) => void): Lru<V> {
	// A Map iterates in insertion order, so re-inserting on use keeps the oldest first.
	const map = new Map<string, V>();

	/**
	 * Move an entry to the most-recent end.
	 *
	 * @param key Key.
	 * @returns The value, or undefined when absent.
	 */
	const bump = (key: string): V | undefined => {
		if (!map.has(key)) return undefined;
		const v = map.get(key) as V;
		map.delete(key);
		map.set(key, v);
		return v;
	};

	return {
		get: bump,
		has: (key) => map.has(key),
		touch: (key) => { bump(key); },
		set(key, value) {
			map.delete(key);
			map.set(key, value);
			while (map.size > cap) {
				const [oldKey, oldValue] = map.entries().next().value as [string, V];
				map.delete(oldKey);
				onEvict(oldKey, oldValue);
			}
		},
		delete: (key) => map.delete(key),
		keys: () => map.keys(),
		get size() { return map.size; },
	};
}
