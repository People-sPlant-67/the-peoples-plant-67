/**
 * The art check for the director's office with the noticeboard (counts drawn in) and
 * Pravda on the desk; the same with the gold hover outline on the radiogram, the noticeboard and
 * Pravda; and the line down: the telephone ringing and the emergency lamp lit. Drawn with the cockpit's own fixture pixels, outline, glow
 * and ring marks. 3× crops of the office, 6× of the desk.
 * Usage: npx tsx scripts/scenery-snap.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { TILE, project } from '../src/art/render';
import { flatten } from '../src/art/scene';
import { LAMP_GLOW, glow, outline, ringMarks } from '../src/cockpit/fixtures';
import { type Patch, buildWorld, fixturePatches, lampPatch, noticeboardPatch } from '../src/world/zones';
import { encodePng } from './png';

const out = process.argv[2] ?? 'spike-output';
mkdirSync(out, { recursive: true });
const L = TILE;
const world = buildWorld();
const { base, props } = world.scene;
const patches = fixturePatches(world.scene);
const img = flatten(base, props);

/**
 * A copy of the picture with patches painted over it, by alpha.
 *
 * @param over Patches, bottom first.
 * @returns Picture.
 */
function paint(...over: Patch[]): typeof img {
	const rgba = new Uint8ClampedArray(img.rgba);
	for (const p of over) for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
		const s = (j * p.w + i) * 4, a = p.rgba[s + 3] / 255;
		const x = p.x + i, y = p.y + j;
		if (!a || x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
		const d = (y * img.w + x) * 4;
		for (let c = 0; c < 3; c++) rgba[d + c] = Math.round(rgba[d + c] * (1 - a) + p.rgba[s + c] * a);
	}
	return { ...img, rgba };
}

// The counts as the plant paints them: Inbox 3, Approvals 2, Failed runs 1.
const board = noticeboardPatch(base, [3, 2, 1]);
// The director's office, from the flag to the ficus, desk to wall.
const corners = [[0, 0], [6.2 * L, 0], [0, 4.2 * L], [6.2 * L, 4.2 * L]].map(([x, y]) => project(base, [x, y, 0]));
const left = Math.min(...corners.map((p) => p[0])), right = Math.max(...corners.map((p) => p[0]));
const top = Math.min(...corners.map((p) => p[1])) - 175, bottom = Math.max(...corners.map((p) => p[1]));
const crop: [number, number, number, number] = [Math.floor(left), Math.floor(top), Math.ceil(right - left), Math.ceil(bottom - top)];
const BG = [22, 24, 29];
writeFileSync(`${out}/1-office.png`, encodePng(paint(board), 3, BG, crop));
writeFileSync(`${out}/2-hover-radiogram.png`, encodePng(paint(board, outline(patches.radiogram)), 3, BG, crop));
writeFileSync(`${out}/3-hover-noticeboard.png`, encodePng(paint(board, outline(board)), 3, BG, crop));
writeFileSync(`${out}/4-hover-pravda.png`, encodePng(paint(board, outline(patches.pravda)), 3, BG, crop));
const lamp = lampPatch(base, true);
const ringing = paint(board, glow(lamp, LAMP_GLOW.r, LAMP_GLOW.alpha), lamp, glow(patches.telephone), patches.telephone, ringMarks(patches.telephone));
writeFileSync(`${out}/5-phone-ringing.png`, encodePng(ringing, 3, BG, crop));

// The desk up close, at 6×.
const desk = props.find((p) => p.id === 'dir-desk')!;
const deskCrop: [number, number, number, number] = [desk.x - 6, desk.y - 6, desk.sprite.w + 12, desk.sprite.h + 12];
writeFileSync(`${out}/6-desk.png`, encodePng(paint(board), 6, BG, deskCrop));
writeFileSync(`${out}/7-desk-pravda-hover.png`, encodePng(paint(board, outline(patches.pravda)), 6, BG, deskCrop));
writeFileSync(`${out}/8-desk-phone-ringing.png`, encodePng(ringing, 6, BG, deskCrop));
console.log(`Wrote ${out}/1-office.png … 8-desk-phone-ringing.png.`);
