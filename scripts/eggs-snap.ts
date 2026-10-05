/**
 * The art check for the easter eggs: the salute; marchers with their flags; the «1 МАЯ»
 * banner at the head of the column; Sputnik; the bear walking and sniffing; fireworks; the bust's
 * wink; the «ПЛАН ВЫПОЛНЕН!» banner; then the parade in the Canteen, the medal in the director's
 * office, and the bear at the hut in Siberia.
 * Usage: npx tsx scripts/eggs-snap.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { ANIMS, type Anim, type Dir, renderAvatar } from '../src/art/avatar';
import { bubbleFrame } from '../src/art/bubble';
import { BURST_COLOURS, BURST_FRAMES, burstFrame, planBanner, renderBanner, renderBear, renderFlag, renderSputnik } from '../src/art/eggs';
import { drawText } from '../src/art/font';
import { type Outfit, randomOutfit } from '../src/art/outfits';
import { type Frame, project } from '../src/art/render';
import { compose } from '../src/art/scene';
import type { V3 } from '../src/art/sdf';
import { OWN_PIECES, buildWorld } from '../src/world/zones';
import { type Image, blank, blit, encodePng } from './png';

const out = process.argv[2] ?? 'spike-output';
mkdirSync(out, { recursive: true });
const BG = [42, 44, 50];
const FOLK: Outfit[] = [5, 44, 91, 170].map((s, k) => ({ ...randomOutfit(s * 7919 + 3), skin: (['skinA', 'skinB', 'skinC', 'skinD'] as const)[k] }));

/**
 * A comrade's frame with the flag drawn over it (the parade draws it the same way).
 *
 * @param o Outfit.
 * @param anim Animation.
 * @param dir Direction.
 * @param f Frame.
 * @param flag Carry a flag.
 * @returns Frame.
 */
function marcher(o: Outfit, anim: Anim, dir: Dir, f: number, flag = true): Frame {
	const body = renderAvatar(o, anim, dir, f);
	if (!flag) return body;
	const fl = renderFlag(dir);
	const rgba = new Uint8ClampedArray(body.rgba);
	// The flag goes behind the body when they walk away (its pole is in the far hand), over it otherwise.
	const behind = dir === 'N' || dir === 'NE' || dir === 'NW';
	for (let k = 0; k < rgba.length; k += 4) {
		if (!fl.rgba[k + 3]) continue;
		if (behind && rgba[k + 3]) continue;
		rgba.set(fl.rgba.subarray(k, k + 4), k);
	}
	return { ...body, rgba };
}

/**
 * A number in the pixel font.
 *
 * @param img Image.
 * @param s Digits.
 * @param x Left.
 * @param y Top.
 */
function label(img: Image, s: string, x: number, y: number): void {
	drawText(s, x, y, (i, j) => { if (i >= 0 && j >= 0 && i < img.w && j < img.h) img.rgba.set([230, 220, 190, 255], (j * img.w + i) * 4); });
}

// 1: the salute on four comrades, then marchers with flags walking each way.
const W = 84, H = 112;
const sheet = blank(8 * (W + 2) + 2, 2 * (H + 12) + 2, [24, 25, 29]);
label(sheet, '1', 2, 2);
FOLK.forEach((o, k) => { blit(sheet, renderAvatar(o, 'salute', 'SE', 0), 2 + k * 2 * (W + 2), 10); blit(sheet, renderAvatar(o, 'salute', 'SW', 1), 2 + (k * 2 + 1) * (W + 2), 10); });
label(sheet, '2', 2, H + 14);
(['SE', 'SW', 'NE', 'NW'] as Dir[]).forEach((d, k) => [0, 2].forEach((f, n) => blit(sheet, marcher(FOLK[k], 'walk', d, f), 2 + (k * 2 + n) * (W + 2), H + 22)));
writeFileSync(`${out}/1-salute-and-flags.png`, encodePng(sheet, 2, BG));

// 2: the banner, Sputnik, the bear (walking each way, then sniffing), at 3×.
const things = blank(560, 230, [24, 25, 29]);
(['SE', 'SW', 'NW', 'NE'] as const).forEach((d, i) => { const bn = renderBanner(d); blit(things, bn, 40 + (i % 2) * 70 - bn.ax, 100 + Math.floor(i / 2) * 90 - bn.ay); });
const sp = renderSputnik();
blit(things, sp, 170 - sp.ax, 40 - sp.ay);
[0, 90].forEach((yaw, r) => [0, 1, 2, 3].forEach((f) => { const b = renderBear(f, yaw); blit(things, b, 220 + f * 70 - b.ax, 90 + r * 80 - b.ay); }));
[4, 5].forEach((f, k) => { const b = renderBear(f, k * 90); blit(things, b, 220 + 4 * 70 - b.ax, 90 + k * 80 - b.ay); });
writeFileSync(`${out}/2-banner-sputnik-bear.png`, encodePng(things, 3, BG));

