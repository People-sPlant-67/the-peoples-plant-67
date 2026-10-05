/**
 * Render contact sheets (every direction × frame), outfit-bank samples, scenes and face
 * close-ups to PNG for pixel-level review, plus The Commissar's lurk and scribble at 1× (Habbo scale)
 * and 3×. Usage: npm run snap [-- outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { ANIMS, DIRS, type Anim, type Dir, SPRITE, renderAvatar } from '../src/art/avatar';
import { plantCorner, siberia } from '../src/art/env';
import { type Outfit, ALEXEI, randomOutfit } from '../src/art/outfits';
import { RES } from '../src/art/render';
import { PERSONAS } from '../src/live/personas';
import { blank, blit, encodePng } from './png';

const out = process.argv[2] ?? 'spike-output/sheets';
mkdirSync(out, { recursive: true });

/**
 * Write a contact sheet: rows are directions, columns are frames.
 *
 * @param {Outfit} o Outfit.
 * @param {Anim} anim Animation.
 * @param {number} s Integer scale.
 * @param {string} suffix Added to the file name.
 */
function sheet(o: Outfit, anim: Anim, s: number, suffix = ''): void {
	const n = ANIMS[anim].length;
	const img = blank(SPRITE.w * n, SPRITE.h * DIRS.length, [150, 148, 142]);
	DIRS.forEach((d, r) => { for (let f = 0; f < n; f++) blit(img, renderAvatar(o, anim, d, f), f * SPRITE.w, r * SPRITE.h); });
	writeFileSync(`${out}/${o.id}-${anim}${suffix}.png`, encodePng(img, s));
}

/**
 * Close-up of heads across directions and outfits, for judging faces.
 *
 * @param {[Dir, Outfit][]} cells Direction and outfit per cell.
 */
function faces(cells: [Dir, Outfit][]): void {
	const cw = Math.round(44 * RES), ch = Math.round(36 * RES);
	const img = blank(cw * cells.length, ch, [150, 148, 142]);
	cells.forEach(([d, o], k) => {
		const cell = blank(cw, ch, [150, 148, 142]);
		blit(cell, renderAvatar(o, 'idle', d, 0), -Math.round(20 * RES), -Math.round(24 * RES));
		blit(img, cell, k * cw, 0);
	});
	writeFileSync(`${out}/faces.png`, encodePng(img, 6));
}

const t0 = Date.now();
for (const a of Object.keys(ANIMS) as Anim[]) sheet(ALEXEI, a, 2);
for (const seed of [11, 42, 67, 1917, 2024, 555]) sheet(randomOutfit(seed), 'idle', 2);
const rep = PERSONAS.find((p) => p.id === 'rep')!.outfit;
for (const a of ['lurk', 'scribble'] as const) { sheet(rep, a, 1, '-1x'); sheet(rep, a, 3, '-3x'); }
// Include a bespectacled comrade: glasses are the face variant most likely to regress.
let specs = 1;
while (randomOutfit(specs).face !== 'spectacles' || randomOutfit(specs).headwear === 'ushanka') specs++;
faces([['S', ALEXEI], ['SE', ALEXEI], ['E', ALEXEI], ['SW', ALEXEI], ['S', randomOutfit(42)], ['SE', randomOutfit(1917)], ['S', randomOutfit(specs)], ['SE', randomOutfit(specs)]]);
for (const [name, sc] of [['plant', plantCorner()], ['siberia', siberia()]] as const) writeFileSync(`${out}/scene-${name}.png`, encodePng(sc.frame, 2, [16, 17, 20]));
console.log(`Rendered sheets in ${Date.now() - t0}ms to ${out}.`);
