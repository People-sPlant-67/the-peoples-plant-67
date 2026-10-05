/**
 * Avatar model: a jointed Habbo-proportioned body built from SDF primitives, posed per
 * animation frame with 2-bone IK, dressed from an Outfit, then rasterised and decorated
 * with pixel decals (eyes, brows, mouth, badges, sparks, breath).
 */

import { drawText, textWidth } from './font';
import { MATERIALS, INK } from './palette';
import { type Outfit } from './outfits';
import { type Frame, type View, RES, makeView, render, put, visible, project } from './render';
import { type Pattern, type PatternOut, type Prim, type V3, add, box, cone, cross, cylinder, dot, ellipsoid, hash, len, norm, roundCone, scale, sub } from './sdf';

/**
 * Animations. 'lurk' and 'scribble' are The Commissar's: a newspaper to peek over, a notebook to write in.
 * The rest after them are the breaks and fidgets: a glass of soda, tea, a stretch, a yawn,
 * a look at a pocket watch, sweeping, dozing, a game of chess on a stool, and the attendant handing
 * over a cloakroom token. 'salute' is for the five-year plan's medal.
 */
export type Anim = 'idle' | 'walk' | 'work' | 'shiver' | 'lurk' | 'scribble'
	| 'drink' | 'tea' | 'stretch' | 'yawn' | 'watch' | 'sweep' | 'doze' | 'chess' | 'token' | 'salute';
export type Dir = 'S' | 'SE' | 'E' | 'NE' | 'N' | 'NW' | 'W' | 'SW';

export const DIRS: Dir[] = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];

/** Model facing per screen direction. SE/SW/NE/NW are the iso grid axes agents walk along. */
export const YAW: Record<Dir, number> = { SE: 0, S: 45, SW: 90, W: 135, NW: 180, N: -135, NE: -90, E: -45 };

/** Per-frame durations in ms. Idle holds long and blinks briefly, like Habbo's idle. */
export const ANIMS: Record<Anim, number[]> = {
	idle: [700, 500, 700, 140],
	walk: [130, 130, 130, 130],
	work: [220, 110, 170, 80, 240, 170],
	shiver: [90, 90, 90, 90],
	// Paper up, a page turns, up, lowers, peeks (with a blink), rises again.
	lurk: [1600, 260, 900, 160, 1300, 140, 700, 160],
	// Four pencil strokes with the head bowed, then a look up (with a blink).
	scribble: [240, 140, 140, 140, 900, 140],
	// Glass at the chest, raised, a long sip, lowered.
	drink: [700, 260, 1100, 260],
	tea: [700, 260, 1100, 260],
	// Arms going up, up and leaning back, coming down, down.
	stretch: [260, 1000, 260, 300],
	// A hand to the mouth, the yawn with the eyes shut, the hand down.
	yawn: [260, 1100, 300],
	// The watch out, a look at it, put away.
	watch: [300, 1300, 300],
	// The broom to the left, the middle, the right, the middle.
	sweep: [260, 200, 260, 200],
	// Head down, the Z rising.
	doze: [900, 900, 900, 900],
	// Chin on the hand, thinking; a reach for a piece, the move (a clack), back.
	chess: [1300, 900, 260, 300, 700],
	// The token held out across the counter, and back.
	token: [300, 900, 300],
	// A hand up to the brow, held, with a blink.
	salute: [1200, 160],
};

/** The chess frame a piece is put down on (the sound cues clack on it). */
export const CHESS_MOVE_FRAME = 3;
/** How far a comrade sinks to sit on a stool: their hips rest at the seat. */
export const SIT_DROP = 8.5;

/**
 * The newspaper per lurk frame: the height of its middle, and how far the right half has swung
 * (degrees). Up, it hides the face and leaves the cap; lowered, its top edge falls between the
 * eyes and the moustache, so only the eyes peek over.
 */
const LURK: { z: number; turn: number }[] = [
	{ z: 53, turn: 0 }, { z: 53, turn: 40 }, { z: 53, turn: 0 }, { z: 49.5, turn: 0 },
	{ z: 46, turn: 0 }, { z: 46, turn: 0 }, { z: 46, turn: 0 }, { z: 49.5, turn: 0 },
];

/** The lurk frame where a page turns (the sound cues rustle on it). */
export const PAGE_TURN_FRAME = LURK.findIndex((k) => k.turn > 0);

/** The newspaper's masthead. */
export const MASTHEAD = 'ПРАВДА';

/** Sprite canvas. Tall enough for a raised sledgehammer; the anchor is the feet. */
export const SPRITE = { w: Math.round(84 * RES), h: Math.round(112 * RES), ax: Math.round(42 * RES), ay: Math.round(96 * RES) };

interface Pose {
	bob: number;
	lean: number;
	hunch: number;
	jy: number;
	footL: V3;
	footR: V3;
	handL: V3;
	handR: V3;
	blink: boolean;
	hammer?: { g: V3; th: number; roll: number; spark: boolean };
	breath?: number;
	/** A broadsheet held up in both hands: middle of its fold, and how far the right half has swung (degrees). */
	paper?: { c: V3; turn: number };
	/** A notebook in the left hand and a pencil in the right: the pencil tip, whether it is lifted, and the marks made. */
	notebook?: { tip: V3; lift: boolean; marks: number };
	/** Something small in hand: where it is; a broom also runs from `at` down to its head at `to`. */
	held?: { kind: 'glass' | 'cup' | 'watch' | 'broom' | 'token'; at: V3; to?: V3 };
	/** A saucer in the left hand, under the tea. */
	saucer?: V3;
	/** Asleep: which Z is rising over the head (0 to 3). */
	zzz?: number;
	/** Sitting on a stool, legs bent in front. */
	sit?: boolean;
}

/** Half the newspaper's width, and half its height. Opened out, a broadsheet is wider than the shoulders. */
const PAPER_W = 19, PAPER_H = 12;
/** How far in front of the body the newspaper is held: past the peak of a cap, so no brim pokes through it. */
const PAPER_X = 15.5;
/** The notebook: centre, the page's outward normal (tilted up towards the face), and its axes. */
const NB_C: V3 = [13.5, 2, 37.5];
const NB_N: V3 = norm([-0.12, 0, 1]);
const NB_W: V3 = [0, 1, 0];
const NB_H: V3 = norm(cross(NB_N, NB_W));

/**
 * A point on the notebook's page.
 *
 * @param {number} u Across the page (-1 to 1).
 * @param {number} v Along the page (-1 to 1).
 * @param {number} lift Height above the page.
 * @returns {V3} Model point.
 */
function onPage(u: number, v: number, lift = 0): V3 {
	return add(add(add(NB_C, scale(NB_N, 1.25 + lift)), scale(NB_W, u * 6)), scale(NB_H, v * 5));
}

const HIP_Y = 4.6, THIGH = 12, SHIN = 11.6;
const SH_Y = 9.8, UPPER = 11.2, FORE = 10.6;

/**
 * Sledgehammer axes for a swing angle and an outward roll of the swing plane.
 *
 * th sweeps the handle in the model's forward/up plane (0 = straight up, 90 = straight
 * forward). roll then tips the handle towards the hammer side (-y) so the raised head
 * clears the body when seen from the front or back.
 *
 * @param {number} th Swing angle in radians.
 * @param {number} roll Outward roll in radians; 0 keeps the swing in the x-z plane.
 * @returns {[V3, V3, V3]} Handle direction (grip to head), head axis (the striking
 * direction, perpendicular to the handle), and the remaining orthogonal axis.
 */
function hammerAxes(th: number, roll: number): [V3, V3, V3] {
	const dir: V3 = [Math.sin(th) * Math.cos(roll), -Math.sin(roll), Math.cos(th) * Math.cos(roll)];
	// Already orthogonal to dir for any roll, so the head stays square to the handle.
	const perp: V3 = [Math.cos(th), 0, -Math.sin(th)];
	const side: V3 = [
		perp[1] * dir[2] - perp[2] * dir[1],
		perp[2] * dir[0] - perp[0] * dir[2],
		perp[0] * dir[1] - perp[1] * dir[0],
	];
	return [dir, perp, side];
}

/**
 * Pose for one frame of one animation.
 *
 * @param {Anim} anim Animation.
 * @param {number} f Frame index.
 * @returns {Pose} Joint targets.
 */
