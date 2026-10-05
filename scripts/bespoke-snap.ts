/**
 * Contact sheet of every bespoke comrade (idle frame 0, facing S then SE), for judging at a
 * glance whether each persona is recognisable and distinct. Usage: tsx scripts/bespoke-snap.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { SPRITE, renderAvatar } from '../src/art/avatar';
import { describeOutfit } from '../src/art/outfits';
import { PERSONAS } from '../src/live/personas';
import { blank, blit, encodePng } from './png';

const out = process.argv[2] ?? 'spike-output/sheets';
mkdirSync(out, { recursive: true });

// One column per comrade; row 0 faces S, row 1 faces SE.
const img = blank(SPRITE.w * PERSONAS.length, SPRITE.h * 2, [150, 148, 142]);
PERSONAS.forEach(({ outfit }, c) => {
	blit(img, renderAvatar(outfit, 'idle', 'S', 0), c * SPRITE.w, 0);
	blit(img, renderAvatar(outfit, 'idle', 'SE', 0), c * SPRITE.w, SPRITE.h);
	console.log(`${c + 1}. ${describeOutfit(outfit)}`);
});
writeFileSync(`${out}/bespoke.png`, encodePng(img, 3));
console.log(`Wrote ${out}/bespoke.png`);
