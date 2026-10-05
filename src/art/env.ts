/**
 * Environment scenes for the art spike: a furnished corner of the Production Floor and a
 * patch of Siberia. The prop builders and signage helpers are exported so the whole-plant
 * world (src/world/zones.ts) furnishes its zones with exactly the same objects. Geometry is ray-marched with the same renderer as the avatars, so the
 * projection and light match; signage is drawn as sheared pixel decals so text stays legible.
 * Each scene is split into a base layer and depth-sorted props (see scene.ts).
 */

import { drawText, textWidth } from './font';
import type { ZoneId } from '../world/types';
import { INK } from './palette';
import { type Frame, PX, RES, TILE, makeView, project, put } from './render';
import { type Scene, flatten, renderLayers } from './scene';
import { type Pattern, type PatternOut, type Prim, type V3, box, cone, cylinder, ellipsoid, hash, roundCone } from './sdf';

export type { Scene } from './scene';

const L = TILE;
const R2 = Math.SQRT2;

/** A bitmap of hex colours (null = transparent), drawn onto a wall with 2:1 shear. */
export type Bitmap = (string | null)[][];

/**
 * Create an empty bitmap.
 *
 * @param {number} w Width.
 * @param {number} h Height.
 * @param {string | null} fill Fill colour.
 * @returns {Bitmap} Bitmap.
 */
export function bitmap(w: number, h: number, fill: string | null): Bitmap {
	return Array.from({ length: h }, () => Array<string | null>(w).fill(fill));
}

/**
 * Plot a pattern string into a bitmap.
 *
 * @param {Bitmap} b Bitmap.
 * @param {string[]} rows Rows, '#' = lit.
 * @param {number} x Left.
 * @param {number} y Top.
 * @param {string} col Colour.
 */
export function stamp(b: Bitmap, rows: string[], x: number, y: number, col: string): void {
	rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#' && b[y + j]?.[x + i] !== undefined) b[y + j][x + i] = col; }));
}

/** A run of lettering on a sign, in bitmap pixels. Kept apart from the artwork: see wallDecal. */
export interface TextRun {
	s: string;
	x: number;
	y: number;
	col: string;
	/** Fraction of lettering pixels left out, for worn stencil paint. */
	worn?: number;
}

/** Sign artwork plus the lettering to go on it. */
export interface Sign {
	b: Bitmap;
	texts: TextRun[];
}

/**
 * Add a run of text centred horizontally on a sign.
 *
 * @param {Sign} sign Sign.
 * @param {string} s Text.
 * @param {number} y Top row.
 * @param {string} col Colour.
 */
export function centred(sign: Sign, s: string, y: number, col: string): void {
	sign.texts.push({ s, x: Math.floor((sign.b[0].length - textWidth(s)) / 2), y, col });
}

/**
 * Each zone's sign, in Cyrillic: a plaque on the back wall, or a hanging board for zones
 * that have no back wall. Short, period-correct names: ДИРЕКТОР (director), ГОСПЛАН (the
 * State Planning Committee), ИНСПЕКЦИЯ (inspection), ЦЕХ №1 (workshop no. 1), РЕМОНТ
 * (repair), ГИГИЕНА (hygiene), СТОЛОВАЯ (canteen), ДВОРЕЦ КУЛЬТУРЫ (Palace of Culture),
 * ОТДЕЛ КАДРОВ (personnel department).
 */
export const ZONE_SIGNS: Record<ZoneId, string> = {
	recruitment: 'ОТДЕЛ КАДРОВ',
	directorate: 'ДИРЕКТОР',
	planRoom: 'ГОСПЛАН',
	inspectorate: 'ИНСПЕКЦИЯ',
	production: 'ЦЕХ №1',
	repair: 'РЕМОНТ',
	hygiene: 'ГИГИЕНА',
	canteen: 'СТОЛОВАЯ',
	palace: 'ДВОРЕЦ КУЛЬТУРЫ',
	siberia: 'СИБИРЬ',
};

