/**
 * Golden snapshots: the promise that the same agent always looks the same.
 *
 * Real agents are dressed with randomOutfit(seedOf(agentId)). If this test fails, you have
 * redressed existing comrades: every agent in the plant whose id hashes the way these do now
 * looks different. Either revert the change (BANK lists, slot names, override lists, `hash`
 * or `seedOf`), or decide the redress is worth it and update the snapshots below on purpose.
 * Do not update them just to make the test pass. See the comment in randomOutfit for which
 * edits move which slots.
 *
 * The ids cover every torso and most headwear, including the ushanka and kosynka overrides
 * and the contrasting-trousers fallback (padded telogreika over sand), so a change to any of
 * those paths shows up here.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Outfit, randomOutfit, seedOf } from '../src/art/outfits';

// Regenerated 2026-09-23: bank widened for variety before any agent was dressed.
const GOLDEN: Record<string, Outfit> = {
	'alexei-agent': {
		id: 'seed-668275687', label: 'Comrade #668275687', skin: 'skinC', hair: 'hairRed',
		headwear: 'none', hatMat: 'medWhite', torso: 'trench', torsoMat: 'blackLeather', shirtMat: 'brickRed',
		legsMat: 'greyWool', face: 'clean', scarf: 'cream', sleeves: 'long',
	},
	'the-rep': {
		id: 'seed-3551129670', label: 'Comrade #3551129670', skin: 'skinA', hair: 'hairRed',
		headwear: 'ushanka', hatMat: 'fur', torso: 'trench', torsoMat: 'sand', shirtMat: 'khaki',
		legsMat: 'oliveDrab', face: 'spectacles', scarf: 'red', sleeves: 'long',
	},
	'3f2b9c1e-7a4d-4e8b-9c02-5d6e1f0a8b37': {
		id: 'seed-2103197921', label: 'Comrade #2103197921', skin: 'skinA', hair: 'hairRed',
		headwear: 'kosynka', hatMat: 'medWhite', torso: 'telogreika', torsoMat: 'padded', shirtMat: 'khaki',
		legsMat: 'sand', face: 'spectacles', scarf: 'skyShirt', sleeves: 'long',
	},
	'a91c0d44-2e6f-4b1a-8f3c-0e7d9b5a2c61': {
		id: 'seed-2556814583', label: 'Comrade #2556814583', skin: 'skinD', hair: 'hairDark',
		headwear: 'kepka', hatMat: 'red', torso: 'telogreika', torsoMat: 'greyWool', shirtMat: 'medWhite',
		legsMat: 'fadedBlue', face: 'spectacles', scarf: null, sleeves: 'long',
	},
	'content-creator': {
		id: 'seed-4010115759', label: 'Comrade #4010115759', skin: 'skinD', hair: 'hairBlack',
		headwear: 'ushanka', hatMat: 'greyWool', torso: 'telogreika', torsoMat: 'padded', shirtMat: 'brickRed',
		legsMat: 'fadedBlue', face: 'spectacles', scarf: 'cream', sleeves: 'long',
	},
	'seo-specialist': {
		id: 'seed-2669239184', label: 'Comrade #2669239184', skin: 'skinB', hair: 'hairRed',
		headwear: 'none', hatMat: 'medWhite', torso: 'tunic', torsoMat: 'medWhite', shirtMat: 'medWhite',
		legsMat: 'fadedBlue', face: 'clean', scarf: null, sleeves: 'long',
	},
};

for (const [agentId, expected] of Object.entries(GOLDEN)) {
	test(`agent "${agentId}" is still dressed the same`, () => {
		assert.deepEqual(randomOutfit(seedOf(agentId)), expected);
	});
}
