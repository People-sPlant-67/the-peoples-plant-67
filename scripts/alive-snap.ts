/**
 * The art check for the plant comes alive: the new poses (soda, tea, stretch, yawn,
 * pocket watch, sweeping, dozing, chess, the attendant's token) on four comrades, the held things up
 * close, pigeons, chimney smoke, the far train, and a busy Canteen.
 * Usage: npx tsx scripts/alive-snap.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { CHIMNEY_TOPS, FAR_TRAIN, type PigeonFrame, renderFarTrain, renderPigeon, renderPuff } from '../src/art/ambient';
import { ANIMS, type Anim, type Dir, renderAvatar } from '../src/art/avatar';
import { drawText } from '../src/art/font';
import { ATTENDANT, type Outfit, randomOutfit } from '../src/art/outfits';
import { type Frame, project } from '../src/art/render';
import { compose } from '../src/art/scene';
import type { V3 } from '../src/art/sdf';
import { farthestFirst, hazeAt, renderLandmark, wasteGround, wasteLandmarks } from '../src/art/wasteland';
import { tileCentre } from '../src/world/path';
import { OWN_PIECES, TRACK, buildWorld } from '../src/world/zones';
import { type Image, blank, blit, encodePng } from './png';

const out = process.argv[2] ?? 'spike-output';
mkdirSync(out, { recursive: true });
const BG = [42, 44, 50];
/** Four comrades: different skin, hair and clothes. */
const FOLK: Outfit[] = [5, 44, 91, 170].map((s, k) => ({ ...randomOutfit(s * 7919 + 3), skin: (['skinA', 'skinB', 'skinC', 'skinD'] as const)[k] }));
const CROP = { x: 8, y: 4, w: 68, h: 98 };

/**
 * The interesting part of a frame.
 *
 * @param o Outfit.
 * @param anim Animation.
 * @param dir View.
 * @param frame Frame.
 * @returns Image.
 */