function pose(anim: Anim, f: number): Pose {
	const base: Pose = {
		bob: 0, lean: 0, hunch: 0, jy: 0,
		footL: [0.5, 4.8, 3.2], footR: [-0.3, -4.8, 3.2],
		handL: [0.5, 11.8, 25.5], handR: [0.5, -11.8, 25.5],
		blink: false,
	};
	if (anim === 'idle') {
		const b = [0, 0.5, 1, 0.5][f];
		return { ...base, bob: b, handL: [0.5, 11.8, 25.5 + b], handR: [0.5, -11.8, 25.5 + b], blink: f === 3 };
	}
	if (anim === 'walk') {
		const k = f % 2 === 0 ? (f === 0 ? 1 : -1) : 0;
		const lift = f === 1 ? -1 : f === 3 ? 1 : 0; // which foot is swinging through
		return {
			...base,
			bob: k === 0 ? 1 : 0,
			lean: 1,
			footL: [6.5 * k, 4.8, 3.2 + (lift === 1 ? 3.2 : 0) + (k < 0 ? 0.6 : 0)],
			footR: [-6.5 * k, -4.8, 3.2 + (lift === -1 ? 3.2 : 0) + (k > 0 ? 0.6 : 0)],
			handL: [-5.5 * k + 1, 11.6, 26.5],
			handR: [5.5 * k + 1, -11.6, 26.5],
		};
	}
	if (anim === 'work') {
		// Swung on the right-hand side (y < 0), with the swing plane rolled outwards (roll,
		// degrees) so the raised hammer head sits off the body's centre line. With 8 view
		// directions 45 degrees apart, any raised head position lines up behind or in front of
		// the head in some view, so each key frame is placed to avoid them:
		// - frames 1 and 3 carry the head forward-right at chest height, about 22 degrees off
		//   the forward axis. That is midway between view axes, so it clears the head sideways
		//   in all 8 views and never crosses the face from S.
		// - frame 2 (top of the swing) rolls the head out beside the cap so N and S see it
		//   instead of a stub peeking over the head.
		// - frame 4 (strike) has no roll so the head still lands on the anvil top in SE.
		// Left hand sits 5.5 up the handle; both hands must stay within UPPER+FORE of their
		// shoulders or the IK clamps and a hand floats off the handle.
		const K = [
			{ g: [7, -4.5, 32], th: 112, roll: 4, lean: 1.5, bob: 0 },
			{ g: [8, -5, 45], th: 66, roll: 18, lean: 0, bob: 0 },
			{ g: [1.5, -5, 52], th: -25, roll: 34, lean: -1.5, bob: 0.5 },
			{ g: [8, -6, 44], th: 70, roll: 15, lean: 1, bob: 0 },
			{ g: [10, -4.5, 31], th: 124, roll: 0, lean: 3, bob: -1.5 },
			{ g: [9, -4.5, 32], th: 116, roll: 2, lean: 2.5, bob: -1 },
		][f];
		const th = (K.th * Math.PI) / 180;
		const roll = (K.roll * Math.PI) / 180;
		const dir = hammerAxes(th, roll)[0];
		const g = K.g as V3;
		return {
			...base,
			bob: K.bob, lean: K.lean,
			footL: [3, 5.6, 3.2], footR: [-3, -5.6, 3.2],
			handR: g,
			handL: add(g, scale(dir, 5.5)),
			hammer: { g, th, roll, spark: f === 4 },
		};
	}
	if (anim === 'lurk') {
		// Hands hold the outer edges halfway up (any higher is out of reach); on the page turn the
		// right hand lets go and swings the right half out by the middle.
		const K = LURK[f];
		const a = (K.turn * Math.PI) / 180;
		return {
			...base,
			footL: [0.5, 4.2, 3.2], footR: [0.5, -4.2, 3.2],
			handL: [PAPER_X - 0.8, PAPER_W - 1.5, K.z],
			handR: K.turn ? [PAPER_X + Math.sin(a) * 5.5, -Math.cos(a) * 5.5, K.z] : [PAPER_X - 0.8, -(PAPER_W - 1.5), K.z],
			blink: f === 5,
			paper: { c: [PAPER_X, 0, K.z], turn: K.turn },
		};
	}
	if (anim === 'scribble') {
		// The pencil walks across the page in four strokes, then lifts while he looks up.
		const K = [
			{ u: -0.55, v: 0.35, lift: false }, { u: -0.1, v: 0.3, lift: false }, { u: 0.35, v: 0.2, lift: false },
			{ u: -0.45, v: -0.15, lift: false }, { u: 0.1, v: -0.1, lift: true }, { u: 0.1, v: -0.1, lift: true },
		][f];
		const tip = onPage(K.u, K.v, K.lift ? 2.5 : 0);
		return {
			...base,
			hunch: K.lift ? 0 : -1.4,
			lean: K.lift ? 0 : 0.8,
			footL: [0.5, 4.2, 3.2], footR: [0.5, -4.2, 3.2],
			handL: [NB_C[0] - 1.5, NB_C[1] + 7.6, NB_C[2] - 1.5],
			handR: add(tip, [-2.6, -3.4, 6.4]),
			blink: f === 5,
			notebook: { tip, lift: K.lift, marks: Math.min(f + 1, 4) },
		};
	}
	// The breaks and fidgets. Hands stay within reach of the shoulders (UPPER + FORE).
	const still = { ...base, footL: [0.5, 4.4, 3.2] as V3, footR: [0.5, -4.4, 3.2] as V3 };
	if (anim === 'drink' || anim === 'tea') {
		// The right hand carries the glass or cup from the chest to the lips; tea comes on a saucer.
		const hand: V3 = ([[10, -5, 35], [11, -3.5, 43], [10.5, -2.4, 48.5], [11, -3.5, 43]] as V3[])[f];
		return {
			...still,
			hunch: f === 2 ? 0.6 : 0,
			blink: f === 2,
			handR: hand,
			handL: anim === 'tea' ? [10, 4.5, 34] : base.handL,
			held: { kind: anim === 'tea' ? 'cup' : 'glass', at: add(hand, [1.6, 0.6, 3]) },
			saucer: anim === 'tea' ? [11.2, 2.4, 33.6] : undefined,
		};
	}
	if (anim === 'stretch') {
		const up = [0.5, 1, 0.5, 0][f];
		return {
			...still,
			lean: -1.2 * up, bob: 0.6 * up,
			handL: [1 + up * 3, 11.8 + up * 1.5, 25.5 + up * 38], handR: [1 + up * 3, -11.8 - up * 1.5, 25.5 + up * 38],
			blink: f === 1,
		};
	}
	if (anim === 'yawn') {
		return { ...still, hunch: f === 1 ? 0.8 : 0, handR: f === 2 ? base.handR : [12.5, -1.5, 48], blink: f === 1 };
	}
	if (anim === 'watch') {
		const hand: V3 = f === 1 ? [13, 2.5, 39] : [9, 6, 33];
		return { ...still, hunch: f === 1 ? -1.4 : 0, lean: f === 1 ? 0.6 : 0, handL: hand, held: { kind: 'watch', at: add(hand, [1.4, -1.6, 2]) } };
	}
	if (anim === 'sweep') {
		// Both hands down the handle; the bristles swing from side to side in front.
		const s = [-1, 0, 1, 0][f];
		const top: V3 = [3, -6, 49], head: V3 = [18, -3 + s * 6, 2.5];
		const along = (t: number): V3 => add(top, scale(sub(head, top), t));
		return { ...still, lean: 1.5, hunch: -0.6, handL: along(0.12), handR: along(0.42), held: { kind: 'broom', at: top, to: head } };
	}
	if (anim === 'doze') {
		return { ...still, hunch: -2.6, lean: 0.4, blink: true, handL: [7, 3, 26], handR: [7, -3, 26], zzz: f };
	}
	if (anim === 'chess') {
		// Sat on a stool facing the board: chin on the left hand, then the right hand moves a piece.
		const handR: V3 = ([[8.5, -5, 17], [8.5, -5, 17], [15, -3, 26], [16, -2.5, 25.4], [9, -5, 18]] as V3[])[f];
		return {
			...base,
			bob: -SIT_DROP, sit: true, lean: 1.4, hunch: f < 2 ? -0.6 : 0,
			footL: [10, 5, 3.2], footR: [10, -5, 3.2],
			handL: f < 2 ? [10, 2, 39.5] : [8.5, 5, 18],
			handR,
			blink: f === 1,
		};
	}
	if (anim === 'salute') {
		return { ...still, footL: [0.5, 3.6, 3.2], footR: [0.5, -3.6, 3.2], lean: -0.4, handR: [9.5, -4.5, 59.5], handL: [0.5, 11, 25.5], blink: f === 1 };
	}
	if (anim === 'token') {
		const hand: V3 = f === 1 ? [17, -4, 31] : [11, -6, 30];
		return { ...still, lean: f === 1 ? 2.5 : 0.8, handR: hand, held: { kind: 'token', at: add(hand, [1.6, 0, 1.4]) } };
	}
	// shiver
	return {
		...base,
		hunch: -2,
		jy: [0.6, -0.6, 0.6, -0.6][f],
		footL: [0.5, 3.6, 3.2], footR: [0.5, -3.6, 3.2],
		handR: [7, 4.5, 38], handL: [7.5, -4.5, 39],
		breath: f === 1 || f === 2 ? f : undefined,
	};
}

/**
 * Two-bone IK: elbow/knee position for a limb reaching from s towards t.
 *
 * @param {V3} s Root joint.
 * @param {V3} t Target.
 * @param {number} a Upper bone length.
 * @param {number} b Lower bone length.
 * @param {V3} pole Direction the middle joint bends towards.
 * @returns {[V3, V3]} Middle joint and the (possibly clamped) end point.
 */
function ik(s: V3, t: V3, a: number, b: number, pole: V3): [V3, V3] {
	let d = sub(t, s);
	let dl = len(d);
	const maxL = a + b - 0.05;
	if (dl > maxL) { d = scale(d, maxL / dl); dl = maxL; t = add(s, d); }
	const u = scale(d, 1 / dl);
	const cosA = Math.min(1, Math.max(-1, (a * a + dl * dl - b * b) / (2 * a * dl)));
	const sinA = Math.sqrt(1 - cosA * cosA);
	const v = norm(sub(pole, scale(u, dot(pole, u))));
	return [add(s, add(scale(u, a * cosA), scale(v, a * sinA))), t];
}

