/**
 * The art check for the wardrobe: contact sheets of every new hat, top, pair of legs,
 * face, thing in the mouth and extra, each on four comrades (three from the front, one from
 * behind); a sheet of whole outfits beside today's; and the changing steps, mosaic included.
 * Usage: npx tsx scripts/wardrobe-snap.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { type Dir, renderAvatar } from '../src/art/avatar';
import { drawText } from '../src/art/font';
import { ATTENDANT, type Outfit, randomOutfit } from '../src/art/outfits';
import { project } from '../src/art/render';
import { compose } from '../src/art/scene';
import { CLOAK, buildWorld } from '../src/world/zones';
import { type Image, blank, blit, encodePng } from './png';

const out = process.argv[2] ?? 'spike-output';
mkdirSync(out, { recursive: true });

/** Four comrades to try things on: different skin, hair and build of outfit, all in plain trousers. */
const BASES: Outfit[] = [3, 41, 97, 160].map((s, k) => ({ ...randomOutfit(s * 7919 + 11), skin: (['skinA', 'skinB', 'skinC', 'skinD'] as const)[k], face: 'clean', scarf: null }));
/** The views each base is shown in. */
const VIEWS: Dir[] = ['SE', 'S', 'SW', 'NW'];
/** The part of the sprite worth looking at, in sprite pixels. */
const CROP = { x: 14, y: 8, w: 56, h: 92 };
const BG = [42, 44, 50];
const LABEL_H = 9;

/**
 * Cut the interesting part out of a rendered frame.
 *
 * @param o Outfit.
 * @param dir View.
 * @param frame Idle frame.
 * @returns Image.
 */
function cell(o: Outfit, dir: Dir, frame = 0): Image {
	const f = renderAvatar(o, 'idle', dir, frame);
	const img = blank(CROP.w, CROP.h, BG);
	const src: Image = { w: CROP.w, h: CROP.h, rgba: new Uint8ClampedArray(CROP.w * CROP.h * 4) };
	for (let j = 0; j < CROP.h; j++) src.rgba.set(f.rgba.subarray(((CROP.y + j) * f.w + CROP.x) * 4, ((CROP.y + j) * f.w + CROP.x + CROP.w) * 4), j * CROP.w * 4);
	blit(img, src, 0, 0);
	return img;
}

/**
 * Write a label in the pixel font (digits and Cyrillic only, so the sheets are numbered and the
 * names are listed in the docs).
 *
 * @param img Image.
 * @param s Text (Latin letters and digits, or Cyrillic).
 * @param x Left.
 * @param y Top.
 */
function label(img: Image, s: string, x: number, y: number): void {
	drawText(s.toUpperCase(), x, y, (i, j) => {
		if (i < 0 || j < 0 || i >= img.w || j >= img.h) return;
		img.rgba.set([230, 220, 190, 255], (j * img.w + i) * 4);
	});
}

/**
 * A sheet: one row per item, each on every base in every view.
 *
 * @param name File name.
 * @param rows Label and how the item changes a base.
 */
function sheet(name: string, rows: [string, (o: Outfit) => Outfit][]): void {
	const cols = BASES.length * VIEWS.length;
	const img = blank(cols * (CROP.w + 2) + 2, rows.length * (CROP.h + LABEL_H + 2) + 2, [24, 25, 29]);
	rows.forEach(([text, dress], r) => {
		const y = 2 + r * (CROP.h + LABEL_H + 2);
		label(img, String(r + 1), 3, y + 1);
		void text;
		BASES.forEach((b, k) => VIEWS.forEach((v, n) => blit(img, cell(dress(b), v), 2 + (k * VIEWS.length + n) * (CROP.w + 2), y + LABEL_H)));
	});
	writeFileSync(`${out}/${name}.png`, encodePng(img, 2, BG));
	console.log(`Wrote ${out}/${name}.png (${rows.length} rows).`);
}

