/**
 * Regression checks for the art layer. Run with: npm test
 * Cheap because the renderer is pure and runs in Node without a browser.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANIMS, DIRS, MASTHEAD, type Anim, SPRITE, renderAvatar } from '../src/art/avatar';
import { BUBBLE_MS, bubbleFrame } from '../src/art/bubble';
import { plantCorner, siberia, SIGNAGE } from '../src/art/env';
import { missingGlyphs, textWidth, drawText } from '../src/art/font';
import { ALEXEI, randomOutfit } from '../src/art/outfits';
import { PERSONAS } from '../src/live/personas';

test('every outfit, animation, direction and frame renders inside its canvas', () => {
	const outfits = [ALEXEI, ...Array.from({ length: 5 }, (_, k) => randomOutfit(1000 + k * 7919))];
	for (const o of outfits) {
		for (const anim of Object.keys(ANIMS) as Anim[]) {
			for (const d of DIRS) {
				for (let f = 0; f < ANIMS[anim].length; f++) {
					const fr = renderAvatar(o, anim, d, f);
					assert.equal(fr.w, SPRITE.w);
					let opaque = 0;
					for (let x = 0; x < fr.w; x++) {
						// A lit pixel on the top row or side columns means the sprite was clipped.
						assert.equal(fr.rgba[x * 4 + 3], 0, `${o.id} ${anim} ${d} ${f} clipped at the top`);
					}
					for (let y = 0; y < fr.h; y++) {
						assert.equal(fr.rgba[(y * fr.w) * 4 + 3], 0, `${o.id} ${anim} ${d} ${f} clipped on the left`);
						assert.equal(fr.rgba[(y * fr.w + fr.w - 1) * 4 + 3], 0, `${o.id} ${anim} ${d} ${f} clipped on the right`);
					}
					for (let k = 3; k < fr.rgba.length; k += 4) if (fr.rgba[k] === 255) opaque++;
					assert.ok(opaque > 800, `${o.id} ${anim} ${d} ${f} is nearly empty`);
				}
			}
		}
	}
});

test('the outfit bank produces variety', () => {
	const looks = new Set(Array.from({ length: 60 }, (_, k) => {
		const o = randomOutfit(k * 104729);
		return `${o.headwear}/${o.torso}/${o.torsoMat}/${o.face}`;
	}));
	assert.ok(looks.size > 30, `only ${looks.size} distinct looks in 60 comrades`);
});

test('every slogan on the walls can be drawn by the font', () => {
	for (const s of SIGNAGE) assert.deepEqual(missingGlyphs(s), [], `"${s}" has characters the font lacks`);
});

test('The Commissar\'s newspaper and notebook stay inside the canvas, and ПРАВДА shows from the front', () => {
	const rep = PERSONAS.find((p) => p.id === 'rep')!.outfit;
	for (const anim of ['lurk', 'scribble'] as const) {
		for (const d of DIRS) {
			for (let f = 0; f < ANIMS[anim].length; f++) {
				const fr = renderAvatar(rep, anim, d, f);
				for (let x = 0; x < fr.w; x++) assert.equal(fr.rgba[x * 4 + 3], 0, `${anim} ${d} ${f} clipped at the top`);
				for (let y = 0; y < fr.h; y++) {
					assert.equal(fr.rgba[(y * fr.w) * 4 + 3], 0, `${anim} ${d} ${f} clipped on the left`);
					assert.equal(fr.rgba[(y * fr.w + fr.w - 1) * 4 + 3], 0, `${anim} ${d} ${f} clipped on the right`);
				}
			}
		}
	}
	// Pravda's red, somewhere on the page, when he faces the viewer with the paper up.
	const fr = renderAvatar(rep, 'lurk', 'S', 0);
	let red = 0;
	for (let k = 0; k < fr.rgba.length; k += 4) if (fr.rgba[k] === 0xb0 && fr.rgba[k + 1] === 0x2a && fr.rgba[k + 2] === 0x22) red++;
	assert.ok(red > 30, `only ${red} masthead pixels`);
});

test('the newspaper\'s masthead can be drawn by the font', () => {
	assert.deepEqual(missingGlyphs(MASTHEAD), []);
});

test('measured text width matches what is drawn, including missing glyphs', () => {
	for (const s of [...SIGNAGE, 'Q?']) {
		let max = -1;
		drawText(s, 0, 0, (x) => { max = Math.max(max, x); });
		assert.ok(max < textWidth(s), `"${s}" draws past its measured width`);
	}
});

test('scenes render and the bubble has every frame', () => {
	for (const sc of [plantCorner(), siberia()]) assert.ok(sc.frame.w > 300 && sc.frame.h > 200);
	for (let f = 0; f < BUBBLE_MS.length; f++) assert.ok(bubbleFrame(f).w > 0);
});

test('the "…" thought bubble: its tail stays in the frame, its tip sits under the tail, and each dot takes a turn', () => {
	const opaque = (b: ReturnType<typeof bubbleFrame>, x: number, y: number) => b.rgba[(y * b.w + x) * 4 + 3] > 0;
	for (let f = 0; f < BUBBLE_MS.length; f++) {
		const b = bubbleFrame(f, 'writing');
		assert.equal(b.rgba.length, b.w * b.h * 4);
		assert.ok(b.tipX >= 0 && b.tipX < b.w && b.tipY >= 0 && b.tipY < b.h, `frame ${f}: the tip is inside the frame`);
	}
	const settled = bubbleFrame(4, 'writing');
	assert.ok(opaque(settled, settled.tipX, settled.tipY), 'the last dot of the tail is where the tip is placed, just above the head');
	const phases = [0, 1, 2].map((p) => bubbleFrame(4, 'writing', p).rgba.join());
	assert.equal(new Set(phases).size, 3, 'three different frames: the dark dot moves');
	assert.notEqual(bubbleFrame(4, 'writing').rgba.join(), bubbleFrame(4, 'reply').rgba.join());
});
