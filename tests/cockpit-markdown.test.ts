/**
 * Markdown, read safely: the common shapes agents write become plain elements, anything that looks
 * like HTML stays text, links show their address as text, and snake_case is not italics.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';

const win = new Window();
Object.assign(globalThis, { document: win.document });
const { LINE_MAX, MARKDOWN_MAX, renderMarkdown } = await import('../src/cockpit/markdown');

/**
 * Render markdown.
 *
 * @param md Markdown.
 * @returns The container.
 */
const r = (md: string) => renderMarkdown(md) as unknown as HTMLElement;
/**
 * The rendered tags, in order.
 *
 * @param e Container.
 * @returns Tag names.
 */
const tags = (e: HTMLElement) => Array.from(e.querySelectorAll('*')).map((x) => x.tagName.toLowerCase());

test('The Commissar\'s report reads as a heading and a list', () => {
	const e = r('## Awaiting your answer\n\n- Question card saved and pending.\n- Next action: your answer wakes me.');
	assert.deepEqual(tags(e), ['p', 'ul', 'li', 'li']);
	assert.equal(e.querySelector('.p67-md-h2')!.textContent, 'Awaiting your answer');
	assert.deepEqual(Array.from(e.querySelectorAll('li')).map((l) => l.textContent), ['Question card saved and pending.', 'Next action: your answer wakes me.']);
	assert.doesNotMatch(e.textContent!, /##|^- /m);
});

test('bold, italics, code, numbered lists, quotes, rules and fenced code', () => {
	const e = r('Some **bold** and *soft* and _quiet_ and `code`.\n\n1. one\n2. two\n\n> said\n> twice\n\n---\n\n```\nlet x = 1;\n```');
	assert.equal(e.querySelector('strong')!.textContent, 'bold');
	assert.deepEqual(Array.from(e.querySelectorAll('em')).map((x) => x.textContent), ['soft', 'quiet']);
	assert.equal(e.querySelector('.p67-md-code')!.textContent, 'code');
	assert.equal(e.querySelectorAll('ol li').length, 2);
	assert.equal(e.querySelector('blockquote')!.textContent, 'saidtwice');
	assert.ok(e.querySelector('hr'));
	assert.equal(e.querySelector('pre')!.textContent, 'let x = 1;');
});

test('nothing an agent writes becomes a live element, and links are text', () => {
	const e = r('<img src=x onerror="alert(1)"> **<script>alert(2)</script>** [click me](javascript:alert(3))\n\n```\n<b>raw</b>\n```');
	assert.equal(e.querySelectorAll('img, script, a, b').length, 0);
	assert.match(e.textContent!, /<img src=x onerror="alert\(1\)">/);
	assert.match(e.textContent!, /<script>alert\(2\)<\/script>/);
	assert.match(e.textContent!, /click me \(javascript:alert\(3\)\)/, 'the address is shown, not followed');
});

test('snake_case and lone stars stay as written; line breaks within a paragraph are kept', () => {
	const e = r('set max_retry_count to 2 * 3\nnext line');
	assert.equal(e.querySelectorAll('em').length, 0);
	assert.match(e.textContent!, /max_retry_count to 2 \* 3/);
	assert.equal(e.querySelectorAll('br').length, 1);
});

test('no text is lost: C# in a heading, a fence-looking line that is inline code, numbered lists that carry on', () => {
	const h = r('## Use C#\n# F# and C# #');
	assert.deepEqual(Array.from(h.querySelectorAll('.p67-md-h')).map((x) => x.textContent), ['Use C#', 'F# and C#']);
	assert.equal(h.querySelector('.p67-md-h2')!.getAttribute('role'), 'heading');
	assert.equal(h.querySelector('.p67-md-h2')!.getAttribute('aria-level'), '2');
	const f = r('```npm test``` is what I ran.\nnext');
	assert.equal(f.querySelectorAll('pre').length, 0);
	assert.match(f.textContent!, /npm test is what I ran\.next/);
	assert.equal(f.querySelector('.p67-md-code')!.textContent, 'npm test');
	const l = r('3. three\n4. four');
	assert.equal((l.querySelector('ol') as unknown as HTMLOListElement).start, 3);
	const both = r('***loud*** and __strong__ but snake__case__name');
	assert.equal(both.querySelector('strong em')!.textContent, 'loud');
	assert.deepEqual(Array.from(both.querySelectorAll('strong')).map((x) => x.textContent), ['loud', 'strong']);
	assert.match(both.textContent!, /snake__case__name/);
});

test('very long text keeps its line breaks, and a very long line is shown as it is, quickly', () => {
	const long = r(`${'a'.repeat(MARKDOWN_MAX)}\nb`);
	assert.ok(long.classList.contains('p67-md-plain'), 'shown as written, line breaks kept by its style');
	for (const nasty of ['['.repeat(39_999), ' ['.repeat(19_999), '**x '.repeat(9_999)]) {
		const t0 = performance.now();
		const e = r(nasty);
		assert.ok(performance.now() - t0 < 200, `${nasty.slice(0, 4)}… rendered in ${Math.round(performance.now() - t0)} ms`);
		assert.equal(e.textContent!.length, nasty.length, 'nothing lost');
	}
	assert.ok(LINE_MAX >= 1_000);
});

test('a code span needs something in it: no empty spans, and no backtick is lost', () => {
	const e = r('`` `x` ``');
	assert.deepEqual(Array.from(e.querySelectorAll('.p67-md-code')).map((c) => c.textContent), ['x']);
	assert.equal(e.textContent, '`` x ``');
});