/** Every string painted in the scenes, so a test can prove the font covers them. Zone signs are included automatically. */
export const SIGNAGE = [...new Set(['СЛАВА', 'ТРУДУ!', '№67', 'ПЛАН—ЗАКОН!', '5 В 4!', 'ПЛАН', '%', 'СИБИРЬ', ...Object.values(ZONE_SIGNS)])];

/** Five-point star, 9×9, for posters and banners. */
export const STAR = ['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'];

/**
 * "СЛАВА ТРУДУ!" (Glory to labour) poster.
 *
 * @returns {Sign} Poster.
 */
export function posterGlory(): Sign {
	const b = bitmap(25, 36, INK.posterRed);
	const sign: Sign = { b, texts: [] };
	for (let i = 0; i < 25; i++) { b[0][i] = b[35][i] = INK.posterRedDark; }
	for (let j = 0; j < 36; j++) { b[j][0] = b[j][24] = INK.posterRedDark; }
	centred(sign, 'СЛАВА', 3, INK.posterCream);
	centred(sign, 'ТРУДУ!', 10, INK.posterCream);
	stamp(b, STAR, 8, 17, INK.posterGold);
	for (let j = 28; j < 35; j++) for (let i = 1; i < 24; i++) b[j][i] = INK.posterBlack;
	centred(sign, '№67', 29, INK.posterGold);
	return sign;
}

/**
 * "ПЛАН—ЗАКОН!" (The plan is law) with "5 В 4!" (five-year plan in four).
 *
 * @returns {Sign} Poster.
 */
export function posterPlan(): Sign {
	// No rule between the lines: a sloped rule between upright, stepped glyphs reads as a
	// strikethrough. The extra rows give the two lines room.
	const b = bitmap(47, 21, INK.posterCream);
	const sign: Sign = { b, texts: [] };
	for (let i = 0; i < 47; i++) { b[0][i] = b[20][i] = INK.posterRed; b[1][i] = b[19][i] = INK.posterRed; }
	for (let j = 0; j < 21; j++) { b[j][0] = b[j][46] = INK.posterRed; }
	centred(sign, 'ПЛАН—ЗАКОН!', 3, INK.posterRed);
	centred(sign, '5 В 4!', 11, INK.posterBlack);
	return sign;
}

/**
 * The Plan board: chalk bar chart. In the real app the bars are open issue counts per agent.
 *
 * @returns {Sign} Board.
 */
export function planBoard(): Sign {
	const W = 48, H = 32;
	const b = bitmap(W, H, INK.boardGreen);
	for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
		if (i < 2 || j < 2 || i >= W - 2 || j >= H - 2) b[j][i] = i === 0 || j === 0 || i === W - 1 || j === H - 1 ? '#3e2917' : '#7a5230';
		else if (hash(i, j, 7) < 0.06) b[j][i] = INK.boardGreenDark;
	}

	for (let i = 4; i < 44; i++) b[27][i] = INK.chalkDim;
	for (let i = 4; i < 44; i += 2) b[12][i] = INK.chalkDim;
	const bars = [11, 14, 9, 17, 13];
	bars.forEach((hgt, k) => {
		const x = 7 + k * 8;
		const col = hgt > 15 ? '#d0453a' : INK.chalk;
		for (let j = 27 - hgt; j < 27; j++) for (let i = x; i < x + 4; i++) if (hash(i, j, k) > 0.12) b[j][i] = col;
	});
	return { b, texts: [{ s: 'ПЛАН', x: 4, y: 4, col: INK.chalk }, { s: '%', x: 40, y: 4, col: INK.chalkDim }] };
}

