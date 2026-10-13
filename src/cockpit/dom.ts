/**
 * The two DOM helpers every window of the cockpit uses. Text only ever goes in through
 * textContent, since everything from Paperclip is untrusted.
 */

/**
 * Set an element's text only when it changed. The card refreshes several times a second while
 * someone walks; rewriting identical text would wipe a selection mid-copy.
 *
 * @param e Element.
 * @param text Text.
 */
export function setText(e: HTMLElement, text: string): void {
	if (e.textContent !== text) e.textContent = text;
}

/**
 * Create an element with a class and optional text.
 *
 * @param tag Tag name.
 * @param cls Class name.
 * @param text Text content.
 * @returns Element.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
}

/**
 * A canvas holding a bitmap, each pixel drawn as a scale × scale block.
 *
 * @param b Rows of colours.
 * @param scale Block size.
 * @returns Canvas.
 */
export function bitmapCanvas(b: (string | null)[][], scale: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = b[0].length * scale; c.height = b.length * scale;
	const g = c.getContext('2d');
	if (g) b.forEach((row, j) => row.forEach((col, i) => { if (col) { g.fillStyle = col; g.fillRect(i * scale, j * scale, scale, scale); } }));
	return c;
}

/**
 * An option for a select.
 *
 * @param text What it says.
 * @param value Its value.
 * @returns Option.
 */
export function opt(text: string, value: string): HTMLOptionElement {
	const o = document.createElement('option');
	o.textContent = text;
	o.value = value;
	return o;
}

/**
 * One Tab stop for a row of buttons, moved between them with the arrow keys, Home and End, as
 * a native radio group or tab list is (a roving tabindex). The stop sits on the current
 * button, or the first that can be pressed.
 *
 * @param group The row.
 * @param o item: selector for its buttons. current: whether a button is the one chosen now.
 *   choose: whether moving to a button also presses it (radios and tabs) or only focuses it.
 * @returns Puts the stop back on the current button, after the row changed without a click.
 */
export function rovingKeys(group: HTMLElement, o: { item: string; current: (b: HTMLElement) => boolean; choose: boolean }): () => void {
	const items = (): HTMLElement[] => Array.from(group.querySelectorAll<HTMLElement>(o.item)).filter((b) => !(b as HTMLButtonElement).disabled);
	const stop = (): void => {
		const all = items();
		const on = all.find(o.current) ?? all[0];
		for (const b of Array.from(group.querySelectorAll<HTMLElement>(o.item))) b.tabIndex = b === on ? 0 : -1;
	};
	stop();
	// After the button's own click has marked it chosen.
	group.addEventListener('click', stop);
	group.addEventListener('keydown', (e) => {
		// With a modifier held, the arrows belong to the browser (Alt+Left is Back).
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
		const all = items();
		const at = all.indexOf(e.target as HTMLElement);
		if (at < 0) return;
		const k = e.key;
		const to = k === 'ArrowRight' || k === 'ArrowDown' ? (at + 1) % all.length
			: k === 'ArrowLeft' || k === 'ArrowUp' ? (at - 1 + all.length) % all.length
				: k === 'Home' ? 0 : k === 'End' ? all.length - 1 : -1;
		if (to < 0) return;
		e.preventDefault();
		all[to].focus();
		if (o.choose) all[to].click();
		else { for (const b of all) b.tabIndex = b === all[to] ? 0 : -1; }
	});
	return stop;
}