/**
 * Adapt a pattern written in torso-relative coordinates to a primitive with its own origin.
 *
 * @param {V3} primOrigin The primitive's origin.
 * @param {V3} ref Reference point the pattern is written against.
 * @param {Function} f Pattern in reference coordinates.
 * @returns {Pattern} Pattern for the primitive.
 */
const rel = (primOrigin: V3, ref: V3, f: (x: number, y: number, z: number) => PatternOut | null): Pattern =>
	(lx, ly, lz) => f(lx + primOrigin[0] - ref[0], ly + primOrigin[1] - ref[1], lz + primOrigin[2] - ref[2]);

/**
 * Surface detail for each torso garment, in torso-relative coordinates (z=0 at mid torso).
 *
 * @param {Outfit} o Outfit.
 * @returns {(x: number, y: number, z: number) => PatternOut | null} Pattern.
 */
function torsoDetail(o: Outfit): (x: number, y: number, z: number) => PatternOut | null {
	const ay = (y: number) => Math.abs(y);
	switch (o.torso) {
		case 'overalls':
			return (x, y, z) => {
				if (z > 7.2 && z < 8.6 && ay(y) > 3.4 && ay(y) < 5 && x > 2.5) return { mat: 'brass' };
				if (z > 5.5) {
					if (ay(y) > 3.2 && ay(y) < 5.8) return null;
					if (z < 8.5 && ay(y) < 5.8 && x > 0) return null;
					return { mat: o.shirtMat };
				}
				if (x > 3 && z > 0.5 && z < 5.5 && ay(y) < 3.3 && (ay(y) > 2.5 || z < 1.3 || z > 4.7)) return { shift: -1 };
				return null;
			};
		case 'tunic':
			return (x, y, z) => {
				if (z > -6.8 && z < -4.4) return x > 4 && ay(y) < 1.8 ? { mat: 'brass' } : { mat: 'brownLeather' };
				if (x > 4 && ay(y) < 0.9 && z > -4) return [1, 4.5, 8].some((b) => Math.abs(z - b) < 0.7) ? { mat: 'brass' } : { shift: -1 };
				if (z > 9) return { shift: -1 };
				if (x > 2.5 && ay(y) > 2.6 && ay(y) < 6.6 && z > 3 && z < 7 && (ay(y) < 3.3 || ay(y) > 5.9 || z < 3.7)) return { shift: -1 };
				return null;
			};
		case 'telogreika':
			return (x, y, z) => {
				if (x > 4 && ay(y) < 0.7) return { shift: -1 };
				if (((z + 40) % 3.6) < 0.7) return { shift: -1 };
				return null;
			};
		case 'trench':
			return (x, y, z) => {
				if (z > -6.8 && z < -4.4) return x > 4 && ay(y) < 1.8 ? { mat: 'brass' } : { shift: -1 };
				if (x > 3 && ay(y) > 2.2 && ay(y) < 3.4 && [-1.5, 2.5].some((b) => Math.abs(z - b) < 0.8)) return { mat: 'brass' };
				if (z > 5 && x > 3 && ay(y) < 4.5 && ay(y) > 3.4) return { shift: 1 };
				return null;
			};
		case 'gymnastyorka':
			// A belt with a star buckle, a strap over the left shoulder, a buttoned placket and a stand collar.
			return (x, y, z) => {
				if (z > -6.8 && z < -4.4) return x > 4 && ay(y) < 1.8 ? { mat: 'brass' } : { mat: 'brownLeather' };
				if (x > 1.5 && z > -4.4 && Math.abs(y - (z - 3) * 0.6) < 0.95) return { mat: 'brownLeather' };
				if (x > 4 && ay(y) < 0.8 && z > 1 && z < 9.5) return [3, 6.5].some((b) => Math.abs(z - b) < 0.7) ? { mat: 'brass' } : { shift: -1 };
				if (z > 9) return { shift: -1 };
				return null;
			};
		case 'telnyashka':
			// Navy stripes on white, the neck left open.
			return (_x, _y, z) => (z < 9 && ((z + 40) % 2.6) < 1.05 ? { mat: 'navyWork' } : null);
		case 'shinel':
			// A greatcoat: belt, two rows of brass buttons, red collar tabs.
			return (x, y, z) => {
				if (z > -6.8 && z < -4.6) return x > 4 && ay(y) < 1.8 ? { mat: 'brass' } : { shift: -1 };
				if (x > 4 && ay(y) > 2.4 && ay(y) < 3.5 && [-1.5, 2, 5.5].some((b) => Math.abs(z - b) < 0.75)) return { mat: 'brass' };
				if (z > 8.2 && x > 2.5 && ay(y) > 2.8 && ay(y) < 5.2) return { mat: 'red' };
				if (z > 8.6) return { shift: -1 };
				return null;
			};
		case 'suit':
			// Lapels open on a white shirt and a red tie; one button.
			return (x, y, z) => {
				if (x > 3 && z > -2.5 && ay(y) < (z + 2.5) * 0.42) return ay(y) < 0.95 && z < 9.6 ? { mat: 'red' } : { mat: 'medWhite' };
				if (x > 3 && z > -2.5 && ay(y) < (z + 2.5) * 0.42 + 0.9) return { shift: 1 };
				if (x > 4 && ay(y) < 0.7 && Math.abs(z + 3.6) < 0.7) return { shift: -1 };
				return null;
			};
		case 'sweater':
			// Knitted ribs, a ribbed band at the hem.
			return (_x, y, z) => (z < -7 ? (((y + 40) % 1.6) < 0.6 ? { shift: -1 } : null) : ((y + 40) % 2.2) < 0.55 ? { shift: -1 } : null);
		case 'labcoat':
			// Open down the front on the shirt; pockets; a pen.
			return (x, y, z) => {
				if (x > 4 && ay(y) < 1.3 && z > -8) return { mat: o.shirtMat };
				if (x > 3 && y > 3.6 && y < 4.3 && z > 4.6 && z < 7.4) return { mat: 'navyWork' };
				if (x > 3 && ay(y) > 3 && ay(y) < 6.5 && z > -6.5 && z < -2 && (ay(y) < 3.5 || ay(y) > 6 || z > -2.6)) return { shift: -1 };
				return null;
			};
		case 'tulup':
			// Sheepskin: fleece showing at the front edges, the collar and the hem.
			return (x, y, z) => {
				const fleece = (): PatternOut => (hash(Math.floor(y * 1.5), Math.floor(z * 1.5), 9) < 0.3 ? { mat: 'cream', shift: -1 } : { mat: 'cream' });
				if (x > 3.5 && ay(y) < 1.8) return fleece();
				if (z > 8.2 || z < -8.6) return fleece();
				return null;
			};
		case 'vyshyvanka':
			// A white shirt with a red cross-stitched panel down the front and a red sash.
			return (x, y, z) => {
				if (z > -6.8 && z < -4.6) return { mat: 'red' };
				if (x > 3 && ay(y) < 2.8 && z > 0.5) return (Math.floor(z * 1.4) + Math.floor((y + 40) * 1.4)) % 2 === 0 ? { mat: 'red' } : null;
				if (z > 9.2) return (Math.floor((y + 40) * 1.4) % 2 === 0) ? { mat: 'red' } : null;
				return null;
			};
		case 'dress':
			// A pinafore apron over the dress.
			return (x, y, z) => (x > 3 && ay(y) < 6 && z < 4 ? { mat: 'cream' } : null);
		case 'bare':
			return () => null;
	}
}

/**
 * Build the primitives and decal painter for an outfit in a pose.
 *
 * @param {Outfit} o Outfit.
 * @param {Pose} p Pose.
 * @param {number} frame The animation's frame (the censor's stamp flashes on every other one).
 * @returns {{prims: Prim[], decals: (f: Frame) => void}} Model.
 */