function cell(o: Outfit, anim: Anim, dir: Dir, frame: number): Image {
	const f = renderAvatar(o, anim, dir, frame);
	const img: Image = { w: CROP.w, h: CROP.h, rgba: new Uint8ClampedArray(CROP.w * CROP.h * 4) };
	for (let j = 0; j < CROP.h; j++) img.rgba.set(f.rgba.subarray(((CROP.y + j) * f.w + CROP.x) * 4, ((CROP.y + j) * f.w + CROP.x + CROP.w) * 4), j * CROP.w * 4);
	return img;
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

// 1: every new pose, frame by frame, on one comrade from the south-east; then the busiest frame on
// the other three from the south-west.
const ROWS: [Anim, number][] = [['drink', 2], ['tea', 2], ['stretch', 1], ['yawn', 1], ['watch', 1], ['sweep', 0], ['doze', 3], ['chess', 3], ['token', 1]];
const most = Math.max(...ROWS.map(([a]) => ANIMS[a].length));
const poses = blank((most + 3) * (CROP.w + 2) + 14, ROWS.length * (CROP.h + 2) + 2, [24, 25, 29]);
ROWS.forEach(([anim, key], r) => {
	const y = 2 + r * (CROP.h + 2);
	label(poses, String(r + 1), 2, y + 2);
	const who = anim === 'token' ? ATTENDANT : FOLK[0];
	for (let f = 0; f < ANIMS[anim].length; f++) blit(poses, cell(who, anim, 'SE', f), 12 + f * (CROP.w + 2), y);
	FOLK.slice(1).forEach((o, k) => blit(poses, cell(anim === 'token' ? ATTENDANT : o, anim, anim === 'token' ? (['SW', 'S', 'NW'] as Dir[])[k] : 'SW', key), 12 + (most + k) * (CROP.w + 2), y));
});
writeFileSync(`${out}/1-poses.png`, encodePng(poses, 2, BG));

// 2: the things in hand, up close: soda, tea, the pocket watch, the broom, the token.
const close: [Outfit, Anim, Dir, number][] = [[FOLK[1], 'drink', 'SE', 2], [FOLK[2], 'tea', 'SE', 0], [FOLK[3], 'watch', 'SE', 1], [FOLK[0], 'sweep', 'SE', 2], [ATTENDANT, 'token', 'SE', 1]];
const things = blank(close.length * (CROP.w + 2) + 2, CROP.h + 4, [24, 25, 29]);
close.forEach(([o, a, d, f], k) => blit(things, cell(o, a, d, f), 2 + k * (CROP.w + 2), 2));
writeFileSync(`${out}/2-in-hand.png`, encodePng(things, 5, BG));

// 3: pigeons, sat, pecking and flying, from two sides.
const birds = blank(6 * 24 + 4, 26, [24, 25, 29]);
[0, 90].forEach((yaw, r) => ([0, 1, 2] as PigeonFrame[]).forEach((f, k) => { const b = renderPigeon(f, yaw); blit(birds, b, 4 + (r * 3 + k) * 24 + 12 - b.ax, 20 - b.ay); }));
writeFileSync(`${out}/3-pigeons.png`, encodePng(birds, 8, BG));

// 4: behind the plant: the wasteland, smoke from the chimneys, the far train in the haze, pigeons on the wall.
const world = buildWorld();
const base = world.scene.base;
const g = wasteGround(base, TRACK.y);
while (!g.next(256));
const { layer } = g;
const img: Image = { w: layer.w, h: layer.h, rgba: new Uint8ClampedArray(layer.rgba) };
const half = { w: base.w / 2, h: base.h / 2 };
/**
 * Paint a frame over the picture at a base-frame position, by alpha, hazed by distance when asked.
 *
 * @param f Frame.
 * @param x Left, base-frame pixels.
 * @param y Top.
 * @param haze Fade into the haze like the ground there.
 * @param alpha Extra opacity.
 */
const over = (f: Pick<Frame, 'w' | 'h' | 'rgba'>, x: number, y: number, haze: number | false = false, alpha = 1): void => {
	for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
		const s = (j * f.w + i) * 4, a = (f.rgba[s + 3] / 255) * alpha;
		if (!a) continue;
		const X = Math.round(x + i - layer.x), Y = Math.round(y + j - layer.y);
		if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
		// haze: false for none, else how much of the distance's haze to take, at least.
		const q = haze === false ? 0 : Math.max(haze, hazeAt(x + i - half.w, y + j - half.h, half) * (haze ? 1 : 0.5));
		const d = (Y * img.w + X) * 4;
		for (let c = 0; c < 3; c++) {
			const v = f.rgba[s + c] + ([22, 24, 29][c] - f.rgba[s + c]) * q;
			img.rgba[d + c] = img.rgba[d + c] * (1 - a) + v * a;
		}
	}
};
// The far train runs behind everything out there, half lost in the haze.
const train = renderFarTrain(base);
const [tx, ty] = project(base, [12 * world.tile, FAR_TRAIN.y, 0]);
over(train, tx - train.ax, ty - train.ay, 0.7);
for (const m of farthestFirst(wasteLandmarks()).map((mk) => renderLandmark(base, mk))) over(m.sprite, m.x, m.y);
// Smoke: a column of puffs from each chimney, growing and thinning as they rise and drift with the wind.
const puffs = [0, 1, 2, 3, 4].map(renderPuff);
for (const top of CHIMNEY_TOPS) {
	for (let k = 0; k < 9; k++) {
		const step = Math.min(4, Math.floor(k / 2));
		const p: V3 = [top[0] + k * 9, top[1] - k * 4, top[2] + 6 + k * 13];
		const [px, py] = project(base, p);
		over(puffs[step], px - puffs[step].ax, py - puffs[step].ay, 0, 0.9 - k * 0.07);
	}
}
over(world.scene.frame, 0, 0);
// Pigeons along the top of the north-east wall, one taking off.
for (const [x, f, yaw] of [[5.2, 0, 90], [5.6, 1, 90], [9.3, 0, 0], [16.1, 0, 90], [16.6, 2, 0]] as [number, PigeonFrame, number][]) {
	const b = renderPigeon(f, yaw);
	const [px, py] = project(base, [x * world.tile, -4, 165 + (f === 2 ? 8 : 0)]);
	over(b, Math.round(px) - b.ax, Math.round(py) - b.ay);
}
// The chimneys and the far train above the back wall, then the pigeons on the wall up close.
const [cx, cy] = project(base, [10 * world.tile, -12 * world.tile, 160]);
writeFileSync(`${out}/4-behind-the-plant.png`, encodePng(img, 1, [22, 24, 29], [Math.round(cx - layer.x) - 800, Math.round(cy - layer.y) - 520, 1600, 900]));
const [wx, wy] = project(base, [7.5 * world.tile, 0, 165]);
writeFileSync(`${out}/4b-pigeons-on-the-wall.png`, encodePng(img, 4, [22, 24, 29], [Math.round(wx - layer.x) - 70, Math.round(wy - layer.y) - 40, 260, 90]));