// 3: fireworks, frame by frame in each colour; the wink; the plan's banner.
const fw = blank(BURST_FRAMES * 66 + 2, BURST_COLOURS.length * 66 + 90, [16, 18, 24]);
BURST_COLOURS.forEach((c, r) => { for (let f = 0; f < BURST_FRAMES; f++) blit(fw, burstFrame(f, c, r), 2 + f * 66, 2 + r * 66); });
const wink = bubbleFrame(4, 'wink');
blit(fw, wink, 10, BURST_COLOURS.length * 66 + 10);
const pb = planBanner();
const pbImg = blank(pb.b[0].length, pb.b.length, [0, 0, 0]);
pb.b.forEach((row, j) => row.forEach((col, i) => { if (col) { const n = parseInt(col.slice(1), 16); pbImg.rgba.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], (j * pbImg.w + i) * 4); } }));
for (const t of pb.texts) { const n = parseInt(t.col.slice(1), 16); drawText(t.s, t.x, t.y, (i, j) => pbImg.rgba.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], (j * pbImg.w + i) * 4)); }
blit(fw, pbImg, 60, BURST_COLOURS.length * 66 + 20);
writeFileSync(`${out}/3-fireworks-wink-banner.png`, encodePng(fw, 4, BG));

// 4 to 6: the parade in the Canteen, the medal in the director's office, the bear in Siberia.
const world = buildWorld();
const base = world.scene.base;
const L = world.tile;
const y0 = 17 * L;
const people: { id: string; pos: V3; sprite: Frame }[] = [];
for (let k = 0; k < 5; k++) for (const s of [-1, 1]) {
	const pos: V3 = [15.5 * L - k * 46, y0 + s * 15, 0];
	people.push({ id: `m${k}${s}`, pos, sprite: marcher(randomOutfit(400 + k * 2 + (s > 0 ? 1 : 0)), 'walk', 'SE', (k + (s > 0 ? 1 : 0)) % 4, k > 0) });
}
const parade = compose(world.scene, people.map((p) => ({ actor: { id: p.id, pos: p.pos }, sprite: p.sprite })));
// The banner between the front pair, over everything behind it.
const [bx, by] = project(base, [15.5 * L + 2, y0, 0]);
const pr: Image = { w: parade.w, h: parade.h, rgba: parade.rgba };
const banner = renderBanner('SE');
blit(pr, banner, Math.round(bx) - banner.ax, Math.round(by) - banner.ay);
const crop = (x0: number, yy0: number, x1: number, yy1: number, above: number): [number, number, number, number] => {
	const pts = [[x0, yy0], [x1, yy0], [x0, yy1], [x1, yy1]].map(([x, y]) => project(base, [x * L, y * L, 0]));
	const l = Math.min(...pts.map((p) => p[0])), r = Math.max(...pts.map((p) => p[0]));
	const t = Math.min(...pts.map((p) => p[1])) - above, b = Math.max(...pts.map((p) => p[1]));
	return [Math.floor(l), Math.floor(t), Math.ceil(r - l), Math.ceil(b - t)];
};
writeFileSync(`${out}/4-parade.png`, encodePng(pr, 2, BG, crop(9, 14, 19, 20, 110)));

// The Lead comes round the desk onto the carpet, faces the room and salutes; a comrade beside them
// holds out the star they have just pinned on.
const lead: V3 = [3.3 * L, 4.3 * L, 0];
const medal = compose(world.scene, [
	{ actor: { id: 'lead', pos: lead }, sprite: renderAvatar({ ...randomOutfit(77), extras: ['heroStar'] }, 'salute', 'S', 0) },
	{ actor: { id: 'rep', pos: [lead[0] - 6, lead[1] - 30, 0] }, sprite: renderAvatar(randomOutfit(78), 'token', 'SW', 1) },
]);
writeFileSync(`${out}/5-medal.png`, encodePng(medal, 3, BG, crop(1.5, 1, 6, 6, 90)));

// The Palace's own bust, and the wink over it.
const bust = OWN_PIECES.find((o) => o.id === 'pal-lenin')!;
const [ux, uy] = project(base, [(bust.tile[0] + 0.5) * L, (bust.tile[1] + 0.5) * L, 62]);
const palace: Image = { w: world.scene.frame.w, h: world.scene.frame.h, rgba: new Uint8ClampedArray(world.scene.frame.rgba) };
blit(palace, wink, Math.round(ux) - wink.tipX, Math.round(uy) - wink.tipY);
writeFileSync(`${out}/6-bust-wink.png`, encodePng(palace, 4, BG, crop(1, 10, 4, 12.5, 90)));

// The bear at the hut door in Siberia, sniffing.
const hutAt: V3 = [29.6 * L, 2.9 * L, 0];
const bear = renderBear(4, 135);
const sib = compose(world.scene, [{ actor: { id: 'bear', pos: hutAt, radius: 20 }, sprite: { ...bear, ax: bear.ax, ay: bear.ay } as Frame }]);
writeFileSync(`${out}/7-bear-in-siberia.png`, encodePng(sib, 3, BG, crop(26, 0.5, 32, 6, 110)));
void ANIMS;
console.log(`Wrote ${out}/1-salute-and-flags.png … 7-bear-in-siberia.png.`);