function build(o: Outfit, p: Pose, frame = 0): { prims: Prim[]; decals: (f: Frame) => void } {
	const prims: Prim[] = [];
	const { bob, lean, hunch, jy } = p;
	const extras = new Set(o.extras ?? []);
	const T0: V3 = [lean * 0.5, jy, 34.5 + bob];
	const Hc: V3 = [lean * 1.1 + (hunch < 0 ? 0.8 : 0), jy, 57.5 + bob + hunch * 1.3];
	const N: V3 = [lean * 0.9, jy, 46 + bob + hunch];
	const detail = torsoDetail(o);
	const bulk = BULK[o.torso] ?? 0;
	const legs = o.legs ?? 'trousers';
	const bareTop = o.torso === 'bare';
	// What the body is made of where clothes would be: skin when they are off.
	const torsoMat = bareTop ? o.skin : o.torsoMat;
	const legsMat = legs === 'bare' ? o.skin : o.legsMat;

	// Legs and boots. Breeches balloon at the thigh above tall boots; under a skirt the legs wear
	// thick stockings. Undressed, the boots stay on.
	for (const side of [1, -1]) {
		const g = side > 0 ? 'legL' : 'legR';
		const hip: V3 = [lean * 0.2, side * HIP_Y + jy * 0.3, 24 + bob];
		const foot = side > 0 ? p.footL : p.footR;
		const [knee, ft] = ik(hip, foot, THIGH, SHIN, [1, 0, 0.15]);
		if (legs === 'galife') {
			prims.push(roundCone(hip, knee, 4.9, 4, legsMat, { group: g }));
			prims.push(ellipsoid(add(scale(add(hip, knee), 0.5), [0, side * 3, 0]), [5.2, 5.4, 5.6], legsMat, { group: g }));
			prims.push(roundCone(knee, ft, 4.3, 3.9, 'boots', { group: g }));
		} else {
			const shinMat = legs === 'skirt' ? 'greyWool' : legsMat;
			prims.push(roundCone(hip, knee, 4.7, 4.1, legs === 'skirt' ? 'greyWool' : legsMat, { group: g }));
			prims.push(roundCone(knee, ft, 4.1, 3.7, shinMat, { group: g }));
		}
		prims.push(roundCone(add(ft, [0, 0, -1]), add(ft, [-0.2, 0, 6.5]), 4.1, 4.2, 'boots', { group: g }));
		prims.push(box(add(ft, [2.3, 0, -0.6]), [5.4, 3.6, 2.8], 1.8, 'boots', { group: g }));
	}

	// Pelvis, torso, chest
	const pel: V3 = [lean * 0.2, jy * 0.3, 25.5 + bob];
	prims.push(ellipsoid(pel, [6.3 + bulk, 8.8 + bulk, 5.2], o.torso === 'overalls' ? torsoMat : legsMat, { group: 'torso' }));
	const tc: V3 = T0;
	prims.push(box(tc, [6.3 + bulk, 9 + bulk, 10.2], 5, torsoMat, { group: 'torso', pattern: rel(tc, T0, detail) }));
	const ch: V3 = [lean * 0.8, jy, 41.5 + bob + hunch * 0.5];
	prims.push(ellipsoid(ch, [6.8 + bulk, 11 + bulk, 4.8], torsoMat, { group: 'torso', pattern: rel(ch, T0, detail) }));
	// Long coats and dresses hang below the waist; a skirt flares from it.
	const hem = HEM[o.torso];
	if (hem) {
		const sk: V3 = [lean * 0.3, jy * 0.5, (hem.top + hem.bottom) / 2 + bob];
		prims.push(box(sk, [7.6 + bulk * 0.6, 10 + bulk * 0.6, (hem.top - hem.bottom) / 2], 4.5, torsoMat, {
			group: 'torso',
			pattern: o.torso === 'tulup'
				? (lx, ly, lz) => (lz < -(hem.top - hem.bottom) / 2 + 1.6 || (lx > 5 && Math.abs(ly) < 1.4) ? { mat: 'cream' } : null)
				: o.torso === 'dress'
					? (lx, ly) => (lx > 5 && Math.abs(ly) < 6 ? { mat: 'cream' } : null)
					: (lx, ly) => (lx > 5 && Math.abs(ly) < 0.7 ? { shift: -1 } : null),
		}));
	} else if (legs === 'skirt') {
		prims.push(cone([lean * 0.3, jy * 0.5, 19 + bob], 7.5, 11.5, 8.6, legsMat, {
			group: 'torso',
			pattern: (lx, ly) => (((Math.atan2(ly, lx) * 8 / Math.PI) % 1 + 1) % 1 < 0.2 ? { shift: -1 } : null),
		}));
	}

	// Neck, scarf
	prims.push(roundCone(add(N, [0, 0, -2]), add(Hc, [0.5, 0, -8]), 3.9, 3.5, o.skin, { group: 'neck' }));
	if (o.torso === 'sweater') prims.push(cylinder(add(N, [0, 0, 1]), 5.2, 2.4, 1.2, o.torsoMat, { group: 'scarf', pattern: (_lx, ly) => (((ly + 40) % 1.6) < 0.6 ? { shift: -1 } : null) }));
	if (extras.has('pioneerTie')) {
		// The pioneer's red neckerchief: round the neck, knotted at the throat, two tails down the chest.
		prims.push(ellipsoid(add(N, [0.6, 0, 0.2]), [6, 7, 2.2], 'red', { group: 'scarf' }));
		prims.push(ellipsoid(add(N, [6.6, 0, -1.6]), [1.6, 1.9, 1.6], 'red', { group: 'scarf' }));
		for (const s of [1, -1]) prims.push(roundCone(add(N, [6.8, s * 0.6, -2.6]), add(N, [7.4 + lean * 0.3, s * 2.4, -9]), 1.3, 0.6, 'red', { group: 'scarf' }));
	}
	if (o.scarf) {
		prims.push(ellipsoid(add(N, [1, 0, 0.3]), [6.2, 7.2, 2.5], o.scarf, { group: 'scarf' }));
		prims.push(ellipsoid(add(N, [6.4, -1.6, -2.4]), [1.9, 2.4, 2.8], o.scarf, { group: 'scarf' }));
	}

	// Arms
	const armMatUpper = bareTop ? o.skin : o.sleeves === 'rolled' ? o.shirtMat : o.torso === 'overalls' ? o.shirtMat : o.torsoMat;
	const armMatLower = o.sleeves === 'rolled' ? o.skin : armMatUpper;
	// Sleeves carry the top's pattern where it has one all over.
	const sleeve: Pattern | undefined = o.torso === 'telnyashka'
		? (_lx, _ly, lz) => (((lz + 40) % 2.6) < 1.05 ? { mat: 'navyWork' } : null)
		: o.torso === 'sweater' ? (lx) => (((lx + 40) % 2.2) < 0.55 ? { shift: -1 } : null) : undefined;
	for (const side of [1, -1]) {
		const g = side > 0 ? 'armL' : 'armR';
		const s: V3 = [lean, side * (SH_Y + bulk) + jy, 44.5 + bob + hunch];
		const target = side > 0 ? p.handL : p.handR;
		const pole: V3 = p.hammer ? [-0.3, side, -0.6] : p.paper || p.notebook || p.held || p.sit ? [-0.4, side * 1.2, -1] : p.breath !== undefined || p.hunch < 0 ? [-0.2, side * 1.2, -1] : [-1, side * 0.35, 0];
		const [el, wr] = ik(s, target, UPPER, FORE, pole);
		prims.push(ellipsoid(s, [4.6 + bulk, 4.6 + bulk, 4.4], armMatUpper, { group: g, pattern: sleeve }));
		prims.push(roundCone(s, el, 4 + bulk * 0.6, 3.5 + bulk * 0.6, armMatUpper, { group: g, pattern: sleeve }));
		prims.push(roundCone(el, wr, 3.4, 3, armMatLower, { group: g, pattern: sleeve }));
		if (o.sleeves === 'rolled') prims.push(ellipsoid(add(el, scale(sub(wr, el), 0.12)), [4, 4, 4], armMatUpper, { group: g }));
		// A red armband on the left upper arm; fleece or embroidery at the cuffs.
		if (side > 0 && extras.has('armband') && !bareTop) prims.push(roundCone(add(s, scale(sub(el, s), 0.35)), add(s, scale(sub(el, s), 0.62)), 4.5 + bulk * 0.6, 4.3 + bulk * 0.6, 'red', { group: g }));
		if (o.torso === 'tulup') prims.push(ellipsoid(add(el, scale(sub(wr, el), 0.88)), [3.9, 3.9, 3.2], 'cream', { group: g }));
		if (o.torso === 'vyshyvanka') prims.push(ellipsoid(add(el, scale(sub(wr, el), 0.88)), [3.6, 3.6, 2.4], 'red', { group: g }));
		prims.push(ellipsoid(wr, [3.2, 3.2, 3.4], o.skin, { group: g }));
		// A briefcase in the right hand, when the hand is free.
		if (side < 0 && extras.has('briefcase') && !p.hammer && !p.paper && !p.notebook && !p.held && !p.sit) {
			prims.push(box(add(wr, [0, 0, -7]), [2, 7.2, 5.4], 1, 'brownLeather', { group: 'bag', pattern: (_lx, ly, lz) => (lz > 3.6 && Math.abs(ly) < 1.6 ? { mat: 'brass' } : null) }));
		}
	}

	// Head
	prims.push(ellipsoid(Hc, [10, 9.6, 10.6], o.skin, { group: 'head' }));
	prims.push(ellipsoid(add(Hc, [2, 0, -4.6]), [7.6, 7.8, 6], o.skin, { group: 'head' }));
	prims.push(ellipsoid(add(Hc, [9.7, 0, -1.4]), [2.4, 2, 2.7], o.skin, { group: 'head' }));
	for (const side of [1, -1]) prims.push(ellipsoid(add(Hc, [0.4, side * 9.6, -1]), [2.2, 1.5, 3], o.skin, { group: 'head' }));

	// Hair and headwear
	const hair = o.hair;
	// Streaks give hair a combed texture instead of a smooth helmet.
	const strands: Pattern = (lx, ly, lz) => (Math.abs(((lz * 0.9 + lx * 0.35 + (ly > 0 ? 0.5 : 0)) % 3 + 3) % 3) < 0.7 ? { shift: -1 } : null);
	const hairShell = (c: V3, r: V3) => prims.push(ellipsoid(add(Hc, c), r, hair, { group: 'hair', pattern: strands }));
	switch (o.headwear) {
		case 'none':
			hairShell([-2.2, 0, 2.6], [10, 10.2, 9.8]);
			break;
		case 'kepka':
			hairShell([-2.2, 0, 0], [9.6, 10, 9.6]);
			prims.push(ellipsoid(add(Hc, [0.6, 0, 8.4]), [11.4, 10.9, 5.2], o.hatMat, { group: 'hat' }));
			prims.push(ellipsoid(add(Hc, [8.6, 0, 6.6]), [5, 8.2, 1.3], o.hatMat, { group: 'brim', pattern: () => ({ shift: -1 }) }));
			prims.push(ellipsoid(add(Hc, [1, 0, 13.4]), [1.4, 1.4, 1], o.hatMat, { group: 'hat' }));
			break;
		case 'ushanka': {
			const fur: Pattern = (lx, ly, lz) => {
				const h = hash(Math.floor(lx * 1.3), Math.floor(ly * 1.3), Math.floor(lz * 1.3));
				return h < 0.18 ? { shift: -1 } : h > 0.9 ? { shift: 1 } : null;
			};
			prims.push(ellipsoid(add(Hc, [-0.4, 0, 6.8]), [11.8, 11.6, 7.4], o.hatMat, { group: 'hat', pattern: fur }));
			for (const side of [1, -1]) prims.push(box(add(Hc, [-0.5, side * 10.6, -2.5]), [5, 1.9, 6.2], 1.6, o.hatMat, { group: 'hat', pattern: fur }));
			prims.push(ellipsoid(add(Hc, [8.8, 0, 8.6]), [3.4, 9.8, 4], o.hatMat, { group: 'flap', pattern: fur }));
			break;
		}
		case 'peaked':
			hairShell([-2.2, 0, 0], [9.6, 10, 9.6]);
			prims.push(cylinder(add(Hc, [0.5, 0, 10.6]), 12.4, 2.8, 1.4, o.hatMat, { group: 'hat' }));
			prims.push(cylinder(add(Hc, [0, 0, 6.8]), 10.8, 1.9, 0.6, 'red', { group: 'hat' }));
			prims.push(ellipsoid(add(Hc, [8.8, 0, 5.4]), [4.6, 7.6, 1.1], 'blackLeather', { group: 'brim' }));
			break;
		case 'kosynka':
			prims.push(ellipsoid(add(Hc, [-1.4, 0, 5]), [10.8, 10.6, 9], o.hatMat, {
				group: 'hat',
				pattern: (lx, _ly, lz) => (lz < -1.5 && lx > 0 ? { shift: -1 } : null),
			}));
			prims.push(ellipsoid(add(Hc, [-9.4, 0, -5.4]), [3, 4.6, 5], o.hatMat, { group: 'hat' }));
			break;
		case 'budenovka':
			// The cloth helmet of the Civil War: a pointed crown, a short peak, ear flaps buttoned up.
			prims.push(ellipsoid(add(Hc, [-0.6, 0, 5.4]), [11, 10.8, 7.6], o.hatMat, { group: 'hat' }));
			prims.push(cone(add(Hc, [-0.8, 0, 14]), 5, 6.4, 0.9, o.hatMat, { group: 'hat' }));
			prims.push(ellipsoid(add(Hc, [-0.8, 0, 19.4]), [1.3, 1.3, 1.1], o.hatMat, { group: 'hat' }));
			prims.push(ellipsoid(add(Hc, [8.8, 0, 4.4]), [4.4, 8, 1.1], o.hatMat, { group: 'brim', pattern: () => ({ shift: -1 }) }));
			for (const side of [1, -1]) prims.push(box(add(Hc, [-1, side * 10.4, 3.4]), [5.2, 1.6, 2.2], 1.2, o.hatMat, { group: 'flap', pattern: () => ({ shift: -1 }) }));
			break;
		case 'pilotka':
			// The side cap: long front to back, low, worn a little to the right.
			hairShell([-2.2, 0, 0.6], [9.8, 10, 9.6]);
			prims.push(box(add(Hc, [0, -1.2, 9.6]), [9.6, 6.8, 2.2], 2.2, o.hatMat, { group: 'hat', pattern: (_lx, ly, lz) => (lz > 1.2 && Math.abs(ly) < 0.6 ? { shift: -1 } : null) }));
			break;
		case 'papakha': {
			// A tall drum of astrakhan fur with a cloth top.
			const curl: Pattern = (lx, ly, lz) => (hash(Math.floor(lx * 1.6), Math.floor(ly * 1.6), Math.floor(lz * 1.6)) < 0.3 ? { shift: -1 } : null);
			hairShell([-2.2, 0, 0], [9.6, 10, 9.6]);
			prims.push(cylinder(add(Hc, [-0.4, 0, 12.4]), 11.2, 6.4, 2.2, o.hatMat, { group: 'hat', pattern: (lx, ly, lz, nx, ny, nz) => (nz > 0.9 ? { mat: 'red' } : curl(lx, ly, lz, nx, ny, nz)) }));
			break;
		}
		case 'beret':
			hairShell([-2.2, 0, 0.6], [9.8, 10, 9.6]);
			prims.push(ellipsoid(add(Hc, [-0.6, 2.2, 9.6]), [11.8, 11.6, 3.6], o.hatMat, { group: 'hat' }));
			prims.push(ellipsoid(add(Hc, [-0.6, 2.2, 13.2]), [0.9, 0.9, 1.2], o.hatMat, { group: 'hat' }));
			break;
		case 'beskozyrka':
			// The sailor's cap: a white top, a navy band, two ribbons down the back.
			hairShell([-2.2, 0, 0], [9.6, 10, 9.6]);
			prims.push(cylinder(add(Hc, [0, 0, 11.6]), 12, 1.6, 1, 'medWhite', { group: 'hat' }));
			prims.push(cylinder(add(Hc, [0, 0, 8.6]), 10.6, 1.8, 0.5, 'navyWork', { group: 'hat' }));
			for (const side of [1, -1]) prims.push(roundCone(add(Hc, [-10, side * 1.6, 8]), add(Hc, [-11.4, side * 2.6, -3]), 0.9, 0.9, 'navyWork', { group: 'hat' }));
			break;
		case 'helmet':
			// The miner's hard hat, with its lamp.
			prims.push(ellipsoid(add(Hc, [-0.4, 0, 6.6]), [11.4, 11, 7.8], o.hatMat, { group: 'hat', pattern: (_lx, ly) => (Math.abs(ly) < 1 ? { shift: 1 } : null) }));
			prims.push(cylinder(add(Hc, [0, 0, 3.6]), 12.8, 0.7, 0.4, o.hatMat, { group: 'brim' }));
			prims.push(cylinder(add(Hc, [10.6, 0, 8.4]), 2.4, 1.6, 0.6, 'brass', { group: 'hat' }));
			break;
		case 'fedora':
			hairShell([-2.2, 0, 0], [9.6, 10, 9.6]);
			prims.push(cylinder(add(Hc, [0, 0, 6.2]), 15.4, 0.7, 0.5, o.hatMat, { group: 'brim' }));
			prims.push(cylinder(add(Hc, [-0.4, 0, 11]), 9.8, 4.6, 2.4, o.hatMat, {
				group: 'hat',
				pattern: (_lx, ly, lz) => (lz < -2.4 ? { mat: 'charcoal' } : lz > 3 && Math.abs(ly) < 1.2 ? { shift: -1 } : null),
			}));
			break;
		case 'platok': {
			// The babushka's headscarf: over the head and down past the ears, knotted under the chin,
			// red with cream flowers and a border.
			const flowers: Pattern = (lx, ly, lz) => {
				// Flowers a few pixels across, well apart: a cream bloom with a gold heart.
				const fx = Math.floor((lx + 40) / 3.2), fy = Math.floor((ly + 40) / 3.2), fz = Math.floor((lz + 40) / 3.2);
				if (hash(fx, fy, fz) > 0.22) return null;
				const cx = (fx + 0.5) * 3.2 - 40, cy = (fy + 0.5) * 3.2 - 40, cz = (fz + 0.5) * 3.2 - 40;
				const d = Math.hypot(lx - cx, ly - cy, lz - cz);
				return d < 0.7 ? { mat: 'gold' } : d < 1.5 ? { mat: 'cream' } : null;
			};
			prims.push(ellipsoid(add(Hc, [-1.4, 0, 5]), [10.9, 10.8, 9.2], o.hatMat, { group: 'hat', pattern: (lx, ly, lz, ...n) => (lz < -2.2 && lx > 2 ? { mat: 'cream' } : flowers(lx, ly, lz, ...n)) }));
			for (const side of [1, -1]) prims.push(ellipsoid(add(Hc, [-0.6, side * 9.5, -3.6]), [6.6, 2.6, 7.4], o.hatMat, { group: 'hat', pattern: flowers }));
			prims.push(ellipsoid(add(Hc, [-7.4, 0, -6]), [4.6, 9, 6.4], o.hatMat, { group: 'hat', pattern: flowers }));
			prims.push(roundCone(add(Hc, [4.6, -7.8, -9.6]), add(Hc, [4.6, 7.8, -9.6]), 2.1, 2.1, o.hatMat, { group: 'hat' }));
			prims.push(ellipsoid(add(Hc, [8.2, 0, -11.2]), [2.4, 2.8, 2.1], o.hatMat, { group: 'hat' }));
			break;
		}
		case 'tyubeteika':
			// The embroidered skullcap of Central Asia: four panels, a white pattern.
			hairShell([-2.2, 0, 0.6], [9.8, 10, 9.6]);
			prims.push(cylinder(add(Hc, [-0.6, 0, 9.4]), 10.2, 2.8, 1.6, o.hatMat, {
				group: 'hat',
				pattern: (lx, ly, lz) => ((Math.abs(lx) < 0.6 || Math.abs(ly) < 0.6) && lz > -2 ? { mat: 'medWhite' } : hash(Math.floor(lx * 0.7), Math.floor(ly * 0.7), 3) < 0.07 ? { mat: 'medWhite' } : null),
			}));
			break;
	}

	// Facial hair
	if (o.face === 'moustache' || o.face === 'beard') {
		prims.push(roundCone(add(Hc, [9.3, -3.4, -4.6]), add(Hc, [9.3, 3.4, -4.6]), 1.35, 1.35, hair, { group: 'head' }));
		for (const side of [1, -1]) prims.push(ellipsoid(add(Hc, [8.8, side * 3.9, -5.6]), [1.1, 1.1, 1.5], hair, { group: 'head' }));
	}
	if (o.face === 'beard') prims.push(ellipsoid(add(Hc, [5, 0, -7.4]), [6.8, 8, 5.2], hair, { group: 'hair' }));
	if (o.face === 'walrus') {
		// A heavy moustache drooping past the corners of the mouth.
		prims.push(roundCone(add(Hc, [9.5, -4.2, -4.4]), add(Hc, [9.5, 4.2, -4.4]), 1.9, 1.9, hair, { group: 'head' }));
		for (const side of [1, -1]) prims.push(roundCone(add(Hc, [9.2, side * 4.2, -4.6]), add(Hc, [8.8, side * 4.8, -8]), 1.6, 1.1, hair, { group: 'head' }));
	}

	// In the mouth: a pipe with its bowl, or a papirosa.
	if (o.mouth === 'pipe') {
		prims.push(roundCone(add(Hc, [9.6, -1.6, -5.6]), add(Hc, [14, -3.2, -7.4]), 0.7, 0.7, 'woodDark', { group: 'pipe' }));
		prims.push(cylinder(add(Hc, [14.6, -3.4, -6]), 1.6, 2, 0.4, 'woodDark', { group: 'pipe' }));
	}
	if (o.mouth === 'papirosa') prims.push(roundCone(add(Hc, [9.6, 1.6, -5.6]), add(Hc, [14.4, 3.4, -6.4]), 0.55, 0.55, 'medWhite', { group: 'pipe' }));

	// A satchel on the right hip, its strap across the chest from the left shoulder.
	if (extras.has('satchel')) {
		prims.push(box([lean * 0.4 + 1, -10.4 + jy, 27 + bob], [4.6, 1.8, 4.2], 1, 'brownLeather', { group: 'bag', pattern: (_lx, _ly, lz) => (lz > 2.4 ? { shift: -1 } : null) }));
		prims.push(roundCone([lean + 6.6, 7.4 + jy, 44 + bob], [lean * 0.4 + 5.2, -9 + jy, 29 + bob], 0.8, 0.8, 'brownLeather', { group: 'bag' }));
	}

	// Sledgehammer
	let strikePoint: V3 | null = null;
	if (p.hammer) {
		const { g, th, roll } = p.hammer;
		const [dir, perp, side] = hammerAxes(th, roll);
		prims.push(roundCone(sub(g, scale(dir, 4)), add(g, scale(dir, 25)), 1.4, 1.5, 'wood', { group: 'hammer' }));
		const hc = add(g, scale(dir, 27));
		prims.push(box(hc, [7, 3.4, 3.4], 1.1, 'iron', { group: 'hammerhead' }, [perp, side, dir]));
		if (p.hammer.spark) strikePoint = add(hc, scale(perp, 7.5));
	}

	// Newspaper: two halves meeting at the fold, printed in columns below a clear masthead band.
	if (p.paper) {
		const { c, turn } = p.paper;
		// Newsprint is lifted a tone and the lines of print left at the base tone, so the columns
		// still show when the page faces away from the light and sits on the darkest tone.
		const print: Pattern = (_lx, ly, lz) => (lz < PAPER_H - 5.5 && Math.abs(ly) > 1 && ((lz + 40) % 2.4) < 1.2 ? null : { shift: 1 });
		prims.push(box(add(c, [0, PAPER_W / 2, 0]), [0.6, PAPER_W / 2, PAPER_H], 0.4, 'cream', { group: 'paper', pattern: (lx, ly, lz, ...n) => print(lx, ly + PAPER_W / 2, lz, ...n) }));
		const a = (turn * Math.PI) / 180;
		const u: V3 = [Math.sin(a), -Math.cos(a), 0];
		const nrm: V3 = [Math.cos(a), Math.sin(a), 0];
		prims.push(box(add(c, scale(u, PAPER_W / 2)), [0.6, PAPER_W / 2, PAPER_H], 0.4, 'cream', { group: turn ? 'page' : 'paper', pattern: turn ? undefined : (lx, ly, lz, ...n) => print(lx, ly - PAPER_W / 2, lz, ...n) }, [nrm, u, [0, 0, 1]]));
	}

	// Notebook (red cover, cream page) and a yellow pencil.
	if (p.notebook) {
		const basis: [V3, V3, V3] = [NB_N, NB_W, NB_H];
		prims.push(box(NB_C, [0.9, 7.8, 7], 0.3, 'red', { group: 'notebook' }, basis));
		prims.push(box(add(NB_C, scale(NB_N, 0.8)), [0.4, 7.1, 6.3], 0.2, 'cream', { group: 'nbpage' }, basis));
		const up = norm([-0.35, -0.45, 0.85]);
		prims.push(roundCone(p.notebook.tip, add(p.notebook.tip, scale(up, 11)), 0.7, 1, 'mustard', { group: 'pencil' }));
	}

	// Small things in hand.
	if (p.held) {
		const { kind, at } = p.held;
		if (kind === 'glass') {
			// A faceted glass of soda: the bubbles are the lighter facets.
			prims.push(cylinder(at, 1.7, 2.9, 0.4, 'ice', { group: 'glass', pattern: (lx, ly, lz) => (lz > 1.8 ? null : Math.floor(Math.atan2(ly, lx) * 2.6) % 2 ? { shift: 1 } : null) }));
		} else if (kind === 'cup') {
			prims.push(cylinder(at, 2, 1.7, 0.5, 'medWhite', { group: 'cup', pattern: (_lx, _ly, lz, _nx, _ny, nz) => (nz > 0.9 && lz > 1.4 ? { mat: 'brownLeather' } : Math.abs(lz) < 0.4 ? { mat: 'red' } : null) }));
			prims.push(ellipsoid(add(at, [0, -2.3, 0]), [0.6, 1, 1.1], 'medWhite', { group: 'cup' }));
		} else if (kind === 'watch') {
			prims.push(cylinder(at, 2.6, 0.6, 0.3, 'brass', { group: 'watch', pattern: (lx, ly, _lz, _nx, _ny, nz) => (nz > 0.9 && Math.hypot(lx, ly) < 1.9 ? { mat: 'cream' } : null) }));
			prims.push(roundCone(at, add(at, [-3, 2, -4]), 0.35, 0.35, 'brass', { group: 'watch' }));
		} else if (kind === 'token') {
			prims.push(cylinder(at, 2.2, 0.5, 0.25, 'brass', { group: 'token', pattern: (lx, ly, _lz, _nx, _ny, nz) => (nz > 0.9 && Math.hypot(lx, ly) < 0.7 ? { shift: -1 } : null) }));
		} else if (kind === 'broom' && p.held.to) {
			const to = p.held.to;
			prims.push(roundCone(at, to, 0.8, 0.8, 'wood', { group: 'broom' }));
			prims.push(box(add(to, [0.6, 0, 0.8]), [2.2, 4.6, 2.2], 0.8, 'mustard', { group: 'bristles', pattern: (_lx, ly) => (((ly + 20) % 1.4) < 0.5 ? { shift: -1 } : null) }));
		}
	}
	if (p.saucer) prims.push(cylinder(p.saucer, 3.2, 0.35, 0.3, 'medWhite', { group: 'saucer', pattern: (lx, ly) => (Math.abs(Math.hypot(lx, ly) - 2.6) < 0.4 ? { mat: 'red' } : null) }));

	const decals = (f: Frame): void => {
		const skin = MATERIALS[o.skin];
		const hairM = MATERIALS[o.hair];
		const surf = (d: V3, r: V3): V3 => {
			const k = 1 / Math.sqrt((d[0] / r[0]) ** 2 + (d[1] / r[1]) ** 2 + (d[2] / r[2]) ** 2);
			return add(Hc, scale(d, k));
		};
		const facing = (pt: V3) => -dot(norm(sub(pt, Hc)), f.view.F) > -0.02;
		const eyes: [number, number][] = [];
		for (const side of [1, -1]) {
			const e = surf([8.3, side * 3.7, -0.4], [10, 9.6, 10.6]);
			if (!facing(e)) continue;
			const px = visible(f, e, 2.4);
			if (!px) continue;
			const edgeOn = -dot(norm(sub(e, Hc)), f.view.F) <= 0.45;
			// The outer side is away from the head's screen centre.
			const out = px[0] >= Math.round(project(f, Hc)[0]) ? 1 : -1;
			// An edge-on eye lands on the moustache line; lift it a pixel and pull it inward so
			// the profile still has a readable eye.
			const i = edgeOn ? px[0] - out : px[0];
			const j = edgeOn ? px[1] - 1 : px[1];
			eyes.push([i, j]);
			// Habbo-style eye: a 1×2 pupil with a 1×2 white on the outer side, which reads as a
			// glance instead of a dot. Edge-on eyes get no white, or it reads as an earring.
			const white = !edgeOn;
			if (o.face === 'roundGlasses' && !edgeOn) {
				// Thin gold rims, round: no corners.
				const x0 = Math.min(i, white ? i + out : i) - 1, x1 = Math.max(i, white ? i + out : i) + 1;
				for (let x = x0 + 1; x < x1; x++) { put(f, x, j - 1, MATERIALS.gold.tones[2]); put(f, x, j + 2, MATERIALS.gold.tones[2]); }
				for (let y = j; y <= j + 1; y++) { put(f, x0, y, MATERIALS.gold.tones[2]); put(f, x1, y, MATERIALS.gold.tones[2]); }
			}
			if (o.face === 'spectacles' && !edgeOn) {
				// Frame drawn first and around both pupil and white, so it never paints over them.
				const x0 = Math.min(i, white ? i + out : i) - 1, x1 = Math.max(i, white ? i + out : i) + 1;
				for (let x = x0; x <= x1; x++) { put(f, x, j - 1, INK.frame); put(f, x, j + 2, INK.frame); }
				for (let y = j; y <= j + 1; y++) { put(f, x0, y, INK.frame); put(f, x1, y, INK.frame); }
			}
			if (p.blink) {
				put(f, i, j + 1, skin.tones[0]);
				if (white) put(f, i + out, j + 1, skin.tones[0]);
			} else {
				if (white) {
					put(f, i + out, j, INK.eyeWhite);
					put(f, i + out, j + 1, INK.eyeWhite);
				}
				put(f, i, j, INK.eye);
				put(f, i, j + 1, INK.eye);
			}
			const b = surf([8.1, side * 3.9, 2.6], [10, 9.6, 10.6]);
			const bp = visible(f, b);
			if (bp && o.headwear !== 'ushanka' && o.face !== 'spectacles' && o.face !== 'roundGlasses') {
				put(f, bp[0], bp[1] - 1, hairM.tones[1]);
				put(f, bp[0] + out, bp[1] - 1, hairM.tones[1]);
			}
		}
		if ((o.face === 'spectacles' || o.face === 'roundGlasses') && eyes.length === 2) {
			// Bridge between the two frames.
			const [a, b] = eyes[0][0] < eyes[1][0] ? eyes : [eyes[1], eyes[0]];
			for (let x = a[0] + 1; x <= b[0] - 1; x++) put(f, x, Math.round((a[1] + b[1]) / 2), o.face === 'roundGlasses' ? MATERIALS.gold.tones[2] : INK.frame);
		}
		if (o.face === 'clean' || o.face === 'spectacles' || o.face === 'roundGlasses' || o.face === 'pencil') {
			const m = surf([9.2, 0, -5.2], [10, 9.6, 10.6]);
			const mp = facing(m) ? visible(f, m, 2.5) : null;
			if (mp) { put(f, mp[0], mp[1], INK.mouth); put(f, mp[0] + 1, mp[1], INK.mouth); }
			// A pencil moustache: one thin dark line just above the mouth.
			if (mp && o.face === 'pencil') for (let x = -1; x <= 2; x++) put(f, mp[0] + x, mp[1] - 1, hairM.tones[0]);
		}
		// The papirosa's glowing tip, and a wisp of smoke from the pipe.
		if (o.mouth) {
			const tip = add(Hc, o.mouth === 'pipe' ? [14.6, -3.4, -3.8] : [14.6, 3.5, -6.4]);
			const tp = facing(add(Hc, [9.6, 0, -5.6])) ? visible(f, tip, 3) : null;
			if (tp) put(f, tp[0], tp[1], o.mouth === 'pipe' ? INK.breath : INK.sparkHot, o.mouth === 'pipe' ? 170 : 255);
		}
		// Medals and badges on the chest, where the chest faces the viewer.
		const chestAt = (y: number, z: number): [number, number] | null => {
			const pt: V3 = [lean * 0.8 + 6.9 + BULK_X[o.torso], y + jy, 41.5 + bob + hunch * 0.5 + z];
			return dot([1, 0, 0], f.view.F) < 0.25 || Math.abs(y) > 7 ? visible(f, pt, 2.5) : null;
		};
		if (!bareTop && extras.has('heroStar')) {
			const sp = chestAt(4.6, 1.4);
			if (sp) {
				for (const [di, dj] of [[0, -2], [0, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [0, 1], [-1, 2], [1, 2], [-1, 1], [1, 1]]) put(f, sp[0] + di, sp[1] + dj, MATERIALS.gold.tones[2]);
				put(f, sp[0], sp[1], MATERIALS.gold.tones[3]);
				put(f, sp[0], sp[1] - 3, INK.posterRed);
			}
		}
		if (!bareTop && extras.has('orderLenin')) {
			const sp = chestAt(extras.has('heroStar') ? 1.2 : 4.6, -1.2);
			if (sp) {
				for (const [di, dj] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) put(f, sp[0] + di, sp[1] + dj, MATERIALS.gold.tones[2]);
				put(f, sp[0], sp[1], '#8c8f96');
				put(f, sp[0], sp[1] - 2, INK.posterRed);
			}
		}
		if (!bareTop && extras.has('komsomol')) {
			const sp = chestAt(-4.4, 1.6);
			if (sp) { for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0]]) put(f, sp[0] + di, sp[1] + dj, INK.posterRed); put(f, sp[0] + 1, sp[1], MATERIALS.gold.tones[2]); }
		}
		if (legs === 'bare') censor(f, add(pel, [6.2, 0, -2.6]), MATERIALS[o.skin].tones, frame % 2 === 1);
		// Badges: gold star on a peaked cap band, red star on an ushanka flap.
		const star = (pt: V3, col: string, core: string) => {
			const sp = facing(pt) ? visible(f, pt, 2.5) : null;
			if (!sp) return;
			for (const [di, dj] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]]) put(f, sp[0] + di, sp[1] + dj, col);
			put(f, sp[0], sp[1], core);
		};
		if (o.headwear === 'peaked') star(add(Hc, [10.9, 0, 6.8]), INK.posterGold, '#fff1a8');
		if (o.headwear === 'ushanka') star(add(Hc, [12.1, 0, 8.8]), INK.posterRed, INK.posterGold);
		if (o.headwear === 'pilotka') star(add(Hc, [9.8, -1.2, 9.6]), INK.posterRed, INK.posterGold);
		if (o.headwear === 'budenovka') {
			// The budenovka's big red cloth star, on the front of the crown.
			const sp = facing(add(Hc, [11, 0, 7.6])) ? visible(f, add(Hc, [11, 0, 7.6]), 2.5) : null;
			if (sp) {
				for (const [di, dj] of [[0, -3], [0, -2], [-1, -1], [0, -1], [1, -1], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [-1, 1], [0, 1], [1, 1], [-2, 2], [-1, 2], [1, 2], [2, 2], [-2, 3], [2, 3]]) put(f, sp[0] + di, sp[1] + dj, INK.posterRed);
			}
		}
		if (o.headwear === 'helmet') {
			// The lamp on the front of the hard hat, lit.
			const lp = facing(add(Hc, [11.4, 0, 8.4])) ? visible(f, add(Hc, [11.4, 0, 8.4]), 3) : null;
			if (lp) for (const [di, dj, c] of [[0, 0, '#fffbe0'], [1, 0, '#ffe680'], [0, 1, '#ffe680'], [1, 1, '#e8c040']] as const) put(f, lp[0] + di, lp[1] + dj, c);
		}

		if (p.paper && !p.paper.turn) masthead(f, p.paper.c);
		if (p.notebook) {
			// Pencil marks: short dashes in rows on the page, one more per stroke.
			const page = f.groups.indexOf('nbpage');
			for (let k = 0; k < p.notebook.marks; k++) {
				const [mi, mj] = project(f, onPage(-0.55 + (k % 2) * 0.55, 0.35 - Math.floor(k / 2) * 0.5, 0.2));
				for (const di of [0, 1]) {
					const i = Math.round(mi) + di, j = Math.round(mj);
					if (i >= 0 && j >= 0 && i < f.w && j < f.h && f.group[j * f.w + i] === page) put(f, i, j, INK.frame);
				}
			}
		}
		if (strikePoint) {
			const [si, sj, sd] = project(f, strikePoint);
			const sparks: [number, number, string][] = [
				[0, 0, '#ffffff'], [-1, -1, INK.spark], [1, -1, INK.spark], [-3, -2, INK.sparkHot], [3, -3, INK.spark],
				[4, -1, INK.sparkHot], [-4, 0, INK.spark], [2, -5, INK.sparkHot], [-2, -5, INK.spark], [5, -4, INK.sparkHot], [-5, -3, INK.sparkHot],
			];
			// Sparks sit at the strike point, so skip any pixel where the body is in front of it.
			for (const [di, dj, c] of sparks) {
				const i = Math.round(si + di), j = Math.round(sj + dj);
				if (i < 0 || j < 0 || i >= f.w || j >= f.h) continue;
				if (f.group[j * f.w + i] >= 0 && f.depth[j * f.w + i] < sd - 3) continue;
				put(f, i, j, c);
			}
		}
		if (p.breath !== undefined) {
			const [bi, bj, bd] = project(f, add(Hc, [13 + p.breath * 2.5, 0, -4 + p.breath]));
			const mouth = add(Hc, [10, 0, -5]);
			// No breath when the face is turned away: the puff would draw over the back of the head.
			if (!facing(mouth)) return;
			const puff = p.breath === 1 ? [[0, 0], [1, 0], [0, -1]] : [[0, 0], [1, 0], [2, -1], [1, -1], [3, -1], [2, -2]];
			for (const [di, dj] of puff) {
				const i = Math.round(bi + di), j = Math.round(bj + dj);
				if (i < 0 || j < 0 || i >= f.w || j >= f.h) continue;
				if (f.group[j * f.w + i] >= 0 && f.depth[j * f.w + i] < bd - 2) continue;
				put(f, i, j, INK.breath, p.breath === 1 ? 200 : 150);
			}
		}
		if (p.zzz !== undefined && p.zzz > 0) {
			// A small z, then a big Z, rising and drifting off the crown.
			const zs = [['###', '..#', '.#.', '###'], ['####', '...#', '..#.', '.#..', '####']];
			const [hi, hj] = project(f, add(Hc, [2, -3, 14]));
			for (let k = 0; k < Math.min(p.zzz, 2); k++) {
				const rows = zs[k], rise = (p.zzz - 1) * 3 + k * 6;
				rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') put(f, Math.round(hi) + 4 + k * 4 + i, Math.round(hj) - rise - j - 2, INK.chalk); }));
			}
		}
	};

	return { prims, decals };
}

