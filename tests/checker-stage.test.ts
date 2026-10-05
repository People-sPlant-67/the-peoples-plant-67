/**
 * Checks the previewer's Checker stage: whole checker squares, and every rendered comrade frame
 * and every bubble frame on top of it fits on the stage.
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANIMS, type Anim, DIRS, SPRITE, headTopIn, renderAvatar } from '../src/art/avatar';
import { bubbleFrame } from '../src/art/bubble';
import { type Headwear, ALEXEI } from '../src/art/outfits';
import { CHECKER_MARGIN, CHECKER_SQUARE, checkerStage } from '../src/preview/checker-stage';

const HEADWEAR: Headwear[] = ['none', 'kepka', 'peaked', 'ushanka', 'kosynka'];

test('the checker stage is whole pixels and whole squares, and holds the sprite canvas', () => {
	const s = checkerStage();
	for (const v of [s.w, s.h, s.x, s.y]) assert.ok(Number.isInteger(v), `${v} is not a whole pixel`);
	assert.equal(s.w % CHECKER_SQUARE, 0, `width ${s.w} is not whole squares`);
	assert.equal(s.h % CHECKER_SQUARE, 0, `height ${s.h} is not whole squares`);
	assert.ok(s.x >= CHECKER_MARGIN && s.x + SPRITE.w <= s.w - CHECKER_MARGIN, 'sprite canvas is too close to a side');
	assert.ok(s.y >= CHECKER_MARGIN && s.y + SPRITE.h <= s.h - CHECKER_MARGIN, 'sprite canvas is too close to the top or bottom');
});

test('every comrade frame and every bubble frame placed on it fit the checker stage', () => {
	const s = checkerStage();
	for (const h of HEADWEAR) {
		const o = { ...ALEXEI, id: `checker-${h}`, headwear: h };
		for (const anim of Object.keys(ANIMS) as Anim[]) for (const dir of DIRS) for (let f = 0; f < ANIMS[anim].length; f++) {
			const fr = renderAvatar(o, anim, dir, f);
			const where = `${h} ${anim} ${dir} frame ${f}`;
			// Opaque sprite pixels, raised hammer included, on the stage.
			for (let j = 0; j < fr.h; j++) for (let i = 0; i < fr.w; i++) {
				if (!fr.rgba[(j * fr.w + i) * 4 + 3]) continue;
				const x = s.x + i, y = s.y + j;
				assert.ok(x >= 0 && y >= 0 && x < s.w && y < s.h, `${where}: pixel ${i},${j} is off the stage`);
			}
			// The bubble goes where main.ts's showBubble puts it: tail tip on headTopIn.
			const top = headTopIn(fr);
			for (let bf = 0; bf < 5; bf++) for (const kind of ['reply', 'alert'] as const) {
				const b = bubbleFrame(bf, kind);
				const bx = s.x + top.x - b.tipX, by = s.y + top.y - b.tipY;
				assert.ok(bx >= 0 && by >= 0 && bx + b.w <= s.w && by + b.h <= s.h, `${where}: ${kind} bubble frame ${bf} at ${bx},${by} leaves the ${s.w}×${s.h} stage`);
			}
		}
	}
});
