/**
 * The outfit description is shown to the user, so it must be plain English for every outfit
 * the bank can produce. Run with: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALEXEI, describeOutfit, randomOutfit } from '../src/art/outfits';

test('Alexei is described in plain English', () => {
	assert.equal(describeOutfit(ALEXEI), 'Alexei, Stakhanovite, wears a grey wool flat cap, work-blue overalls over a cream shirt, a moustache and a red neckerchief.');
});

test('every outfit the bank produces reads as a sentence with no internal names', () => {
	for (let seed = 0; seed < 3000; seed++) {
		const s = describeOutfit(randomOutfit(seed * 2654435761));
		assert.match(s, /^[A-Z].*\.$/, s);
		assert.doesNotMatch(s, /[a-z][A-Z]/, `internal camelCase name leaked: ${s}`);
		assert.doesNotMatch(s, /\b(kepka|telogreika|kosynka|undefined|null)\b/, s);
		assert.doesNotMatch(s, /\ba [aeiou]/i, `wrong article: ${s}`);
	}
});
