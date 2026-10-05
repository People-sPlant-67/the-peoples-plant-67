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