sheet('1-hats', [
	['budenovka', (o) => ({ ...o, headwear: 'budenovka', hatMat: 'khaki' })],
	['pilotka', (o) => ({ ...o, headwear: 'pilotka', hatMat: 'oliveDrab' })],
	['papakha', (o) => ({ ...o, headwear: 'papakha', hatMat: 'greyWool' })],
	['beret', (o) => ({ ...o, headwear: 'beret', hatMat: 'brickRed' })],
	['beskozyrka', (o) => ({ ...o, headwear: 'beskozyrka', hatMat: 'medWhite' })],
	['miner helmet', (o) => ({ ...o, headwear: 'helmet', hatMat: 'mustard' })],
	['fedora', (o) => ({ ...o, headwear: 'fedora', hatMat: 'brownLeather' })],
	['tyubeteika', (o) => ({ ...o, headwear: 'tyubeteika', hatMat: 'bottleGreen' })],
]);
sheet('2-tops', [
	['gymnastyorka', (o) => ({ ...o, torso: 'gymnastyorka', torsoMat: 'khaki', legsMat: 'navyWork' })],
	['telnyashka', (o) => ({ ...o, torso: 'telnyashka', torsoMat: 'medWhite', legsMat: 'navyWork' })],
	['shinel', (o) => ({ ...o, torso: 'shinel', torsoMat: 'greyWool', legsMat: 'charcoal' })],
	['suit', (o) => ({ ...o, torso: 'suit', torsoMat: 'charcoal', legsMat: 'charcoal' })],
	['sweater', (o) => ({ ...o, torso: 'sweater', torsoMat: 'mustard', legsMat: 'navyWork' })],
	['lab coat', (o) => ({ ...o, torso: 'labcoat', torsoMat: 'medWhite', shirtMat: 'skyShirt', legsMat: 'charcoal' })],
	['tulup', (o) => ({ ...o, torso: 'tulup', torsoMat: 'brownLeather', legsMat: 'navyWork' })],
	['vyshyvanka', (o) => ({ ...o, torso: 'vyshyvanka', torsoMat: 'medWhite', legsMat: 'charcoal' })],
]);
sheet('3-legs-faces', [
	['galife', (o) => ({ ...o, torso: 'gymnastyorka', torsoMat: 'khaki', legs: 'galife', legsMat: 'navyWork' })],
	['skirt', (o) => ({ ...o, legs: 'skirt', legsMat: 'navyWork' })],
	['walrus', (o) => ({ ...o, face: 'walrus' })],
	['pencil', (o) => ({ ...o, face: 'pencil' })],
	['round glasses', (o) => ({ ...o, face: 'roundGlasses' })],
	['pipe', (o) => ({ ...o, mouth: 'pipe' })],
	['papirosa', (o) => ({ ...o, mouth: 'papirosa' })],
]);
sheet('4-extras', [
	['hero star, order of lenin', (o) => ({ ...o, torso: 'tunic', torsoMat: 'khaki', extras: ['heroStar', 'orderLenin'] })],
	['komsomol badge', (o) => ({ ...o, torso: 'tunic', torsoMat: 'skyShirt', extras: ['komsomol'] })],
	['armband', (o) => ({ ...o, extras: ['armband'] })],
	['pioneer neckerchief', (o) => ({ ...o, torso: 'tunic', torsoMat: 'medWhite', extras: ['pioneerTie'] })],
	['satchel', (o) => ({ ...o, extras: ['satchel'] })],
	['briefcase', (o) => ({ ...o, torso: 'suit', torsoMat: 'navyWork', legsMat: 'navyWork', extras: ['briefcase'] })],
]);