/**
 * Draw a sign onto a wall face, and only where the wall itself is the visible surface of this
 * frame. On the base layer that keeps pipes in front of the poster; furniture is a separate
 * prop sprite and occludes it by draw order.
 *
 * The artwork is sheared 2:1 per pixel column to sit in the iso plane. Lettering is not: each
 * glyph is drawn upright and the whole glyph steps down the slope. Shearing 3-5px glyphs per
 * column broke them apart (В read as Е, № as Н:), which is also why pixel-art signs are
 * lettered this way by hand.
 *
 * @param {Frame} f Frame.
 * @param {Sign} sign Artwork and lettering.
 * @param {V3} topLeft World point of the bitmap's top-left corner.
 * @param {'left' | 'right'} wall Which wall orientation: left walls rise to the right, right walls fall.
 * @param {string[]} groups Groups the decal may paint over.
 * @param {number} scale Pixel scale.
 */
export function wallDecal(f: Frame, sign: Sign, topLeft: V3, wall: 'left' | 'right', groups: string[], scale = 1): void {
	const { b } = sign;
	const [fx, fy] = project(f, topLeft);
	const x0 = Math.round(fx), y0 = Math.round(fy);
	const allowed = new Set(groups.map((g) => f.groups.indexOf(g)).filter((g) => g >= 0));
	const slope = (u: number): number => (wall === 'right' ? Math.floor(u / 2) : -Math.floor(u / 2));
	const plot = (i: number, j: number, col: string): void => {
		if (i < 0 || j < 0 || i >= f.w || j >= f.h) return;
		if (!allowed.has(f.group[j * f.w + i])) return;
		put(f, i, j, col);
	};
	for (let v = 0; v < b.length * scale; v++) {
		for (let u = 0; u < b[0].length * scale; u++) {
			const col = b[Math.floor(v / scale)][Math.floor(u / scale)];
			if (col) plot(x0 + u, y0 + v + slope(u), col);
		}
	}
	for (const run of sign.texts) {
		let cx = run.x;
		for (const ch of run.s) {
			const w = textWidth(ch);
			// Step the whole glyph by the slope at its centre column, so it sits in its slot.
			const dy = slope(Math.round((cx + w / 2) * scale));
			drawText(ch, 0, 0, (gi, gj) => {
				if (run.worn && hash(cx + gi, run.y + gj, 21) < run.worn) return;
				for (let sj = 0; sj < scale; sj++) for (let si = 0; si < scale; si++) {
					plot(x0 + (cx + gi) * scale + si, y0 + (run.y + gj) * scale + sj + dy, run.col);
				}
			});
			cx += w + 1;
		}
	}
}

/**
 * Brick above, painted oil-paint dado below: the standard Soviet industrial interior.
 *
 * @param {number} a Position along the wall.
 * @param {number} z Height.
 * @param {number} base Tone shift so the two walls read as differently lit planes.
 * @returns {PatternOut} Surface.
 */
export function wallSurface(a: number, z: number, base: number): PatternOut {
	if (z < 34) {
		if (z > 32.6) return { mat: 'paintLine', shift: base };
		return { mat: 'paintGreen', shift: base + (hash(Math.floor(a / (1.4 * PX)), Math.floor(z / (1.2 * PX)), 3) < 0.04 ? -1 : 0) };
	}
	// Brick rows 7px tall, bricks 16px long, mortar exactly 1px, whatever the pixel density.
	const h = (7 * PX) / 0.866;
	const r = Math.floor(z / h);
	if (z - r * h < 1.15 * PX) return { mat: 'mortar', shift: base };
	const lb = 16 * R2 * PX;
	const off = (r % 2) * lb * 0.5;
	const aa = ((a + off) % lb + lb) % lb;
	if (aa < R2 * PX) return { mat: 'mortar', shift: base };
	const k = hash(r, Math.floor((a + off) / lb), 11);
	return { mat: 'brick', shift: base + (k < 0.2 ? -1 : k > 0.9 ? 1 : 0) };
}

/** Scene build options. */
export interface SceneOpts {
	/** Draw the old single flat image with no props, for regression comparison only. */
	flat?: boolean;
}

/**
 * The furnished Production Floor corner with Alexei's anvil.
 *
 * @param {SceneOpts} opts Build options.
 * @returns {Scene} Scene.
 */
