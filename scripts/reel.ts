/**
 * Render the demo reel (Alexei composited into both scenes, with a speech-bubble pop) as PNG
 * frames plus an ImageMagick delay list, and the 1x/2x/3x stills of the hammer strike.
 * Usage: npm run reel   (then npm run gif to assemble; needs ImageMagick's `magick`)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { ANIMS, type Anim, type Dir, headTopIn, renderAvatar } from '../src/art/avatar';
import { BUBBLE_MS, bubbleFrame } from '../src/art/bubble';
import { type Scene, plantCorner, siberia } from '../src/art/env';
import { ALEXEI } from '../src/art/outfits';
import { RES, TILE, project } from '../src/art/render';
import { compose as composeScene, feetOnScreen } from '../src/art/scene';
import type { V3 } from '../src/art/sdf';
import { type Image, blank, blit, encodePng } from './png';

const out = 'spike-output';
const frames = `${out}/reel-frames`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const CW = Math.round(150 * RES), CH = Math.round(120 * RES);
let n = 0;
const delays: string[] = [];

/**
 * Composite Alexei (and optionally a bubble frame) over a crop of a scene. Alexei is depth
 * sorted among the props, so anything in front of him (in depth) is drawn over him.
 *
 * @param {Scene} sc Scene.
 * @param {Anim} anim Animation.
 * @param {Dir} dir Direction.
 * @param {number} f Frame.
 * @param {number} bubble Bubble frame index, or -1 for none.
 * @param {V3} pos Alexei's world position (feet); defaults to the scene's standing spot.
 * @param {V3} cam World point the crop is framed on; defaults to the standing spot, so every
 *   segment that leaves both defaults gets the same fixed crop as before.
 * @returns {Image} Composited crop.
 */
function compose(sc: Scene, anim: Anim, dir: Dir, f: number, bubble = -1, pos: V3 = sc.actor, cam: V3 = sc.actor): Image {
	const [cxf, cyf] = project(sc.frame, cam);
	const cx = Math.round(cxf), cy = Math.round(cyf);
	const [ax, ay] = feetOnScreen(sc, pos);
	const x0 = cx - Math.floor(CW / 2), y0 = cy - CH + Math.round(24 * RES);
	const img = blank(CW, CH, [16, 17, 20]);
	const sprite = renderAvatar(ALEXEI, anim, dir, f);
	// Only at the standing spot is he working the scene's work props (the hammer lands on the
	// anvil); anywhere else on the floor he is sorted by footprint like any other agent.
	const working = pos === sc.actor;
	blit(img, composeScene(sc, [{ actor: { id: 'alexei', pos, over: working ? sc.workProps : [] }, sprite }]), -x0, -y0);
	if (bubble >= 0) {
		const b = bubbleFrame(bubble, 'reply');
		const top = headTopIn(sprite);
		blit(img, b, ax - sprite.ax + top.x - b.tipX - x0, ay - sprite.ay + top.y - b.tipY - y0);
	}
	return img;
}

/**
 * Append one reel frame.
 *
 * @param {Image} img Frame image.
 * @param {number} ms Duration.
 */
function emit(img: Image, ms: number): void {
	const name = `${frames}/f${String(n++).padStart(3, '0')}.png`;
	writeFileSync(name, encodePng(img, 2));
	delays.push(`-delay ${Math.max(2, Math.round(ms / 10))} ${name}`);
}

const plant = plantCorner(), sib = siberia();
const play = (sc: Scene, anim: Anim, dir: Dir, loops: number) => {
	for (let l = 0; l < loops; l++) ANIMS[anim].forEach((ms, f) => emit(compose(sc, anim, dir, f), ms));
};
play(plant, 'work', 'SE', 4);

/*
 * Walk leg: from the anvil spot SW (+y) for WALK_TILES tiles, then turn and come back NE.
 * The strip at the actor's x is clear floor: the anvil sits 32 units to +x (and its horn points
 * further +x), the workbench hugs the left wall (x < 28), and the column and crates are against
 * the back-right wall (y < 25). Walking +y also moves him *in front of* the anvil in depth
 * (larger x + y); the scene's depth sort decides that per frame.
 */
const WALK_TILES = 2, WALK_CYCLES = 3;
const WALK_STEPS = WALK_CYCLES * ANIMS.walk.length;
// 12 frames per 2 tiles = one tile per 6 frames, inside Habbo's 4-8 frames-per-tile range.
const stride = WALK_TILES * TILE / WALK_STEPS;
/*
 * The camera pans by half of Alexei's offset from the standing spot: he drifts at most a tile
 * (~32px across, ~16px down) from centre, so he stays inside the 150x120 crop, and the crop
 * is exactly the fixed one at both ends of the walk, so there's no jump into the next segment.
 */
const CAM_FOLLOW = 0.5;

/**
 * Emit one walk frame with Alexei at `offY` world units SW of the standing spot.
 *
 * @param {Dir} dir Facing (SW or NE).
 * @param {number} f Walk-cycle frame.
 * @param {number} offY Offset along +y from `plant.actor`.
 */
const walkFrame = (dir: Dir, f: number, offY: number) => {
	const [x, y, z] = plant.actor;
	const pos: V3 = [x, y + offY, z];
	const cam: V3 = [x, y + offY * CAM_FOLLOW, z];
	emit(compose(plant, 'walk', dir, f, -1, pos, cam), ANIMS.walk[f]);
};
// Out: each frame is drawn one stride further on, so the last SW frame lands on the far point.
for (let i = 1; i <= WALK_STEPS; i++) walkFrame('SW', (i - 1) % ANIMS.walk.length, i * stride);
// Back: the last NE frame lands exactly on the standing spot, where the bubble segment picks up.
for (let i = 1; i <= WALK_STEPS; i++) walkFrame('NE', (i - 1) % ANIMS.walk.length, (WALK_STEPS - i) * stride);
BUBBLE_MS.forEach((ms, b) => emit(compose(plant, 'idle', 'S', 0, b), b === 4 ? 1400 : ms));
play(plant, 'idle', 'S', 1);
play(sib, 'shiver', 'S', 8);
play(sib, 'shiver', 'SE', 6);
writeFileSync(`${frames}/delays.txt`, delays.join(' '));

const strike = compose(plant, 'work', 'SE', 4);
for (const s of [1, 2, 3]) writeFileSync(`${out}/alexei-strike-${s}x.png`, encodePng(strike, s));
console.log(`Wrote ${n} reel frames and 3 stills.`);
