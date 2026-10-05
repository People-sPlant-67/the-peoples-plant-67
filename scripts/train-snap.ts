/**
 * The train alone at 3×, for judging the locomotive and carriage by eye. Usage: tsx scripts/train-snap.ts [out]
 */
import { writeFileSync } from 'node:fs';
import { trainFrame } from '../src/art/train';
import { encodePng } from './png';

const out = process.argv[2] ?? 'spike-output/sheets/train.png';
const t0 = Date.now();
const { frame } = trainFrame();
console.log(`Rendered the train in ${Date.now() - t0} ms (${frame.w}×${frame.h}).`);
writeFileSync(out, encodePng(frame, 3));
console.log(`Wrote ${out}`);
