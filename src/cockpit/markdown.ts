/**
 * A small, safe reading of the markdown agents write: headings, bullet and numbered lists, quotes,
 * rules, code blocks, and inline bold, italics and code. Everything is built with createElement and
 * textContent, never innerHTML, so nothing an agent writes can become a live element or script.
 * A link shows its words and its address as text, never as something to click (the plant never
 * turns an address an agent supplies into a link). Anything else stays the plain text it is.
 */

/** Longest text rendered as markdown; anything longer is shown as it is, line breaks and all. */
export const MARKDOWN_MAX = 40_000;
/**
 * Longest line whose bold, italics, code and links are read. The inline pattern scans ahead from
 * each opening mark, so its cost grows with the square of a line's length: a longer line, which
 * could stall the tab, is shown as it is.
 */
export const LINE_MAX = 2_000;

/**
 * An element with a class.
 *
 * @param tag Tag.
 * @param cls Class.
 * @returns Element.
 */
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	return e;
}

/**
 * Inline code (in one to three backticks), bold italics, bold, italics and links in one line of text. Underscores inside a word
 * (snake_case) are neither bold nor italics.
 */
const INLINE = /((`{1,3})(?=[^`\n]*[^`\s])[^`\n]+?\2)|(\*\*\*(?=\S)[^\n]*?\S\*\*\*)|(\*\*(?=\S)[^\n]*?\S\*\*|(?<!\w)__(?=\S)[^\n]*?\S__(?!\w))|((?<![\w*])\*(?=[^\s*])[^*\n]*?[^\s*]\*(?![\w*])|(?<!\w)_(?=[^\s_])[^_\n]*?[^\s_]_(?!\w))|(\[[^\]\n]+\]\([^)\s]+\))/g;

/**
 * Append a line's inline parts to an element.
 *
 * @param parent Where they go.
 * @param text The text.
 */
function inline(parent: HTMLElement, text: string): void {
	if (text.length > LINE_MAX) { parent.append(document.createTextNode(text)); return; }
	let at = 0;
	for (const m of text.matchAll(INLINE)) {
		if (m.index! > at) parent.append(document.createTextNode(text.slice(at, m.index)));
		const [whole, code, ticks, both, bold, soft, link] = m;
		if (code) parent.append(Object.assign(node('code', 'p67-md-code'), { textContent: code.slice(ticks.length, -ticks.length).trim() }));
		else if (both) { const b = node('strong'), i = node('em'); inline(i, both.slice(3, -3)); b.append(i); parent.append(b); }
		else if (bold) { const b = node('strong'); inline(b, bold.slice(2, -2)); parent.append(b); }
		else if (soft) { const i = node('em'); inline(i, soft.slice(1, -1)); parent.append(i); }
		else if (link) {
			const [, words, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(link)!;
			parent.append(document.createTextNode(words));
			if (href !== words) parent.append(Object.assign(node('span', 'p67-md-href'), { textContent: ` (${href})` }));
		}
		at = m.index! + whole.length;
	}
	if (at < text.length) parent.append(document.createTextNode(text.slice(at)));
}

/**
 * Render markdown as safe elements.
 *
 * @param text The text as written.
 * @returns A container holding the blocks.
 */
export function renderMarkdown(text: string): HTMLElement {
	const out = node('div', 'p67-md');
	if (text.length > MARKDOWN_MAX) { out.classList.add('p67-md-plain'); out.textContent = text; return out; }
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	let para: string[] = [];
	/** Close the paragraph being gathered. */
	const flush = (): void => {
		if (!para.length) return;
		const p = node('p');
		para.forEach((l, k) => { if (k) p.append(node('br')); inline(p, l); });
		out.append(p);
		para = [];
	};
	for (let k = 0; k < lines.length; k++) {
		const line = lines[k];
		// A backtick fence's opening line has no other backticks: "```npm test``` is what I ran" is inline code.
		const fence = /^\s*(```)[^`]*$/.exec(line) ?? /^\s*(~~~)/.exec(line);
		if (fence) {
			flush();
			const body: string[] = [];
			for (k++; k < lines.length && !lines[k].trimStart().startsWith(fence[1]); k++) body.push(lines[k]);
			const pre = node('pre', 'p67-md-pre');
			pre.textContent = body.join('\n');
			out.append(pre);
			continue;
		}
		// Closing #s count only after a space, so "## Use C#" keeps its C#.
		const heading = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
		if (heading) {
			flush();
			const h = node('p', `p67-md-h p67-md-h${Math.min(heading[1].length, 3)}`);
			h.setAttribute('role', 'heading');
			h.setAttribute('aria-level', String(heading[1].length));
			inline(h, heading[2]);
			out.append(h);
			continue;
		}
		if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.append(node('hr', 'p67-md-hr')); continue; }
		const item = /^\s*([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
		if (item) {
			flush();
			const ordered = /\d/.test(item[1]);
			const list = node(ordered ? 'ol' : 'ul', 'p67-md-list');
			// "3. three" stays 3: a list split by a code block carries on where it left off.
			if (ordered) (list as HTMLOListElement).start = Number.parseInt(item[1], 10);
			for (; k < lines.length; k++) {
				const m = /^\s*([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(lines[k]);
				if (!m || /\d/.test(m[1]) !== ordered) break;
				const li = node('li');
				inline(li, m[2]);
				list.append(li);
			}
			k--;
			out.append(list);
			continue;
		}
		if (/^\s*>/.test(line)) {
			flush();
			const quote = node('blockquote', 'p67-md-quote');
			const said: string[] = [];
			for (; k < lines.length && /^\s*>/.test(lines[k]); k++) said.push(lines[k].replace(/^\s*>\s?/, ''));
			k--;
			said.forEach((l, j) => { if (j) quote.append(node('br')); inline(quote, l); });
			out.append(quote);
			continue;
		}
		if (!line.trim()) { flush(); continue; }
		para.push(line);
	}
	flush();
	return out;
}