/** How much bulkier than a shirt each top is (padding, fleece, a heavy coat). */
const BULK: Partial<Record<Outfit['torso'], number>> = { telogreika: 1, tulup: 1.6, shinel: 0.7, sweater: 0.3 };
/** The same, as x: how far the chest's front sits proud, for badges. */
const BULK_X: Record<Outfit['torso'], number> = {
	overalls: 0, tunic: 0, telogreika: 1, trench: 0, gymnastyorka: 0, telnyashka: 0, shinel: 0.7, suit: 0, sweater: 0.3,
	labcoat: 0, tulup: 1.6, vyshyvanka: 0, dress: 0, bare: 0,
};
/** Where coats and dresses hang below the waist: top and bottom of the skirt, model z. */
const HEM: Partial<Record<Outfit['torso'], { top: number; bottom: number }>> = {
	trench: { top: 29.5, bottom: 8.5 }, shinel: { top: 30, bottom: 11 }, labcoat: { top: 29.5, bottom: 12 },
	tulup: { top: 30, bottom: 14 }, dress: { top: 30, bottom: 7 },
};

/** The censor's word, stamped across the mosaic on every other frame. */
export const CENSOR_WORD = 'ЦЕНЗУРА';

/**
 * The mosaic over a comrade with nothing on: a block of skin-coloured squares, two pixels each,
 * and on alternate frames the censor's word stamped across it in red.
 *
 * @param {Frame} f Frame.
 * @param {V3} c The middle of the hips' front, model space.
 * @param {readonly string[]} tones The comrade's own skin tones, so the mosaic matches them.
 * @param {boolean} stamp Stamp the word this frame.
 */