export function plantCorner(opts: SceneOpts = {}): Scene {
	// 8 tiles wide with tall walls: at Habbo scale the 2× signage needs the room.
	const NX = 8, NY = 5, WH = 170;
	const prims: Prim[] = [];
	const props: { id: string; prims: Prim[] }[] = [];
	/** Start a new prop; primitives pushed until the next call belong to it. */
	const prop = (id: string): Prim[] => { const p: Prim[] = []; props.push({ id, prims: p }); return p; };
	const actor: V3 = [3.3 * L, 2.5 * L, 0];
	const anvil: V3 = [actor[0] + 32, actor[1], 0];

	const floorPat: Pattern = (lx, ly, _lz, _nx, _ny, nz) => {
		const x = lx + NX * L / 2, y = ly + NY * L / 2;
		if (nz < 0.9) return { mat: 'concrete', shift: -1 };
		// Half-width of 0.72px keeps each grout line exactly one pixel wide along the 2:1 diagonal.
		if (Math.abs(x - Math.round(x / L) * L) < 0.72 * PX || Math.abs(y - Math.round(y / L) * L) < 0.72 * PX) return { mat: 'grout' };
		const dx = x - anvil[0] + 4, dy = y - anvil[1];
		const od = Math.sqrt(dx * dx * 0.6 + dy * dy) + hash(Math.floor(x), Math.floor(y), 5) * 5;
		if (od < 17) return { mat: 'oil' };
		const w = hash(Math.floor(x / (2.83 * PX)), Math.floor(y / (2.83 * PX)), 1);
		return w < 0.035 ? { shift: -1 } : w > 0.985 ? { shift: 1 } : null;
	};
	prims.push(box([NX * L / 2, NY * L / 2, -3], [NX * L / 2, NY * L / 2, 3], 0, 'concrete', { group: 'floor', pattern: floorPat }));

	const lwC: V3 = [-4, NY * L / 2 - 4, WH / 2 - 3];
	prims.push(box(lwC, [4, NY * L / 2 + 4, WH / 2 + 3], 0, 'brick', {
		group: 'wallL',
		pattern: (_lx, ly, lz, nx, _ny, nz) => {
			if (nz > 0.9) return { mat: 'concrete', shift: 0 };
			if (nx < 0.9) return { mat: 'brick', shift: 0 };
			return wallSurface(-(ly + lwC[1]), lz + lwC[2], 1);
		},
	}));
	const rwC: V3 = [NX * L / 2, -4, WH / 2 - 3];
	prims.push(box(rwC, [NX * L / 2, 4, WH / 2 + 3], 0, 'brick', {
		group: 'wallR',
		pattern: (lx, ly, lz, nx, ny, nz) => {
			void ly;
			if (nz > 0.9) return { mat: 'concrete', shift: 0 };
			if (ny < 0.9) return { mat: 'brick', shift: nx > 0.5 ? 0 : -1 };
			return wallSurface(lx + rwC[0], lz + rwC[2], 1);
		},
	}));

	// Riveted steel column against the right wall. A prop, not base: an agent can walk past in front of it.
	addColumn(prop('column'), [4 * L, 5, 0], WH);

	// Pipes along the left wall
	prims.push(roundCone([5, -4, 146], [5, NY * L, 146], 3.3, 3.3, 'steel', { group: 'pipe' }));
	prims.push(roundCone([4, -4, 137], [4, NY * L, 137], 2.2, 2.2, 'red', { group: 'pipe2' }));
	for (const y of [0.9 * L, 2.9 * L, 4.4 * L]) prims.push(box([2.2, y, 142], [2.4, 1.3, 8], 0.4, 'iron', { group: 'bracket' }));

	// Workbench against the left wall, anvil, crates by the right wall, coal in the far corner
	addWorkbench(prop('workbench'), [15, 1.6 * L, 0]);
	addAnvil(prop('anvil'), anvil);
	addCrates(prop('crates'), [6.2 * L, 13, 0]);
	addCoal(prop('coal'), [7.4 * L, 1.2 * L, 0]);

	const { base, props: layers } = renderLayers(prims, props, makeView(0), opts.flat);
	// Signage is drawn at 2 screen pixels per bitmap pixel so the 5px lettering reads at 1× zoom.
	wallDecal(base, posterGlory(), [0, 4.3 * L, 128], 'left', ['wallL'], 2);
	wallDecal(base, posterPlan(), [4.4 * L, 0, 124], 'right', ['wallR'], 2);
	wallDecal(base, planBoard(), [4, 0, 128], 'right', ['wallR'], 2);
	// Light wear only: heavier wear chips the small raised o of № into a colon.
	const stencil: Sign = { b: bitmap(textWidth('№67'), 5, null), texts: [{ s: '№67', x: 0, y: 0, col: INK.stencil, worn: 0.06 }] };
	// On the right wall, clear of the pipes, and kept 6px below the wall top: stepped glyphs sit
	// up to ±5px off the true slope at 3×.
	wallDecal(base, stencil, [1.2 * L, 0, 160], 'right', ['wallR'], 3);
	// The loop slips behind the far end of the workbench, along the right wall in front of the
	// column, beside the crates, then behind the anvil. tests/scene.test.ts checks it never
	// enters a prop's footprint, so occlusion can be judged by eye without clipping.
	const patrol: V3[] = [[60, 160, 0], [44, 120, 0], [44, 30, 0], [18, 28, 0], [150, 26, 0], [250, 26, 0], [250, 70, 0], [190, 92, 0], [230, 92, 0], [300, 110, 0], [230, 170, 0]];
	return { base, props: layers, frame: flatten(base, layers), actor, actorDir: 'SE', workProps: ['anvil'], patrol, emitters: [] };
}

