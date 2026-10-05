/**
 * The easter eggs' art: the red flag a marcher carries on May Day (drawn over their own
 * walking frames, on the same canvas, so the parade needs no frames of its own), the «1 МАЯ» banner
 * at the head of the column, Sputnik, the Siberian bear, firework bursts, the bust's wink, and the
 * «ПЛАН ВЫПОЛНЕН!» banner.
 */
import { type Dir, SPRITE, YAW } from './avatar';
import { type Sign, STAR, bitmap, centred, wallDecal } from './env';
import { drawText, textWidth } from './font';
import { INK, rgb } from './palette';
import { type Frame, PX, fitBounds, makeView, render } from './render';
import { type Pattern, type Prim, type V3, box, cone, ellipsoid, roundCone } from './sdf';

/**
 * A star laid on a face that looks along +x, for the flag and the banner.
 *
 * @param cell World units per star pixel.
 * @returns Pattern, centred on the primitive's origin.
 */
function star(cell: number): Pattern {
	return (_lx, ly, lz, nx) => {
		if (Math.abs(nx) < 0.9) return null;
		const u = Math.floor(-ly / cell + STAR[0].length / 2), v = Math.floor(-lz / cell + STAR.length / 2);
		return STAR[v]?.[u] === '#' ? { mat: 'gold' } : null;
	};
}

/**
 * A red flag on a pole, carried at the right shoulder by someone walking along +x: the pole in the
 * hand, the cloth streaming back.
 *
 * @returns Primitives, in the walker's own frame (feet at the origin).
 */
export function flagPrims(): Prim[] {
	const p: Prim[] = [];
	p.push(roundCone([4, -11, 24], [-1, -13, 92], 0.8, 0.8, 'woodDark', { group: 'flagPole' }));
	p.push(cone([-1.1, -13.1, 94.5], 2.2, 1.4, 0, 'gold', { group: 'flagTop' }));
	p.push(box([-10, -13.3, 83], [9, 0.5, 7], 0.3, 'red', { group: 'flagCloth', pattern: (lx, ly, lz, nx, ny, nz) => star(1.1)(lx - 4, ly, lz - 2, nx, ny, nz) ?? (Math.sin(lx / 2.2) > 0.5 ? { shift: -1 } : null) }));
	return p;
}

/**
 * The flag drawn on a comrade's own sprite canvas, so it lands on their shoulder exactly.
 *
 * @param dir Which way they walk.
 * @returns Frame the size of a comrade's, anchored at their feet.
 */
export function renderFlag(dir: Dir): Frame {
	return render(flagPrims(), { ...SPRITE, view: makeView(YAW[dir]) });
}

/** The four ways the parade walks: along the floor's two axes. */
export type BannerDir = 'SE' | 'SW' | 'NW' | 'NE';

/** The words on the parade's banner: «1 МАЯ», the First of May. */
export const BANNER_WORDS = '1 МАЯ';

/**
 * The banner at the head of the parade, carried on two poles by the front pair, lettered on its front.
 * The column only ever walks along the floor's two axes, so it is drawn four ways: walking south-east
 * or south-west its lettered front is seen; walking away, its plain back.
 *
 * @param dir Which way the column walks: 'SE', 'SW', 'NW' or 'NE'.
 * @returns Frame, anchored at the middle between the two poles on the ground.
 */