function censor(f: Frame, c: V3, tones: readonly string[], stamp: boolean): void {
	const [ci, cj] = project(f, c).map(Math.round);
	for (let j = -4; j < 4; j++) for (let i = -5; i < 5; i++) {
		const t = tones[(Math.floor((i + 6) / 2) * 3 + Math.floor((j + 6) / 2) * 5) % tones.length];
		const x = ci + i, y = cj + j;
		if (x >= 0 && y >= 0 && x < f.w && y < f.h) put(f, x, y, t);
	}
	if (!stamp) return;
	const w = textWidth(CENSOR_WORD);
	const left = ci - Math.floor(w / 2), top = cj - 2;
	for (let x = left - 1; x <= left + w; x++) for (let y = top - 1; y <= top + 5; y++) if (x >= 0 && y >= 0 && x < f.w && y < f.h) put(f, x, y, '#f3ead6');
	drawText(CENSOR_WORD, 0, 0, (gx, gy) => { const x = left + gx, y = top + gy; if (x >= 0 && y >= 0 && x < f.w && y < f.h) put(f, x, y, INK.posterRed); });
}

/**
 * Print the masthead across the top of the newspaper's front page, following the page's slant
 * on screen. Only where the page itself is the visible surface, so hands in front hide letters
 * and the back of the paper (seen from behind) stays blank.
 *
 * @param {Frame} f Frame.
 * @param {V3} c Middle of the paper's fold.
 */
