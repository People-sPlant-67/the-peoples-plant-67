/**
 * The art check for furniture: every catalogue piece facing south-east and south-west
 * beside a comrade for scale (at 1× and 3×), the five posters flat, and a crowded Canteen and
 * Palace of Culture with pieces stood about, posters on the Palace wall and comrades among them.
 * Usage: npx tsx scripts/furniture-snap.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderAvatar } from '../src/art/avatar';
import { wallDecal } from '../src/art/env';
import { drawText } from '../src/art/font';
import { type Facing, PIECE_KINDS, POSTER_KINDS, type PieceKind, type PosterKind, pieceProp, posterSign, renderPiece } from '../src/art/furniture';
import { randomOutfit } from '../src/art/outfits';
import { PX, TILE, project } from '../src/art/render';
import { compose } from '../src/art/scene';
import type { V3 } from '../src/art/sdf';
import { buildWorld } from '../src/world/zones';
import { type Image, blank, blit, encodePng } from './png';

const out = process.argv[2] ?? 'spike-output';
mkdirSync(out, { recursive: true });
const L = TILE;
const BG = [42, 44, 50];
const INKY = [230, 220, 190, 255];

/**
 * Write a label in the pixel font.
 *
 * @param img Image.
 * @param s Digits or Cyrillic.
 * @param x Left.
 * @param y Top.
 */
function label(img: Image, s: string, x: number, y: number): void {
	drawText(s, x, y, (i, j) => { if (i >= 0 && j >= 0 && i < img.w && j < img.h) img.rgba.set(INKY, (j * img.w + i) * 4); });
}

/**
 * A tile's outline on the floor, so each piece shows the one tile it takes.
 *
 * @param img Image.
 * @param cx Middle of the tile, x.
 * @param cy Middle of the tile, y.
 */
function tile(img: Image, cx: number, cy: number): void {
	for (let i = -32; i <= 32; i++) {
		const dy = 16 - Math.abs(i) / 2;
		for (const y of [cy - dy, cy + dy]) {
			const k = (Math.round(y) * img.w + cx + i) * 4;
			if (k >= 0 && k < img.rgba.length) img.rgba.set([70, 74, 82, 255], k);
		}
	}
}

// 1 and 2: each piece facing south-east and south-west, a comrade at the left for scale.
const CELL = { w: 74, h: 128, footY: 112 };
const FACINGS: Facing[] = [0, 1];
const rows = [PIECE_KINDS.slice(0, 5), PIECE_KINDS.slice(5)];
const comrade = renderAvatar(randomOutfit(42), 'idle', 'S', 0);
const pieces = blank(CELL.w * (1 + 5 * FACINGS.length) + 4, rows.length * (CELL.h + 10) + 2, [24, 25, 29]);
rows.forEach((row, r) => {
	const y0 = 2 + r * (CELL.h + 10);
	tile(pieces, CELL.w / 2, y0 + CELL.footY);
	blit(pieces, comrade, CELL.w / 2 - comrade.ax, y0 + CELL.footY - comrade.ay);
	row.forEach((kind: PieceKind, k) => FACINGS.forEach((f, n) => {
		const cx = CELL.w * (1 + k * FACINGS.length + n) + CELL.w / 2;
		const sprite = renderPiece(kind, f);
		tile(pieces, cx, y0 + CELL.footY);
		blit(pieces, sprite, cx - sprite.ax, y0 + CELL.footY - sprite.ay);
		if (n === 0) label(pieces, String(PIECE_KINDS.indexOf(kind) + 1), cx - CELL.w / 2 + 3, y0 + 2);
	}));
});
writeFileSync(`${out}/1-pieces-3x.png`, encodePng(pieces, 3, BG));
writeFileSync(`${out}/2-pieces-1x.png`, encodePng(pieces, 1, BG));

// 3: the posters, flat, at 4×.
/**
 * A poster drawn flat: its artwork, then its lettering.
 *
 * @param kind Poster.
 * @returns Image.
 */
function flat(kind: PosterKind): Image {
	const s = posterSign(kind);
	const img = blank(s.b[0].length, s.b.length, [0, 0, 0]);
	s.b.forEach((row, j) => row.forEach((c, i) => {
		const n = c ? parseInt(c.slice(1), 16) : 0;
		img.rgba.set(c ? [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255] : [0, 0, 0, 0], (j * img.w + i) * 4);
	}));
	for (const t of s.texts) {
		const n = parseInt(t.col.slice(1), 16);
		drawText(t.s, t.x, t.y, (i, j) => img.rgba.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], (j * img.w + i) * 4));
	}
	return img;
}
const flats = POSTER_KINDS.map(flat);
const posters = blank(flats.reduce((w, f) => w + f.w + 4, 4), Math.max(...flats.map((f) => f.h)) + 12, [24, 25, 29]);
let px = 4;
flats.forEach((f, k) => { label(posters, String(k + 1), px, 1); blit(posters, f, px, 8); px += f.w + 4; });
writeFileSync(`${out}/3-posters.png`, encodePng(posters, 4, BG));