// Whole outfits, mixing the new things, beside four outfits from the bank as they are today.
const OUTFITS: [string, Outfit][] = [
	['commissar', { ...BASES[0], headwear: 'budenovka', hatMat: 'greyWool', torso: 'shinel', torsoMat: 'greyWool', legs: 'galife', legsMat: 'charcoal', face: 'walrus', extras: ['armband'] }],
	['sailor', { ...BASES[1], headwear: 'beskozyrka', torso: 'telnyashka', torsoMat: 'medWhite', legsMat: 'navyWork', mouth: 'papirosa' }],
	['miner', { ...BASES[2], headwear: 'helmet', hatMat: 'mustard', torso: 'overalls', torsoMat: 'blueWork', legsMat: 'blueWork', sleeves: 'rolled', extras: ['heroStar'] }],
	['official', { ...BASES[3], headwear: 'fedora', hatMat: 'charcoal', torso: 'suit', torsoMat: 'charcoal', legsMat: 'charcoal', face: 'roundGlasses', extras: ['orderLenin', 'briefcase'] }],
	['scientist', { ...BASES[0], headwear: 'none', torso: 'labcoat', torsoMat: 'medWhite', legsMat: 'charcoal', face: 'roundGlasses', mouth: 'pipe' }],
	['pioneer', { ...BASES[1], headwear: 'pilotka', hatMat: 'red', torso: 'tunic', torsoMat: 'medWhite', legs: 'skirt', legsMat: 'navyWork', extras: ['pioneerTie', 'komsomol'] }],
	['cossack', { ...BASES[2], headwear: 'papakha', hatMat: 'blackLeather', torso: 'tulup', torsoMat: 'brownLeather', legs: 'galife', legsMat: 'navyWork', face: 'walrus' }],
	['artist', { ...BASES[3], headwear: 'beret', hatMat: 'charcoal', torso: 'sweater', torsoMat: 'charcoal', legsMat: 'sand', face: 'pencil', mouth: 'papirosa' }],
	['uzbek weaver', { ...BASES[0], headwear: 'tyubeteika', hatMat: 'bottleGreen', torso: 'vyshyvanka', torsoMat: 'medWhite', legsMat: 'charcoal', extras: ['satchel'] }],
	['red army', { ...BASES[1], headwear: 'pilotka', hatMat: 'khaki', torso: 'gymnastyorka', torsoMat: 'khaki', legs: 'galife', legsMat: 'khaki', extras: ['heroStar'] }],
	['tractor girl', { ...BASES[2], headwear: 'kosynka', hatMat: 'red', torso: 'sweater', torsoMat: 'bottleGreen', legs: 'skirt', legsMat: 'fadedBlue', extras: ['komsomol'] }],
	['writer', { ...BASES[3], headwear: 'none', torso: 'suit', torsoMat: 'brownLeather', legsMat: 'sand', face: 'beard', mouth: 'pipe' }],
];
{
	const today = [5, 23, 71, 202].map((s): [string, Outfit] => [`today ${s}`, randomOutfit(s)]);
	const all = [...OUTFITS, ...today];
	const per = 8;
	const rows = Math.ceil(all.length / per);
	const img = blank(per * (CROP.w + 2) + 2, rows * (CROP.h + LABEL_H + 2) + 2, [24, 25, 29]);
	all.forEach(([name, o], k) => {
		const x = 2 + (k % per) * (CROP.w + 2), y = 2 + Math.floor(k / per) * (CROP.h + LABEL_H + 2);
		label(img, String(k + 1), x + 1, y + 1);
		void name;
		blit(img, cell(o, 'SE'), x, y + LABEL_H);
	});
	writeFileSync(`${out}/5-outfits.png`, encodePng(img, 3, BG));
	console.log(`Wrote ${out}/5-outfits.png.`);
}

