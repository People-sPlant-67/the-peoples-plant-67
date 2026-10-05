/**
 * Render the plant inside its wasteland and write it to PNG: the whole view at 1×, and
 * a 2× close-up of each side, for the art check. Usage: npx tsx scripts/wasteland-snap.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { farthestFirst, renderLandmark, wasteGround, wasteLandmarks } from '../src/art/wasteland';
import { TRACK, buildWorld } from '../src/world/zones';
import { encodePng } from './png';

const out = process.argv[2] ?? 'spike-output';
mkdirSync(out, { recursive: true });

const world = buildWorld();
const { frame } = world.scene;
let t = Date.now();
const g = wasteGround(world.scene.base, TRACK.y);
while (!g.next(256));
const groundMs = Date.now() - t;
t = Date.now();
const marks = farthestFirst(wasteLandmarks()).map((m) => renderLandmark(world.scene.base, m));
const marksMs = Date.now() - t;

const { layer } = g;
const img = { w: layer.w, h: layer.h, rgba: new Uint8ClampedArray(layer.rgba) };
/**
 * Paint an image over the composite, by alpha.
 *
 * @param src Pixels.
 * @param sw Width.
 * @param sh Height.
 * @param x Left, in base-frame pixels.
 * @param y Top.
 */
const over = (src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number): void => {
	for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
		const s = (j * sw + i) * 4, a = src[s + 3] / 255;
		if (!a) continue;
		const X = x + i - layer.x, Y = y + j - layer.y;
		if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
		const d = (Y * img.w + X) * 4;
		for (let c = 0; c < 3; c++) img.rgba[d + c] = img.rgba[d + c] * (1 - a) + src[s + c] * a;
	}
};
for (const m of marks) over(m.sprite.rgba, m.sprite.w, m.sprite.h, m.x, m.y);
over(frame.rgba, frame.w, frame.h, 0, 0);
writeFileSync(`${out}/wasteland.png`, encodePng(img as never, 1, [22, 24, 29]));
// A typical window at the plant's opening zoom (2×), and each side close up.
const px = -layer.x, py = -layer.y;
const crops: Record<string, [number, number, number, number]> = {
	top: [px + 100, py - 420, 900, 520],
	right: [px + frame.w - 420, py + 40, 820, 520],
	left: [px - 560, py + 300, 820, 560],
	bottom: [px + 300, py + frame.h - 260, 900, 480],
};
for (const [name, crop] of Object.entries(crops)) writeFileSync(`${out}/wasteland-${name}.png`, encodePng(img as never, 2, [22, 24, 29], crop));
console.log(`Wasteland ${img.w}×${img.h}: ground ${groundMs} ms, ${marks.length} landmarks ${marksMs} ms. Wrote ${out}/wasteland*.png.`);