function masthead(f: Frame, c: V3): void {
	// The front faces the way he faces (+x); seen from behind or edge-on there is nothing to read.
	if (dot([1, 0, 0], f.view.F) > -0.3) return;
	const mid: V3 = add(c, [0.7, 0, PAPER_H - 3.2]);
	const [x0, y0] = project(f, mid);
	const [x1, y1] = project(f, add(mid, [0, -1, 0]));
	// Seen from the front, -y runs left to right on screen, so the masthead reads along it.
	if (x1 - x0 < 0.3) return;
	const slope = (y1 - y0) / (x1 - x0);
	if (Math.abs(slope) > 0.6) return;
	const paper = f.groups.indexOf('paper');
	const w = textWidth(MASTHEAD);
	const left = Math.round(x0 - w / 2);
	const top = Math.round(y0 - 2);
	drawText(MASTHEAD, 0, 0, (gx, gy) => {
		const i = left + gx, j = top + gy + Math.round((gx - w / 2) * slope);
		if (i >= 0 && j >= 0 && i < f.w && j < f.h && f.group[j * f.w + i] === paper) put(f, i, j, INK.masthead);
	});
}

/**
 * Render one sprite frame.
 *
 * @param {Outfit} o Outfit.
 * @param {Anim} anim Animation.
 * @param {Dir} dir Direction.
 * @param {number} frame Frame index.
 * @returns {Frame} Rendered frame.
 */
