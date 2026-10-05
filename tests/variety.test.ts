/**
 * Visual variety of the outfit bank, measured in colour rather than part combinations.
 *
 * Counting distinct combinations passed while most rerolls were still the same grey-olive
 * silhouette, because swapping greyWool for padded is a new combination but not a new look.
 * These tests compare the mid tones of what the eye actually reads at sprite size, so they
 * fail when the bank drifts back towards one muddy family. No rendering: pure palette maths.
 *
 * Baseline when written (2026-09-23, seeds 1-60): the old bank scored a mean pairwise
 * distance of ~75 with 68% dull torsos; the widened bank scores ~99 with 18%.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANK, DULL_MATS, MIN_TORSO_LEGS_CONTRAST, type Outfit, legsContrast, midDistance, randomOutfit } from '../src/art/outfits';
import { MATERIALS, type MaterialName, rgb } from '../src/art/palette';

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

/**
 * The four colour areas that make a comrade recognisable at 1x: whatever sits on top of the
 * head, the hair, the torso, and the next big block below it (the shirt for overalls, since
 * their legs are the same cloth as the bib; otherwise the trousers).
 *
 * @param {Outfit} o Outfit.
 * @returns {[number, number, number][]} Mid-tone RGB per area.
 */
function look(o: Outfit): [number, number, number][] {
	const areas: MaterialName[] = [
		o.headwear === 'none' ? o.hair : o.hatMat,
		o.hair,
		o.torsoMat,
		o.torso === 'overalls' ? o.shirtMat : o.legsMat,
	];
	return areas.map((m) => rgb(MATERIALS[m].tones[1]));
}

/**
 * How different two comrades look: mean RGB distance across their colour areas.
 *
 * @param {[number, number, number][]} a First look.
 * @param {[number, number, number][]} b Second look.
 * @returns {number} Mean per-area distance.
 */
function lookDistance(a: [number, number, number][], b: [number, number, number][]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]);
	return sum / a.length;
}

test('rerolled comrades are far apart in colour on average, with few near-twins', () => {
	const looks = SEEDS.map((s) => look(randomOutfit(s)));
	let sum = 0, pairs = 0, twins = 0;
	for (let i = 0; i < looks.length; i++) {
		for (let j = i + 1; j < looks.length; j++) {
			const d = lookDistance(looks[i], looks[j]);
			sum += d;
			pairs++;
			// Under ~30 per area, two sprites read as the same person in a different pose.
			if (d < 30) twins++;
		}
	}
	const mean = sum / pairs;
	assert.ok(mean >= 90, `mean pairwise look distance ${mean.toFixed(1)} fell below 90`);
	assert.ok(twins / pairs <= 0.03, `${(100 * twins / pairs).toFixed(1)}% of pairs are near-twins (limit 3%)`);
});

test('no dull family dominates the torsos', () => {
	const dull = SEEDS.filter((s) => DULL_MATS.includes(randomOutfit(s).torsoMat)).length;
	assert.ok(dull / SEEDS.length <= 0.4, `${dull} of ${SEEDS.length} torsos are grey/olive/khaki/padded`);
});

test('no single torso material dominates', () => {
	const counts = new Map<MaterialName, number>();
	for (let s = 0; s < 2000; s++) {
		const m = randomOutfit(s).torsoMat;
		counts.set(m, (counts.get(m) ?? 0) + 1);
	}
	for (const [m, n] of counts) assert.ok(n / 2000 <= 0.2, `${m} dresses ${(100 * n / 2000).toFixed(0)}% of torsos`);
});

test('trousers always stand apart from a separate jacket', () => {
	for (let s = 0; s < 2000; s++) {
		const o = randomOutfit(s);
		if (o.torso === 'overalls') continue;
		assert.ok(legsContrast(o.torsoMat, o.legsMat), `seed ${s}: ${o.legsMat} legs under ${o.torsoMat}`);
	}
});

test('every torso material has a contrasting fallback trouser', () => {
	// randomOutfit re-picks from BANK.legsContrast filtered by the check; an empty filter would
	// hand back undefined for some seed nobody has rolled yet.
	for (const torso of BANK.torso) {
		for (const m of BANK.torsoMat[torso]) {
			const ok = BANK.legsContrast.filter((l) => legsContrast(m, l));
			assert.ok(ok.length > 0, `${torso} in ${m} has no legsContrast entry at least ${MIN_TORSO_LEGS_CONTRAST} away`);
			assert.ok(ok.every((l) => midDistance(m, l) >= MIN_TORSO_LEGS_CONTRAST));
		}
	}
});