export function renderBanner(dir: BannerDir = 'SE'): Frame {
	const hw = 22, zc = 72, hz = 9;
	// Built facing +x; walking along y, the two horizontal axes swap.
	const alongY = dir === 'SW' || dir === 'NE';
	const at = (a: number, b: number, z: number): V3 => (alongY ? [b, a, z] : [a, b, z]);
	const p: Prim[] = [];
	for (const s of [-1, 1]) {
		p.push(roundCone(at(0, s * (hw + 1.5), 24), at(0, s * (hw + 1.5), 92), 0.8, 0.8, 'woodDark', { group: `bannerPole${s}` }));
		p.push(cone(at(0, s * (hw + 1.5), 94.5), 2.2, 1.4, 0, 'gold', { group: `bannerTop${s}` }));
	}
	p.push(roundCone(at(0, -hw - 1.5, 82), at(0, hw + 1.5, 82), 0.6, 0.6, 'gold', { group: 'bannerBar' }));
	p.push(box(at(0, 0, zc), at(0.7, hw, hz), 0.3, 'red', {
		group: 'banner',
		pattern: (lx, ly, lz) => (lz < -hz + 1.6 ? { mat: 'gold', shift: Math.floor(alongY ? lx : ly) % 2 ? -1 : 0 } : null),
	}));
	const view = makeView(0);
	const f = render(p, { ...fitBounds(p, view, 3), view });
	if (dir === 'SE' || dir === 'SW') {
		// Lettered like a wall: facing +x the text runs towards -y, facing +y towards +x.
		const tw = textWidth(BANNER_WORDS) * Math.SQRT2 * PX;
		const sign = { b: bitmap(textWidth(BANNER_WORDS), 5, null), texts: [{ s: BANNER_WORDS, x: 0, y: 0, col: INK.posterGold }] };
		if (dir === 'SE') wallDecal(f, sign, [0.8, tw / 2, zc + 4], 'left', ['banner'], 1);
		else wallDecal(f, sign, [-tw / 2, 0.8, zc + 4], 'right', ['banner'], 1);
	}
	return f;
}

/**
 * Sputnik: a polished ball with four antennae swept back.
 *
 * @returns Frame, anchored at its middle.
 */
export function renderSputnik(): Frame {
	const p: Prim[] = [ellipsoid([0, 0, 0], [4, 4, 4], 'steel', { group: 'sputnik' })];
	for (const [y, z] of [[1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]]) p.push(roundCone([-2, y, z], [-18, y * 3, z * 3], 0.35, 0.25, 'iron', { group: 'antenna' }));
	const view = makeView(0);
	return render(p, { ...fitBounds(p, view, 2), view });
}

/** The bear's frames: four walking, then two sniffing with its nose to the ground. */
export const BEAR_FRAMES = 6;

/**
 * A brown bear facing +x.
 *
 * @param f Frame: 0–3 walking, 4–5 sniffing.
 * @returns Primitives.
 */
export function bearPrims(f: number): Prim[] {
	const p: Prim[] = [];
	const walk = f < 4, sniff = f >= 4;
	const swing = walk ? [6, 0, -6, 0][f] : 0;
	const coat: Pattern = (lx, ly, lz) => (((Math.floor(lx * 0.7) + Math.floor(ly * 0.7) + Math.floor(lz * 0.7)) % 3) === 0 ? { shift: -1 } : null);
	p.push(ellipsoid([0, 0, 22], [17, 10, 10.5], 'fur', { group: 'bearBody', pattern: coat }));
	p.push(ellipsoid([7, 0, 27], [8, 8.5, 7], 'fur', { group: 'bearBody', pattern: coat }));
	for (const [x, s, k] of [[10, 1, 1], [10, -1, -1], [-10, 1, -1], [-10, -1, 1]] as const) {
		const foot: V3 = [x + swing * k, s * 6, 3];
		p.push(roundCone([x, s * 6, 18], foot, 4.2, 3.4, 'fur', { group: `bearLeg${x}${s}` }));
		p.push(ellipsoid([foot[0] + 1.5, foot[1], 2], [4, 3.2, 2], 'fur', { group: `bearLeg${x}${s}`, pattern: () => ({ shift: -1 }) }));
	}
	const head: V3 = sniff ? [22, f === 5 ? 1 : -1, 9] : [21, 0, 24];
	p.push(roundCone([12, 0, 24], head, 7, 5.5, 'fur', { group: 'bearHead', pattern: coat }));
	p.push(ellipsoid(head, [6.5, 6, 6], 'fur', { group: 'bearHead' }));
	p.push(ellipsoid([head[0] + 5.5, head[1], head[2] - 1.5], [3.4, 2.6, 2.4], 'brownLeather', { group: 'snout' }));
	p.push(ellipsoid([head[0] + 8.6, head[1], head[2] - 1], [1, 1.2, 1], 'charcoal', { group: 'nose' }));
	for (const s of [1, -1]) p.push(ellipsoid([head[0] - 1.5, head[1] + s * 4.2, head[2] + 5], [1.6, 1.4, 1.8], 'fur', { group: 'ear', pattern: () => ({ shift: -1 }) }));
	return p;
}

/**
 * The bear drawn alone, its anchor at its feet.
 *
 * @param f Frame.
 * @param yaw Facing in degrees (0 = screen south-east).
 * @returns Frame.
 */