// The changing steps: dressed, hat off, top off, legs off (the mosaic, with and without its word),
// then the new outfit going on.
{
	const from: Outfit = OUTFITS[3][1];
	// The same comrade throughout: only the clothes change.
	const to: Outfit = { ...OUTFITS[0][1], skin: from.skin, hair: from.hair };
	const steps: [string, Outfit, number][] = [
		['dressed', from, 0],
		['hat off', { ...from, headwear: 'none' }, 0],
		['top off', { ...from, headwear: 'none', torso: 'bare', extras: [], mouth: null }, 0],
		['legs off', { ...from, headwear: 'none', torso: 'bare', legs: 'bare', extras: [], mouth: null, face: 'clean' }, 0],
		['censored', { ...from, headwear: 'none', torso: 'bare', legs: 'bare', extras: [], mouth: null, face: 'clean' }, 3],
		['legs on', { ...to, headwear: 'none', torso: 'bare', extras: [], face: from.face }, 0],
		['top on', { ...to, headwear: 'none' }, 0],
		['hat on', to, 0],
	];
	const img = blank(steps.length * (CROP.w + 2) + 2, CROP.h + LABEL_H + 4, [24, 25, 29]);
	steps.forEach(([name, o, frame], k) => {
		const x = 2 + k * (CROP.w + 2);
		label(img, String(k + 1), x + 1, 3);
		void name;
		blit(img, cell(o, 'SE', frame), x, LABEL_H + 2);
	});
	writeFileSync(`${out}/6-changing.png`, encodePng(img, 3, BG));
	console.log(`Wrote ${out}/6-changing.png.`);
}

// The гардероб: the babushka at her counter beside a comrade come to change; then the comrade
// censored, and the babushka turned away behind her newspaper.
{
	const world = buildWorld();
	const { scene } = world;
	const m = world.marks;
	const comrade: Outfit = OUTFITS[3][1];
	const bare: Outfit = { ...comrade, headwear: 'none', torso: 'bare', legs: 'bare', extras: [], mouth: null, face: 'clean' };
	const shots: [string, { o: Outfit; anim: 'idle' | 'lurk'; dir: Dir; frame: number }, { o: Outfit; frame: number }][] = [
		['7-cloakroom', { o: ATTENDANT, anim: 'idle', dir: m.attendant.dir, frame: 0 }, { o: comrade, frame: 0 }],
		['8-cloakroom-changing', { o: ATTENDANT, anim: 'lurk', dir: 'NE', frame: 0 }, { o: bare, frame: 3 }],
	];
	const corners = [[CLOAK.x - 3 * 45, CLOAK.rackY - 45], [CLOAK.x + 3 * 45, CLOAK.rackY - 45], [CLOAK.x - 3 * 45, CLOAK.spotY + 60], [CLOAK.x + 3 * 45, CLOAK.spotY + 60]]
		.map(([x, y]) => project(scene.base, [x, y, 0]));
	const left = Math.min(...corners.map((p) => p[0])), right = Math.max(...corners.map((p) => p[0]));
	const top = Math.min(...corners.map((p) => p[1])) - 110, bottom = Math.max(...corners.map((p) => p[1]));
	const crop: [number, number, number, number] = [Math.floor(left), Math.floor(top), Math.ceil(right - left), Math.ceil(bottom - top)];
	for (const [name, gran, who] of shots) {
		const frame = compose(scene, [
			{ actor: { id: 'babushka', pos: m.attendant.pos }, sprite: renderAvatar(gran.o, gran.anim, gran.dir, gran.frame) },
			{ actor: { id: 'comrade', pos: m.cloak.pos }, sprite: renderAvatar(who.o, 'idle', m.cloak.dir, who.frame) },
		]);
		writeFileSync(`${out}/${name}.png`, encodePng(frame, 3, BG, crop));
		console.log(`Wrote ${out}/${name}.png.`);
	}
}

// The babushka up close, all round.
{
	const views: Dir[] = ['S', 'SE', 'SW', 'E', 'W', 'NW'];
	const img = blank(views.length * (CROP.w + 2) + 2, CROP.h + 4, [24, 25, 29]);
	views.forEach((v, k) => blit(img, cell(ATTENDANT, v), 2 + k * (CROP.w + 2), 2));
	writeFileSync(`${out}/9-babushka.png`, encodePng(img, 4, BG));
	console.log(`Wrote ${out}/9-babushka.png.`);
}
