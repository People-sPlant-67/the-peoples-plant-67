/**
 * The life around the plant: smoke drifting from the wasteland's two chimneys, a
 * freight train crossing the haze far behind the plant every few minutes (with a far-off whistle),
 * and pigeons on the back walls that peck about and scatter when someone walks underneath, coming
 * back a while later. With less motion asked for, there is no smoke or train, and the pigeons sit
 * still.
 *
 * The pictures come from the sprite workers. The far train passes behind the wasteland's ruins, so
 * those are drawn again over it, on the stage's far layer.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import { CHIMNEY_TOPS, FAR_TRAIN, FAR_TRAIN_LEN, type PigeonFrame } from '../art/ambient';
import { type Frame, project } from '../art/render';
import type { V3 } from '../art/sdf';
import type { AmbientRequest, SpritePixels } from '../art/sprite-job';
import { wasteLandmarks } from '../art/wasteland';
import type { World } from '../world/types';
import type { Crew } from './crew';
import { createPictures, prefersLessMotion } from './pictures';
import type { Voice } from './sound-cues';
import type { Stage } from './stage';

/** How often each chimney puffs (s), how long a puff lives (s), and how fast it rises and drifts (world units a second). */
export const PUFF_EVERY = 0.7, PUFF_LIFE = 6, PUFF_RISE = 14, PUFF_DRIFT: V3 = [6, -3, 0];
/** How long between far trains (s), and how fast one goes (world units a second). */
export const TRAIN_GAP: [number, number] = [240, 480], TRAIN_SPEED = 55;
/** The first far train comes sooner (s). */
export const FIRST_TRAIN: [number, number] = [60, 120];
/** Where pigeons perch along the tops of the back walls, in tiles along each wall. */
export const PERCHES: { wall: 'ne' | 'nw'; at: number }[] = [
	{ wall: 'ne', at: 2.4 }, { wall: 'ne', at: 5.7 }, { wall: 'ne', at: 9.3 }, { wall: 'ne', at: 12.8 }, { wall: 'ne', at: 16.4 }, { wall: 'ne', at: 20.2 },
	{ wall: 'nw', at: 4.6 }, { wall: 'nw', at: 15.3 },
];
/** How close (tiles) someone walking below the wall must come to scatter a pigeon. */
export const SCARE_TILES = 1.5;
/** How long a flight takes (s), and how long a scattered pigeon stays away (s). */
export const FLIGHT_S = 1.6, AWAY_S: [number, number] = [20, 40];
/** The wall tops' height (world units): the back walls' height. */
const WALL_TOP = 165;

/** What the life around the plant needs from the cockpit. */
export interface AmbientDeps {
	stage: Pick<Stage, 'far' | 'wall'>;
	world: World;
	/** A picture from the sprite workers. */
	render(req: AmbientRequest): Promise<SpritePixels>;
	crew: Pick<Crew, 'list'>;
	/** Where a base-layer point is across the screen, 0 to 1, or null off screen. */
	screenX(x: number, y: number): number | null;
	/** Play a sound, panned. */
	play(voice: Voice, pan: number, gain: number): void;
	reducedMotion?(): boolean;
	rng?: () => number;
	/** Make a texture from pixels; tests pass one that needs no canvas. */
	makeTexture?(w: number, h: number, rgba: Uint8ClampedArray): Texture;
}

/** The life around the plant, for the cockpit. */
export interface Ambient {
	/** Move everything along. */
	tick(dt: number): void;
	/** For checks: pigeons on the walls and away, the far train's front (world x) or null, puffs in the air. */
	state(): { sat: number; away: number; train: number | null; puffs: number };
}

/** One pigeon. */
interface Pigeon {
	perch: V3;
	wall: 'ne' | 'nw';
	yaw: number;
	sprite: Sprite;
	state: 'sat' | 'off' | 'away' | 'in';
	/** Seconds into the state, and how long it lasts (away), or until the next peck (sat). */
	t: number;
	until: number;
	frame: PigeonFrame;
	/** Which way it flies off: screen x sign. */
	side: number;
}