/**
 * A patch of Siberia: snow, pines, a lonely hut and a signpost.
 *
 * @param {SceneOpts} opts Build options.
 * @returns {Scene} Scene.
 */
export function siberia(opts: SceneOpts = {}): Scene {
	const NX = 6, NY = 5;
	const prims: Prim[] = [];
	const props: { id: string; prims: Prim[] }[] = [];
	/** Start a new prop; primitives pushed until the next call belong to it. */
	const prop = (id: string): Prim[] => { const p: Prim[] = []; props.push({ id, prims: p }); return p; };
	// Footprints trudging in from the edge of the map to where the exile now stands.
	const from: V3 = [0.15 * L, 4.7 * L, 0], to: V3 = [3.1 * L, 2.9 * L, 0];
	const tdx = to[0] - from[0], tdy = to[1] - from[1], tl = Math.hypot(tdx, tdy);
	const ux = tdx / tl, uy = tdy / tl;
	const snowPat: Pattern = (lx, ly, _lz, _nx, _ny, nz) => {
		if (nz < 0.6) return { mat: 'ice', shift: -1 };
		const wx = lx + NX * L / 2, wy = ly + NY * L / 2;
		const along = (wx - from[0]) * ux + (wy - from[1]) * uy;
		const across = -(wx - from[0]) * uy + (wy - from[1]) * ux;
		if (along > 0 && along < tl - 12) {
			const step = Math.round(along / 7);
			const side = step % 2 ? 2.6 : -2.6;
			const da = along - step * 7, dc = across - side;
			if ((da * da) / 4.4 + (dc * dc) / 1.7 < 1) return { shift: -1 };
		}
		const s = hash(Math.floor(lx * RES), Math.floor(ly * RES), 4);
		return s < 0.02 ? { shift: 1 } : s > 0.985 ? { shift: -1 } : null;
	};
	prims.push(box([NX * L / 2, NY * L / 2, -4], [NX * L / 2, NY * L / 2, 4], 0, 'snow', { group: 'snow', pattern: snowPat }));

	const pines: [number, number, number][] = [[0.6, 0.8, 1], [1.7, 0.35, 1.15], [5.0, 0.6, 1.1], [5.5, 1.8, 0.9], [0.45, 2.3, 0.85]];
	pines.forEach(([x, y, s], k) => addPine(prop(`pine${k}`), [x * L, y * L, 0], s, `pine${k}`));

	// Log hut, with its door, window, roof and chimney as one prop
	const hc: V3 = [3.3 * L, 0.75 * L, 24];
	addHut(prop('hut'), hc);

	const sp: V3 = [1.4 * L, 3.35 * L, 0];
	addSignpost(prop('signpost'), sp);

	const { base, props: layers } = renderLayers(prims, props, makeView(0), opts.flat);
	letterSignpost(layers.find((p) => p.id === 'signpost')?.sprite ?? base, sp);
	const [cx, cy] = project(base, hutChimneyTop(hc));
	// In front of the hut, behind the east pine, round in front of it, then behind the signpost
	// board. tests/scene.test.ts checks it never enters a prop's footprint.
	const patrol: V3[] = [[140, 131, 0], [140, 110, 0], [212, 110, 0], [250, 125, 0], [250, 190, 0], [122, 195, 0], [122, 170, 0], [122, 130, 0], [60, 130, 0]];
	return { base, props: layers, frame: flatten(base, layers), actor: [3.1 * L, 2.9 * L, 0], actorDir: 'S', workProps: [], patrol, emitters: [{ kind: 'smoke', x: cx, y: cy }, { kind: 'snow', x: 0, y: 0 }] };
}

