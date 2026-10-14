/** A tour clock that excludes paused time and leaves no polling timer while paused. */
export function tourClock(now: () => number = () => performance.now()) {
	let paused = false, elapsed = 0, started = now();
	const listeners = new Set<() => void>();
	return {
		/** Elapsed active milliseconds. */
		now: () => elapsed + (paused ? 0 : now() - started),
		/** Freeze or resume the clock. */
		pause(value: boolean) {
			if (value === paused) return;
			if (value) elapsed += now() - started;
			else started = now();
			paused = value;
			for (const listener of listeners) listener();
		},
		/** Resolve once a paused tour runs again. */
		active(): Promise<void> {
			if (!paused) return Promise.resolve();
			return new Promise((resolve) => {
				const resume = () => { if (!paused) { listeners.delete(resume); resolve(); } };
				listeners.add(resume);
			});
		},
	};
}

/** Disposable Storage for the demo frame. Never reads or changes the visitor's choices. */
export function memoryStorage(): Storage {
	const items = new Map<string, string>();
	return {
		get length() { return items.size; },
		key: (i) => [...items.keys()][i] ?? null,
		getItem: (key) => items.get(String(key)) ?? null,
		setItem: (key, value) => { items.set(String(key), String(value)); },
		removeItem: (key) => { items.delete(String(key)); },
		clear: () => items.clear(),
	};
}