export function renderBear(f: number, yaw: number): Frame {
	const prims = bearPrims(f);
	const view = makeView(yaw);
	return render(prims, { ...fitBounds(prims, view, 2), view });
}

/** A firework's frames, and its colours. */
export const BURST_FRAMES = 7;
export const BURST_COLOURS = ['#e6b92e', '#e04a3c', '#f4efe2', '#7ac0e8'] as const;

/**
 * One frame of a firework bursting: sparks flying out in a ring, trailing, then falling and fading.
 *
 * @param f Frame.
 * @param colour Hex colour.
 * @param seed Which burst (the sparks' scatter).
 * @returns Pixels, centred on the burst.
 */
export function burstFrame(f: number, colour: string, seed = 0): { w: number; h: number; rgba: Uint8ClampedArray } {
	const size = 64, c = size / 2;
	const rgba = new Uint8ClampedArray(size * size * 4);
	const [r, g, b] = rgb(colour);
	const put = (x: number, y: number, a: number): void => {
		const i = Math.round(x), j = Math.round(y);
		if (i < 0 || j < 0 || i >= size || j >= size) return;
		const k = (j * size + i) * 4;
		if (rgba[k + 3] >= a) return;
		rgba[k] = r; rgba[k + 1] = g; rgba[k + 2] = b; rgba[k + 3] = a;
	};
	const n = 18, reach = 4 + f * 4.4, fall = f > 3 ? (f - 3) * (f - 3) * 0.9 : 0;
	const fade = f < 4 ? 255 : Math.max(60, 255 - (f - 3) * 60);
	for (let k = 0; k < n; k++) {
		const a = (k / n) * Math.PI * 2 + seed;
		const jitter = 0.85 + ((k * 37 + seed * 11) % 7) / 20;
		const x = c + Math.cos(a) * reach * jitter, y = c + Math.sin(a) * reach * jitter * 0.85 + fall;
		put(x, y, fade);
		if (f > 0) put(c + Math.cos(a) * (reach - 3) * jitter, c + Math.sin(a) * (reach - 3) * jitter * 0.85 + fall * 0.8, Math.round(fade * 0.5));
	}
	if (f === 0) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) put(c + dx, c + dy, 255);
	return { w: size, h: size, rgba };
}

/** The banner that unrolls when the plan is fulfilled: «ПЛАН ВЫПОЛНЕН!». */
export function planBanner(): Sign {
	const words = 'ПЛАН ВЫПОЛНЕН!';
	const w = textWidth(words) + 16, h = 15;
	const b = bitmap(w, h, INK.posterRed);
	for (let i = 0; i < w; i++) { b[0][i] = b[h - 1][i] = INK.posterGold; b[1][i] = b[h - 2][i] = INK.posterRedDark; }
	for (let j = 0; j < h; j++) { b[j][0] = b[j][w - 1] = INK.posterGold; }
	const s: Sign = { b, texts: [] };
	centred(s, words, 5, INK.posterCream);
	for (const x of [3, w - 6]) for (const [dx, dy] of [[1, 5], [0, 6], [1, 6], [2, 6], [1, 7], [0, 8], [2, 8]]) b[dy][x + dx] = INK.posterGold;
	return s;
}

/**
 * A sign's pixels, for showing it on the page rather than on a wall.
 *
 * @param s Sign.
 * @returns Pixels.
 */
export function signPixels(s: Sign): { w: number; h: number; rgba: Uint8ClampedArray } {
	const h = s.b.length, w = s.b[0]?.length ?? 0;
	const rgba = new Uint8ClampedArray(w * h * 4);
	/**
	 * Paint one pixel.
	 *
	 * @param i Column.
	 * @param j Row.
	 * @param col Hex colour.
	 */
	const put = (i: number, j: number, col: string): void => {
		if (i < 0 || j < 0 || i >= w || j >= h) return;
		const [r, g, b] = rgb(col);
		rgba.set([r, g, b, 255], (j * w + i) * 4);
	};
	s.b.forEach((row, j) => row.forEach((col, i) => { if (col) put(i, j, col); }));
	for (const t of s.texts) drawText(t.s, t.x, t.y, (i, j) => put(i, j, t.col));
	return { w, h, rgba };
}