/**
 * The workbench with its vise, oil can and spanner. Long along y by default, as it stands
 * against the Production Floor's left wall; `alongX` turns it to stand against a right wall.
 *
 * @param {Prim[]} p Prop primitives to push into.
 * @param {V3} wb Centre on the floor.
 * @param {boolean} alongX Run the bench along x instead of y.
 * @param {boolean} tools Include the vise, oil can and spanner.
 */
export function addWorkbench(p: Prim[], wb: V3, alongX = false, tools = true): void {
	// Offsets are authored for a bench along y; swapping the floor axes turns it without
	// touching the original numbers, so plantCorner renders exactly as before.
	const at = (dx: number, dy: number, z: number): V3 => (alongX ? [wb[0] + dy, wb[1] + dx, z] : [wb[0] + dx, wb[1] + dy, z]);
	const hs = (hx: number, hy: number, hz: number): V3 => (alongX ? [hy, hx, hz] : [hx, hy, hz]);
	p.push(box(at(0, 0, 23), hs(12, 27, 2), 0.6, 'wood', {
		group: 'bench',
		pattern: (lx, ly) => (alongX ? hash(Math.floor(ly / 2.5), Math.floor(lx / 9), 2) : hash(Math.floor(lx / 2.5), Math.floor(ly / 9), 2)) < 0.25 ? { shift: -1 } : null,
	}));
	p.push(box(at(0, 0, 7), hs(10.5, 25, 1), 0.3, 'woodDark', { group: 'bench' }));
	for (const [dx, dy] of [[-9.5, -24], [9.5, -24], [-9.5, 24], [9.5, 24]]) p.push(box(at(dx, dy, 10.5), [1.4, 1.4, 10.5], 0.3, 'iron', { group: 'benchLeg' }));
	if (!tools) return;
	p.push(box(at(3, 23, 27), hs(5, 3, 2.2), 0.6, 'iron', { group: 'vise' }));
	p.push(box(at(7.5, 23, 26), hs(1, 5, 1), 0.3, 'steel', { group: 'vise' }));
	p.push(cylinder(at(2, -14, 28), 3, 3.2, 0.5, 'red', { group: 'can' }));
	p.push(roundCone(at(5, -4, 25.4), at(3, 8, 25.4), 1, 1, 'steel', { group: 'spanner' }));
}

/**
 * Alexei's anvil, horn towards +x.
 *
 * @param {Prim[]} p Prop primitives to push into.
 * @param {V3} anvil Centre on the floor.
 */
