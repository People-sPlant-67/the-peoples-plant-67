import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS, TOFU, MAX_TEXT_CHARS, clampText, drawText, textWidth, missingGlyphs } from '../src/art/font';

/**
 * Rightmost x plotted when drawing a string at the origin, or -1 if nothing is lit.
 *
 * @param {string} s Text.
 * @returns {number} Max plotted x.
 */
function maxPlottedX(s: string): number {
	let max = -1;
	drawText(s, 0, 0, (x) => { max = Math.max(max, x); });
	return max;
}

test('every glyph (and tofu) is 5 rows of equal width', () => {
	for (const [ch, rows] of [...Object.entries(GLYPHS), ['TOFU', TOFU] as const]) {
		assert.equal(rows.length, 5, `"${ch}" is not 5 rows tall`);
		for (const r of rows) {
			assert.equal(r.length, rows[0].length, `"${ch}" has ragged rows`);
			assert.match(r, /^[#.]+$/, `"${ch}" has a stray character`);
		}
	}
});

test('tofu differs from every real glyph', () => {
	for (const [ch, rows] of Object.entries(GLYPHS)) {
		assert.notDeepEqual(rows, TOFU, `"${ch}" is indistinguishable from the missing-glyph box`);
	}
});

test('digits 0-9 are all present', () => {
	assert.deepEqual(missingGlyphs('0123456789'), []);
});

test('textWidth is exactly 1 + the rightmost plotted pixel', () => {
	// Every string here ends in a glyph whose right column is lit somewhere; a trailing blank column would break the equality.
	const cases = ['0', '№67', 'ПЛАН', '%', '0123456789', 'ZZ', 'А?Б', 'x', '!', 'СИБИРЬ 1', 'Q'.repeat(200)];
	for (const s of cases) assert.equal(textWidth(s), maxPlottedX(s) + 1, `"${s.slice(0, 20)}" measure and draw disagree`);
	assert.equal(textWidth(''), 0);
	assert.equal(maxPlottedX(''), -1);
});

test('length cap truncates with an ellipsis and leaves short text alone', () => {
	const short = 'А'.repeat(MAX_TEXT_CHARS);
	assert.equal(clampText(short), short);
	const long = 'А'.repeat(MAX_TEXT_CHARS * 10);
	const capped = clampText(long);
	assert.equal([...capped].length, MAX_TEXT_CHARS);
	assert.ok(capped.endsWith('…'));
	assert.equal(textWidth(long), textWidth(capped));
	assert.equal(maxPlottedX(long), maxPlottedX(capped));
	// Astral characters count as one each, and are never split into lone surrogates.
	assert.equal(clampText('😀'.repeat(MAX_TEXT_CHARS + 1)), '😀'.repeat(MAX_TEXT_CHARS - 1) + '…');
});