// 5: a busy Canteen: the plant's own soda machine and chess table, comrades on their breaks.
const L = world.tile;
const ownAt = (kind: string) => { const o = OWN_PIECES.find((p) => p.kind === kind)!; return tileCentre(world, o.tile[0], o.tile[1]); };
const c = ownAt('chess'), sd = ownAt('soda');
const scene = world.scene;
const sam = world.zones.canteen.spots.slice(-2);
const tableSpots = world.zones.canteen.spots;
const people: { id: string; pos: V3; o: Outfit; anim: Anim; dir: Dir; f: number; over?: string[]; foot?: { x0: number; x1: number; y0: number; y1: number; z0: number } }[] = [
	// At the soda machine (it faces south-west, +y): stood in front of it with a glass.
	{ id: 'a', pos: [sd[0], sd[1] + 26, 0], o: randomOutfit(301), anim: 'drink', dir: 'NE', f: 2 },
	// At the chess table, one on each corner stool, facing each other across the board.
	{ id: 'b', pos: [c[0] + 15, c[1] - 15, 0], o: randomOutfit(302), anim: 'chess', dir: 'W', f: 3, over: ['can-chess'] },
	{ id: 'c', pos: [c[0] - 15, c[1] + 15, 0], o: randomOutfit(303), anim: 'chess', dir: 'E', f: 0, over: ['can-chess'] },
	// Tea at the samovar, three in a line.
	{ id: 'd', pos: sam[0], o: randomOutfit(304), anim: 'tea', dir: 'SE', f: 2 },
	{ id: 'e', pos: sam[1], o: randomOutfit(305), anim: 'tea', dir: 'SE', f: 0 },
	{ id: 'f', pos: [sam[1][0] - 34, sam[1][1] + 22, 0], o: randomOutfit(306), anim: 'tea', dir: 'NE', f: 1 },
	// At the tables: one asleep, one stretching, one yawning, one checking the time; one sweeping.
	{ id: 'g', pos: tableSpots[1], o: randomOutfit(307), anim: 'doze', dir: 'NE', f: 3 },
	{ id: 'h', pos: tableSpots[12], o: randomOutfit(308), anim: 'stretch', dir: 'SW', f: 1 },
	{ id: 'i', pos: tableSpots[23], o: randomOutfit(309), anim: 'yawn', dir: 'NE', f: 1 },
	{ id: 'j', pos: tableSpots[30], o: randomOutfit(310), anim: 'watch', dir: 'SW', f: 1 },
	{ id: 'k', pos: [20.4 * L, 16.4 * L, 0], o: randomOutfit(311), anim: 'sweep', dir: 'SW', f: 2 },
];
const busy = compose(scene, people.map((q) => ({ actor: { id: q.id, pos: q.pos, over: q.over, foot: q.foot }, sprite: renderAvatar(q.o, q.anim, q.dir, q.f) })));
const corners = [[9, 13], [24, 13], [9, 20], [24, 20]].map(([x, y]) => project(base, [x * L, y * L, 0]));
const l = Math.min(...corners.map((q) => q[0])), r = Math.max(...corners.map((q) => q[0]));
const t = Math.min(...corners.map((q) => q[1])) - 110, b = Math.max(...corners.map((q) => q[1]));
writeFileSync(`${out}/5-busy-canteen.png`, encodePng(busy, 2, BG, [Math.floor(l), Math.floor(t), Math.ceil(r - l), Math.ceil(b - t)]));
console.log(`Wrote ${out}/1-poses.png … 5-busy-canteen.png.`);