export function addAnvil(p: Prim[], anvil: V3): void {
	p.push(box([anvil[0], anvil[1], 3], [7.5, 6.5, 3], 0.6, 'iron', { group: 'anvil' }));
	p.push(box([anvil[0], anvil[1], 7.6], [4, 3.6, 2], 0.4, 'iron', { group: 'anvil' }));
	p.push(box([anvil[0], anvil[1], 11], [11.5, 4.8, 1.7], 0.5, 'iron', { group: 'anvil' }));
	p.push(roundCone([anvil[0] + 11, anvil[1], 11], [anvil[0] + 19, anvil[1], 11.6], 3.2, 0.7, 'iron', { group: 'anvil' }));
}

/** Plank lines and dark edges on a 22-unit crate. */
const plank: Pattern = (lx, ly, lz) => {
	const e = [Math.abs(lx) > 9.8, Math.abs(ly) > 9.8, Math.abs(lz) > 9.8].filter(Boolean).length >= 2;
	return e ? { shift: -1 } : ((lz + 30) % 5) < 1.1 * PX ? { shift: -1 } : null;
};

/**
 * Two crates side by side along x with a third stacked on them.
 *
 * @param {Prim[]} p Prop primitives to push into.
 * @param {V3} c Centre of the first crate on the floor.
 */
export function addCrates(p: Prim[], c: V3): void {
	p.push(box([c[0], c[1], 11], [11, 11, 11], 0.7, 'wood', { group: 'crate1', pattern: plank }));
	p.push(box([c[0] + 23, c[1], 11], [11, 11, 11], 0.7, 'wood', { group: 'crate2', pattern: plank }));
	p.push(box([c[0] + 11, c[1], 33], [11, 11, 11], 0.7, 'woodDark', { group: 'crate3', pattern: plank }));
}

/**
 * A heap of coal lumps, about 30 units across.
 *
 * @param {Prim[]} p Prop primitives to push into.
 * @param {V3} c Centre on the floor.
 */
export function addCoal(p: Prim[], c: V3): void {
	for (let k = 0; k < 26; k++) {
		const r = 2.4 + hash(k, 1, 9) * 3;
		const a = hash(k, 2, 9) * Math.PI * 2, d = hash(k, 3, 9) * 12;
		p.push(ellipsoid([c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, r * 0.6 + (12 - d) * 0.4], [r, r, r * 0.8], 'coal', { group: 'coal' }));
	}
}

/**
 * Riveted steel column running floor to wall top.
 *
 * @param {Prim[]} p Prop primitives to push into.
 * @param {V3} c Centre on the floor.
 * @param {number} wh Wall height it reaches.
 */
export function addColumn(p: Prim[], c: V3, wh: number): void {
	p.push(box([c[0], c[1], wh / 2 - 3], [6, 5, wh / 2 + 3], 0.6, 'steel', {
		group: 'column',
		pattern: (lx, ly, lz) => {
			const edge = Math.abs(lx) > 4.2 || Math.abs(ly) > 3.4;
			return edge && ((lz + 200) % 9) < 1.3 * PX ? { shift: 1 } : Math.abs(lx) < PX ? { shift: -1 } : null;
		},
	}));
}

/** Snow settles on the upward faces of pine tiers, patchily. */
const pineSnow: Pattern = (lx, ly, lz, _nx, _ny, nz) => (nz > 0.6 + hash(Math.floor(lx / 3), Math.floor(ly / 3), Math.floor(lz / 2)) * 0.12 ? { mat: 'snow' } : null);

/**
 * A snowy pine: trunk and three tiers.
 *
 * @param {Prim[]} p Prop primitives to push into.
 * @param {V3} c Trunk base.
 * @param {number} s Size factor.
 * @param {string} g Outline group.
 */
