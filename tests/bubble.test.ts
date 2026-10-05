/**
 * Checks for speech-bubble placement: `headTop` sits above the head or hat for every kind of
 * headwear, pose and view, and moves with the hat's height and the pose.
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Anim, type Dir, SPRITE, headTop, headTopIn, renderAvatar } from '../src/art/avatar';
import { type Headwear, type Outfit, ALEXEI } from '../src/art/outfits';

const HEADWEAR: Headwear[] = ['none', 'kepka', 'peaked', 'ushanka', 'kosynka'];
const DIRS: Dir[] = ['S', 'SE', 'E', 'N', 'W'];
const FRAMES: [Anim, number][] = [['idle', 0], ['idle', 2], ['walk', 1], ['shiver', 0], ['work', 2]];
const HEAD = ['head', 'hair', 'hat', 'brim', 'flap'];

/** One outfit object per headwear, reused so `headTop`'s per-outfit cache is exercised. */
const wearing = new Map<Headwear, Outfit>(HEADWEAR.map((h) => [h, { ...ALEXEI, id: `test-${h}`, headwear: h }]));

/**
 * Height of the bubble point above the feet, in pixels.
 *
 * @param {Headwear} h Headwear.
 * @param {Anim} anim Animation.
 * @param {Dir} dir Direction.
 * @param {number} f Frame.
 * @returns {number} Pixels above the anchor.
 */
const height = (h: Headwear, anim: Anim, dir: Dir, f: number): number => SPRITE.ay - headTop(wearing.get(h)!, anim, dir, f).y;

test('headTop is above every head pixel and its outline, and centred over the head', () => {
	for (const h of HEADWEAR) for (const dir of DIRS) for (const [anim, f] of FRAMES) {
		const fr = renderAvatar(wearing.get(h)!, anim, dir, f);
		const top = headTopIn(fr);
		assert.deepEqual(top, headTop(wearing.get(h)!, anim, dir, f), `cached and direct answers differ for ${h} ${anim} ${dir} ${f}`);
		const ids = HEAD.map((g) => fr.groups.indexOf(g)).filter((i) => i >= 0);
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity;
		for (let j = 0; j < fr.h; j++) for (let i = 0; i < fr.w; i++) {
			if (!ids.includes(fr.group[j * fr.w + i])) continue;
			x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j);
		}
		const where = `${h} ${anim} ${dir} frame ${f}`;
		assert.ok(y0 < Infinity, `${where} has no head pixels`);
		assert.ok(top.y < y0, `${where}: point y ${top.y} is not above the head top ${y0}`);
		assert.ok(y0 - top.y <= 3, `${where}: point y ${top.y} floats ${y0 - top.y}px above the head`);
		assert.ok(top.x >= x0 && top.x <= x1, `${where}: point x ${top.x} is outside the head ${x0}-${x1}`);
		// The outline row above the head is opaque but belongs to no group; the point must be clear of it too.
		for (let i = x0; i <= x1; i++) {
			for (let j = 0; j <= top.y; j++) {
				const g = fr.group[j * fr.w + i];
				assert.ok(g < 0 || !ids.includes(g), `${where}: head pixel at ${i},${j} is above the point`);
			}
			const a = fr.rgba[(top.y * fr.w + i) * 4 + 3];
			const g = fr.group[top.y * fr.w + i];
			if (a && g < 0) {
				// An opaque ungrouped pixel on the point's row is an outline; it must not be the head's.
				assert.ok(!ids.includes(fr.group[(top.y + 1) * fr.w + i]), `${where}: the head outline reaches the point's row at x ${i}`);
			}
		}
	}
});

test('a peaked cap stands taller than a kepka, which stands taller than a bare head', () => {
	for (const dir of DIRS) for (const f of [0, 2]) {
		const peaked = height('peaked', 'idle', dir, f), kepka = height('kepka', 'idle', dir, f), bare = height('none', 'idle', dir, f);
		assert.ok(peaked > kepka, `${dir} ${f}: peaked ${peaked}px is not above kepka ${kepka}px`);
		assert.ok(kepka > bare, `${dir} ${f}: kepka ${kepka}px is not above bare head ${bare}px`);
	}
});

test('shivering hunches the head below idle, and the idle bob never lowers the point', () => {
	for (const h of HEADWEAR) for (const dir of DIRS) {
		for (let f = 0; f < 4; f++) assert.ok(height(h, 'shiver', dir, f) < height(h, 'idle', dir, 0), `${h} ${dir}: shiver frame ${f} is not lower than idle`);
		// The bob is 1 world unit, under a pixel, so it may round to no change; it must never go down.
		assert.ok(height(h, 'idle', dir, 2) >= height(h, 'idle', dir, 0), `${h} ${dir}: the idle bob lowers the point`);
	}
});