// 4 and 5: the Canteen and the Palace, furnished.
const world = buildWorld();
const base = { ...world.scene.base, rgba: new Uint8ClampedArray(world.scene.base.rgba), group: world.scene.base.group };
/**
 * Hang a poster on the north-west wall (x = 0), centred along y.
 *
 * @param kind Poster.
 * @param cy Middle along y, world units.
 * @param zTop Top edge height.
 */
function onNW(kind: PosterKind, cy: number, zTop: number): void {
	const s = posterSign(kind);
	const w = s.b[0].length * 2 * Math.SQRT2 * PX;
	wallDecal(base, s, [0, cy + w / 2, zTop], 'left', ['wallL'], 2);
}
// The Palace's own stretch of wall is full (its banners and the group photo), so these go up
// either side of it: two in the director's office, three along the Recruitment Office.
onNW('fiveYear', 2.1 * L, 122);
onNW('lenin', 5.6 * L, 128);
onNW('space', 14 * L, 128);
onNW('quiet', 16.2 * L, 128);
onNW('harvest', 18.3 * L, 128);

/** Pieces stood about: kind, facing, tile. */
const placed: [PieceKind, Facing, [number, number]][] = [
	// The Canteen.
	['palm', 0, [9, 13]], ['soda', 1, [20, 13]], ['soda', 1, [21, 13]], ['chess', 0, [21, 17]], ['loudspeaker', 0, [22, 19]],
	['rubber', 0, [9, 19]], ['firePoint', 1, [23, 13]], ['globe', 0, [20, 19]], ['banner', 1, [11, 13]],
	// The Palace.
	['lenin', 0, [1, 7]], ['bookcase', 1, [3, 7]], ['palm', 0, [0, 12]], ['banner', 0, [2, 12]], ['rubber', 0, [6, 12]],
];
const { grid } = world;
const spots = new Set(Object.values(world.zones).flatMap((z) => [...z.spots, ...z.stations]).map(([x, y]) => `${Math.floor(x / L)},${Math.floor(y / L)}`));
for (const [kind, , [tx, ty]] of placed) {
	const why = !grid.walkable[ty * grid.w + tx] ? 'not floor anyone walks' : spots.has(`${tx},${ty}`) ? 'a spot or station' : '';
	if (why) console.log(`Note: ${kind} at ${tx},${ty} stands on ${why}.`);
}
const props = [...world.scene.props, ...placed.map(([kind, f, t], k) => pieceProp(`piece${k}`, kind, f, t, base))];
const scene = { ...world.scene, base, props };
/** Comrades about the place, for scale: where, which way, and who. */
const people: [V3, 'S' | 'SE' | 'SW' | 'NW' | 'NE', number][] = [
	...world.zones.canteen.spots.filter((_s, k) => k % 3 === 0).map((s, k): [V3, 'S' | 'SE' | 'SW' | 'NW' | 'NE', number] => [s, k % 2 ? 'NE' : 'SW', 100 + k]),
	...world.zones.palace.spots.filter((_s, k) => k % 2 === 0).map((s, k): [V3, 'S' | 'SE' | 'SW' | 'NW' | 'NE', number] => [s, 'NW', 200 + k]),
];
const frame = compose(scene, people.map(([pos, dir, seed]) => ({ actor: { id: `c${seed}`, pos }, sprite: renderAvatar(randomOutfit(seed), 'idle', dir, 0) })));

/**
 * The part of the picture over some tiles, with room above for tall things.
 *
 * @param x0 First tile, x.
 * @param y0 First tile, y.
 * @param x1 Past the last tile, x.
 * @param y1 Past the last tile, y.
 * @param above Pixels of headroom.
 * @returns Crop.
 */
function crop(x0: number, y0: number, x1: number, y1: number, above: number): [number, number, number, number] {
	const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => project(base, [x * L, y * L, 0]));
	const l = Math.min(...pts.map((p) => p[0])), r = Math.max(...pts.map((p) => p[0]));
	const t = Math.min(...pts.map((p) => p[1])) - above, b = Math.max(...pts.map((p) => p[1]));
	return [Math.floor(l), Math.floor(t), Math.ceil(r - l), Math.ceil(b - t)];
}
writeFileSync(`${out}/4-canteen.png`, encodePng(frame, 2, BG, crop(9, 13, 24, 20, 110)));
writeFileSync(`${out}/5-palace.png`, encodePng(frame, 3, BG, crop(0, 7, 7, 13, 170)));
writeFileSync(`${out}/6-the-north-west-wall.png`, encodePng(frame, 2, BG, crop(0, 0, 9, 20, 170)));
console.log(`Wrote ${out}/1-pieces-3x.png … 6-the-north-west-wall.png.`);