export function addPine(p: Prim[], c: V3, s: number, g: string): void {
	p.push(cylinder([c[0], c[1], 6 * s], 3 * s, 6 * s, 0.5, 'log', { group: g }));
	p.push(cone([c[0], c[1], 22 * s], 11 * s, 20 * s, 6 * s, 'pine', { group: g, pattern: pineSnow }));
	p.push(cone([c[0], c[1], 37 * s], 10 * s, 15 * s, 4 * s, 'pine', { group: g, pattern: pineSnow }));
	p.push(cone([c[0], c[1], 50 * s], 8 * s, 9.5 * s, 0.8, 'pine', { group: g, pattern: pineSnow }));
}

/**
 * Log hut with its door, window, snowy roof and chimney.
 *
 * @param {Prim[]} hut Prop primitives to push into.
 * @param {V3} hc Centre of the log walls (z is their half height, 24).
 */
export function addHut(hut: Prim[], hc: V3): void {
	hut.push(box(hc, [30, 22, 24], 0.8, 'log', {
		group: 'hut',
		pattern: (_lx, _ly, lz) => {
			const band = ((lz + 48) % 8);
			return band < 1.2 * PX ? { shift: -1 } : band > 5.8 ? { shift: 1 } : null;
		},
	}));
	hut.push(box([hc[0], hc[1] + 22.6, 16], [7, 1, 16], 0.4, 'woodDark', { group: 'door' }));
	hut.push(box([hc[0] + 30.6, hc[1], 30], [1, 6, 5], 0.3, 'ice', { group: 'window' }));
	const a = (36 * Math.PI) / 180;
	const ca = Math.cos(a), sa = Math.sin(a);
	const roofPat: Pattern = (_lx, _ly, _lz, _nx, _ny, nz) => (nz > 0.45 ? { mat: 'snow' } : null);
	for (const s of [1, -1]) {
		const c: V3 = [hc[0], hc[1] + s * 15, 61 - 10.6];
		hut.push(box(c, [34, 19, 2.2], 0.6, 'woodDark', { group: 'roof', pattern: roofPat }, [[1, 0, 0], [0, s * ca, -sa], [0, s * sa, ca]]));
	}
	hut.push(box([hc[0] + 16, hc[1] - 7, 62], [3.6, 3.6, 9], 0.4, 'brick', { group: 'chimney', pattern: (_x, _y, _z, _a, _b, nz) => (nz > 0.9 ? { mat: 'snow' } : null) }));
}

/**
 * Where smoke leaves the hut's chimney.
 *
 * @param {V3} hc Hut centre as passed to addHut.
 * @returns {V3} World point.
 */
export function hutChimneyTop(hc: V3): V3 {
	return [hc[0] + 16, hc[1] - 7, 72];
}

/**
 * Signpost: a post and a board along x, snow on top. Letter it with letterSignpost after rendering.
 *
 * @param {Prim[]} post Prop primitives to push into.
 * @param {V3} sp Post base.
 */
export function addSignpost(post: Prim[], sp: V3): void {
	post.push(box([sp[0], sp[1], 17], [1.6, 1.6, 17], 0.3, 'wood', { group: 'post' }));
	post.push(box([sp[0], sp[1] + 1.8, 31], [44, 1.2, 7.5], 0.4, 'wood', { group: 'sign', pattern: (_x, _y, _z, _a, _b, nz) => (nz > 0.8 ? { mat: 'snow' } : null) }));
}

/**
 * Paint "СИБИРЬ" on a signpost's board.
 *
 * @param {Frame} sprite The signpost's rendered sprite (so the lettering sorts with the board).
 * @param {V3} sp Post base as passed to addSignpost.
 */
export function letterSignpost(sprite: Frame, sp: V3): void {
	const sign: Sign = { b: bitmap(textWidth('СИБИРЬ'), 5, null), texts: [{ s: 'СИБИРЬ', x: 0, y: 0, col: INK.posterCream }] };
	// Cream paint on dark wood: black lettering on this board was unreadable.
	const half = textWidth('СИБИРЬ') * R2 * PX;
	wallDecal(sprite, sign, [sp[0] - half, sp[1] + 3.1, 31 + (3.5 * PX) / 0.866], 'right', ['sign'], 2);
}