/**
 * Start the life around the plant.
 *
 * @param d Dependencies.
 * @returns Ambient.
 */
export function createAmbient(d: AmbientDeps): Ambient {
	const rng = d.rng ?? Math.random;
	const reduced = d.reducedMotion ?? prefersLessMotion;
	const base: Frame = d.world.scene.base;
	const baseFrame = { w: base.w, h: base.h, ax: base.ax, ay: base.ay, view: base.view };
	const L = d.world.tile;
	/**
	 * A random time between two.
	 *
	 * @param lo Shortest.
	 * @param hi Longest.
	 * @returns Seconds.
	 */
	const between = (lo: number, hi: number): number => lo + rng() * (hi - lo);
	const picture = createPictures(d.render, d.makeTexture);

	// The far layer: the train, the ruins again over it, then the smoke.
	const trainLayer = new Container(), ruinLayer = new Container(), smokeLayer = new Container();
	d.stage.far.addChild(trainLayer, ruinLayer, smokeLayer);
	const train = new Sprite(Texture.EMPTY);
	train.visible = false;
	trainLayer.addChild(train);
	const ruins = wasteLandmarks().filter((m) => m.kind === 'ruin').map((m) => ({ id: m.id, sprite: ruinLayer.addChild(new Sprite(Texture.EMPTY)) }));
	let trainX: number | null = null;
	let nextTrain = between(...FIRST_TRAIN);
	let whistled = false;

	const puffs: { sprite: Sprite; age: number; from: V3 }[] = [];
	let puffT = 0;

	const pigeons: Pigeon[] = PERCHES.map((p) => {
		const perch: V3 = p.wall === 'ne' ? [p.at * L, -4, WALL_TOP] : [-4, p.at * L, WALL_TOP];
		const sprite = new Sprite(Texture.EMPTY);
		d.stage.wall.addChild(sprite);
		const along = rng() < 0.5;
		return { perch, wall: p.wall, yaw: p.wall === 'ne' ? (along ? 0 : 180) : (along ? 90 : -90), sprite, state: 'sat', t: 0, until: between(0.6, 2), frame: 0, side: rng() < 0.5 ? -1 : 1 };
	});
	let lastWings = -Infinity, clock = 0;

	/**
	 * Draw a pigeon where it is, in the frame it is in.
	 *
	 * @param p Pigeon.
	 */
	const drawPigeon = (p: Pigeon): void => {
		const f = p.state === 'sat' ? p.frame : 2;
		const t = picture({ ambient: 'pigeon', f, yaw: p.yaw });
		p.sprite.visible = p.state !== 'away' && !!t;
		if (!t) return;
		p.sprite.texture = t.tex;
		const [x, y] = project(base, p.perch);
		// Flying: up and out to one side, fading as it goes (or the same, backwards, coming in).
		const k = p.state === 'off' ? p.t / FLIGHT_S : p.state === 'in' ? 1 - p.t / FLIGHT_S : 0;
		p.sprite.position.set(Math.round(x - t.ax + p.side * 70 * k), Math.round(y - t.ay - 90 * k - (f === 2 && k === 0 ? 4 : 0)));
		p.sprite.alpha = k > 0.6 ? (1 - k) / 0.4 : 1;
	};

	return {
		tick(dt) {
			const s = dt / 1000;
			clock += s;
			const still = reduced();
			// The ruins over the train, once drawn.
			for (const r of ruins) {
				const t = picture({ ambient: 'landmark', id: r.id, base: baseFrame });
				if (t && r.sprite.texture !== t.tex) { r.sprite.texture = t.tex; r.sprite.position.set(t.ax, t.ay); }
			}
			// The far train.
			if (!still) {
				if (trainX === null) {
					nextTrain -= s;
					if (nextTrain <= 0) { trainX = FAR_TRAIN.x0; whistled = false; }
				} else {
					trainX += TRAIN_SPEED * s;
					if (trainX - FAR_TRAIN_LEN > FAR_TRAIN.x1) { trainX = null; nextTrain = between(...TRAIN_GAP); }
				}
			}
			const tt = trainX !== null ? picture({ ambient: 'farTrain', base: baseFrame }) : null;
			train.visible = trainX !== null && !!tt && !still;
			if (trainX !== null && tt) {
				train.texture = tt.tex;
				const [x, y] = project(base, [trainX, FAR_TRAIN.y, 0]);
				train.position.set(Math.round(x - tt.ax), Math.round(y - tt.ay));
				const sx = d.screenX(x, y - 30);
				if (!whistled && sx !== null && !still) { whistled = true; d.play('whistle', sx * 2 - 1, 0.22); }
			}
			// Smoke.
			if (!still) {
				puffT -= s;
				if (puffT <= 0) {
					puffT = PUFF_EVERY;
					for (const top of CHIMNEY_TOPS) puffs.push({ sprite: smokeLayer.addChild(new Sprite(Texture.EMPTY)), age: 0, from: top });
				}
			}
			for (let k = puffs.length - 1; k >= 0; k--) {
				const p = puffs[k];
				p.age += s;
				if (p.age >= PUFF_LIFE || still) { p.sprite.destroy(); puffs.splice(k, 1); continue; }
				const size = Math.min(4, Math.floor((p.age / PUFF_LIFE) * 5));
				const t = picture({ ambient: 'puff', k: size });
				p.sprite.visible = !!t;
				if (!t) continue;
				p.sprite.texture = t.tex;
				const at: V3 = [p.from[0] + PUFF_DRIFT[0] * p.age, p.from[1] + PUFF_DRIFT[1] * p.age, p.from[2] + 6 + PUFF_RISE * p.age];
				const [x, y] = project(base, at);
				p.sprite.position.set(Math.round(x - t.ax), Math.round(y - t.ay));
				p.sprite.alpha = 0.75 * (1 - p.age / PUFF_LIFE);
			}
			// Pigeons: pecking about; scattering from anyone walking below; coming back.
			const walkers = d.crew.list().filter((c) => c.path.length && !c.hidden).map((c) => c.pos);
			let scattered: Pigeon | null = null;
			for (const p of pigeons) {
				p.t += s;
				if (p.state === 'sat') {
					const near = walkers.some((w) => (p.wall === 'ne'
						? w[1] < SCARE_TILES * L && Math.abs(w[0] - p.perch[0]) < SCARE_TILES * L
						: w[0] < SCARE_TILES * L && Math.abs(w[1] - p.perch[1]) < SCARE_TILES * L));
					if (near && !still) { p.state = 'off'; p.t = 0; p.side = rng() < 0.5 ? -1 : 1; scattered = p; }
					else if (p.t >= p.until && !still) { p.t = 0; p.until = between(0.6, 2); p.frame = p.frame ? 0 : 1; }
				} else if (p.state === 'off' && p.t >= FLIGHT_S) { p.state = 'away'; p.t = 0; p.until = between(...AWAY_S); }
				else if (p.state === 'away' && p.t >= p.until) { p.state = 'in'; p.t = 0; }
				else if (p.state === 'in' && p.t >= FLIGHT_S) { p.state = 'sat'; p.t = 0; p.frame = 0; }
				drawPigeon(p);
			}
			if (scattered && clock - lastWings > 3) {
				const [x, y] = project(base, scattered.perch);
				const sx = d.screenX(x, y);
				if (sx !== null) { lastWings = clock; d.play('wings', sx * 2 - 1, 0.6); }
			}
		},
		state: () => ({
			sat: pigeons.filter((p) => p.state === 'sat').length,
			away: pigeons.filter((p) => p.state !== 'sat').length,
			train: trainX,
			puffs: puffs.length,
		}),
	};
}