export function renderAvatar(o: Outfit, anim: Anim, dir: Dir, frame: number): Frame {
	const view: View = makeView(YAW[dir]);
	const { prims, decals } = build(o, pose(anim, frame), frame);
	const f = render(prims, { ...SPRITE, view, shadow: 12.5 });
	decals(f);
	return f;
}

/** Parts that make up the head as seen from outside: skull, hair and every kind of headwear. */
const HEAD_GROUPS = ['head', 'hair', 'hat', 'brim', 'flap'];
/** Parts whose horizontal extent defines the head's centre. Brims and ushanka flaps stick out to one side, so they are left out. */
const HEAD_CORE_GROUPS = ['head', 'hair', 'hat'];

/**
 * Point just above the top of the head or hat in an already rendered sprite frame.
 *
 * Read from the frame's group buffer rather than the model, so it follows every headwear
 * shape, pose (shiver hunch, walk and idle bob) and view exactly. The returned row is the
 * first one that is fully clear: the topmost head pixel has the outer outline on the row
 * above it, and the point sits one row above that. The hammer is never counted, so a raised
 * sledgehammer does not push a speech bubble into the air.
 *
 * @param {Frame} f Frame from `renderAvatar`.
 * @returns {{x: number, y: number}} Sprite pixel: x centred over the head, y just above it.
 */
export function headTopIn(f: Frame): { x: number; y: number } {
	const top = HEAD_GROUPS.map((g) => f.groups.indexOf(g)).filter((i) => i >= 0);
	const core = HEAD_CORE_GROUPS.map((g) => f.groups.indexOf(g)).filter((i) => i >= 0);
	let y0 = Infinity, x0 = Infinity, x1 = -Infinity;
	for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
		const g = f.group[j * f.w + i];
		if (g < 0) continue;
		if (top.includes(g) && j < y0) y0 = j;
		if (core.includes(g)) { if (i < x0) x0 = i; if (i > x1) x1 = i; }
	}
	// Every outfit has a head, so this only happens if the sprite canvas is clipped away.
	if (y0 === Infinity) throw new Error('The sprite frame has no head pixels, so there is nowhere to place a speech bubble.');
	return { x: Math.round((x0 + x1) / 2), y: y0 - 2 };
}

const headTopCache = new WeakMap<Outfit, Map<string, { x: number; y: number }>>();

/**
 * Point just above the top of the head or hat for one exact frame, in sprite pixels (the
 * feet are at SPRITE.ax, SPRITE.ay). This is where a speech bubble's tail tip belongs.
 *
 * Renders the frame once and caches the answer per outfit object, animation, direction and
 * frame. Callers that already hold the rendered frame should use `headTopIn` instead.
 *
 * @param {Outfit} o Outfit.
 * @param {Anim} anim Animation.
 * @param {Dir} dir Direction.
 * @param {number} frame Frame index.
 * @returns {{x: number, y: number}} Sprite pixel: x centred over the head, y just above it.
 */
export function headTop(o: Outfit, anim: Anim, dir: Dir, frame: number): { x: number; y: number } {
	let byFrame = headTopCache.get(o);
	if (!byFrame) { byFrame = new Map(); headTopCache.set(o, byFrame); }
	const key = `${anim}|${dir}|${frame}`;
	let pt = byFrame.get(key);
	if (!pt) { pt = headTopIn(renderAvatar(o, anim, dir, frame)); byFrame.set(key, pt); }
	return pt;
}
