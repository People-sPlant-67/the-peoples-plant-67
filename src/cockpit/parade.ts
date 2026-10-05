/**
 * The May Day parade. The Konami code (↑ ↑ ↓ ↓ ← → ← → B A), typed anywhere but in a
 * box or while furnishing, calls everyone out: they fall in two abreast on a lap round the Canteen's
 * tables, the front pair carrying the «1 МАЯ» banner and everyone behind them a red flag, march one
 * lap to a side drum, and go back to what they were doing.
 *
 * The Canteen is the plant's biggest room, and the doorways are a tile wide, too narrow for a column
 * two abreast, so the lap stays in it. With the furniture moved so that no lap is clear, they mark
 * time where they stand instead.
 *
 * A marcher is held lightly (crew's PARADE_HOLD): a ceremony or the cloakroom can still take them,
 * and their real work is never touched. The flags are drawn over each marcher's ordinary walking
 * frames, so the parade adds no frames of its own to the frame bank.
 */
import { Sprite, Texture } from 'pixi.js';
import type { Anim, Dir } from '../art/avatar';
import type { BannerDir } from '../art/eggs';
import { type Actor, feetOnScreen } from '../art/scene';
import type { V3 } from '../art/sdf';
import type { AmbientRequest, SpritePixels } from '../art/sprite-job';
import type { Outfit } from '../art/outfits';
import { segmentClear } from '../world/path';
import type { World } from '../world/types';
import { type Comrade, type Crew, MEDAL_HOLD, PARADE_HOLD, inScene } from './crew';
import { createPictures } from './pictures';
import type { Voice } from './sound-cues';
import type { Stage } from './stage';
import { WALK_SPEED } from './walk';

/** The secret: ↑ ↑ ↓ ↓ ← → ← → B A. */
export const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'] as const;

/**
 * Listen for the Konami code, one key at a time.
 *
 * @returns Feed it each key (KeyboardEvent.key, and .code so B and A work on any keyboard layout); it
 * answers true on the last key of the code.
 */
export function createKonami(): (key: string, code?: string) => boolean {
	const last: string[] = [];
	return (key, code) => {
		last.push(code === 'KeyB' ? 'b' : code === 'KeyA' ? 'a' : key.length === 1 ? key.toLowerCase() : key);
		if (last.length > KONAMI.length) last.shift();
		if (last.length < KONAMI.length || !last.every((k, i) => k === KONAMI[i])) return false;
		last.length = 0;
		return true;
	};
}

/** A lap: the middle of its lanes, in tiles. */
export interface Lap { x0: number; x1: number; y0: number; y1: number }

/** The laps round the Canteen's tables, first choice first: the back pair, the front pair, all four. */
export const LAPS: readonly Lap[] = [
	{ x0: 9.62, x1: 20.4, y0: 14.3, y1: 17 },
	{ x0: 9.62, x1: 20.4, y0: 17, y1: 19.4 },
	{ x0: 9.62, x1: 20.4, y0: 14.3, y1: 19.4 },
];
/** Half the gap between the two files (world units), the rows' spacing, and the corners' radius. */
export const FILE_HALF = 13, ROW_GAP = 46, CORNER = 20;
/** The longest anyone takes to fall in before the march starts without them (ms). */
export const GATHER_MAX_MS = 15_000;
/** Standing to attention, flags up, before the first step (ms). */
export const READY_MS = 1_500;
/** How long they mark time when no lap is clear (ms). */
export const MARK_MS = 15_000;
/** The drum: one beat every step (ms), every other one louder. */
export const BEAT_MS = 260;

/** Which way someone walking along a lane faces: east, south, west, north along the tiles. */
const AXIS: BannerDir[] = ['SE', 'SW', 'NW', 'NE'];

/** A lap laid out in world units: its length, and the point and heading at any distance along it. */
export interface Track {
	length: number;
	/**
	 * Where a file is at a distance along the lap.
	 *
	 * @param s Distance from the start (any number: it wraps).
	 * @param side -1 the inside file, 1 the outside, 0 the middle.
	 * @returns Point and heading (degrees, 0 along +x).
	 */
	at(s: number, side: number): { pos: V3; heading: number };
}

/**
 * A lap as a track: a rectangle with rounded corners, walked clockwise on the map (along +x first),
 * starting at the back lane's west end. The files keep abreast round the corners by wheeling: the
 * outside file walks a wider arc.
 *
 * @param lap Lap in tiles.
 * @param L Tile size.
 * @returns Track.
 */
export function trackOf(lap: Lap, L: number): Track {
	const x0 = lap.x0 * L, x1 = lap.x1 * L, y0 = lap.y0 * L, y1 = lap.y1 * L, r = CORNER;
	const a = x1 - x0 - 2 * r, b = y1 - y0 - 2 * r, arc = (Math.PI * r) / 2;
	// Each side: its straight's start, and the corner's centre after it.
	const sides: { from: [number, number]; centre: [number, number] }[] = [
		{ from: [x0 + r, y0], centre: [x1 - r, y0 + r] },
		{ from: [x1, y0 + r], centre: [x1 - r, y1 - r] },
		{ from: [x1 - r, y1], centre: [x0 + r, y1 - r] },
		{ from: [x0, y1 - r], centre: [x0 + r, y0 + r] },
	];
	const lens = [a, b, a, b];
	const length = 2 * (a + b) + 4 * arc;
	return {
		length,
		at(s, side) {
			let d = ((s % length) + length) % length;
			for (let k = 0; k < 4; k++) {
				const h0 = k * 90;
				let mid: [number, number], heading: number;
				if (d <= lens[k]) {
					const [fx, fy] = sides[k].from;
					mid = [fx + Math.cos((h0 * Math.PI) / 180) * d, fy + Math.sin((h0 * Math.PI) / 180) * d];
					heading = h0;
				} else if (d <= lens[k] + arc) {
					heading = h0 + ((d - lens[k]) / arc) * 90;
					const phi = ((heading - 90) * Math.PI) / 180;
					mid = [sides[k].centre[0] + Math.cos(phi) * r, sides[k].centre[1] + Math.sin(phi) * r];
				} else { d -= lens[k] + arc; continue; }
				// The outward normal: left of the way they walk, on this clockwise lap.
				const h = (heading * Math.PI) / 180;
				return { pos: [mid[0] + Math.sin(h) * FILE_HALF * side, mid[1] - Math.cos(h) * FILE_HALF * side, 0], heading };
			}
			return this.at(0, side);
		},
	};
}

/**
 * The way to face for a heading: the nearest of the floor's four axes.
 *
 * @param heading Degrees.
 * @returns Direction.
 */
export function axisOf(heading: number): BannerDir {
	return AXIS[((Math.round(heading / 90) % 4) + 4) % 4];
}

/**
 * Whether both files of a lap keep clear of everything standing, all the way round.
 *
 * @param t Track.
 * @param feet Every footprint.
 * @returns True when clear.
 */
export function lapClear(t: Track, feet: Parameters<typeof segmentClear>[2]): boolean {
	const n = Math.ceil(t.length / 8);
	for (const side of [-1, 1]) {
		let prev = t.at(0, side).pos;
		for (let k = 1; k <= n; k++) {
			const p = t.at((k / n) * t.length, side).pos;
			if (!segmentClear(prev, p, feet)) return false;
			prev = p;
		}
	}
	return true;
}

/** What the parade needs from the cockpit. */
export interface ParadeDeps {
	crew: Crew;
	world: World;
	stage: Pick<Stage, 'layer'>;
	/** A picture from the sprite workers. */
	render(req: AmbientRequest): Promise<SpritePixels>;
	/** A comrade's place in the depth sort this frame, or null when not drawn. */
	zOf(id: string): number | null;
	/** Start rendering an animation's frames for someone. */
	prefetch(o: Outfit, anim: Anim, dir: Dir): void;
	/** Glide the camera to a point on the base layer. */
	glideTo(p: { x: number; y: number }): void;
	/** Where a base-layer point is across the screen, 0 to 1, or null off screen. */
	screenX(x: number, y: number): number | null;
	/** Play a sound, panned. */
	play(voice: Voice, pan: number, gain: number): void;
	/** Make a texture from pixels; tests pass one that needs no canvas. */
	makeTexture?(w: number, h: number, rgba: Uint8ClampedArray): Texture;
}

/** The parade, for the cockpit. */
export interface Parade {
	/** Call everyone out. False when a parade is already on, or there is nobody to march. */
	start(): boolean;
	/** Dismiss everyone now (furnishing opened). */
	stop(): void;
	/** Move everyone along. */
	tick(dt: number): void;
	/** Put the flags with their bearers, once the comrades are sorted for this frame (after the view's sync). */
	draw(): void;
	/** The banner, for the depth sort, while it is carried (placed by tick, before the view's sync). */
	extras(): { actor: Actor; sprite: Sprite }[];
	/** For checks: what is happening, who marches, the lap (its index in LAPS, or null marking time), and the flags showing. */
	state(): { stage: ParadeStage; marchers: string[]; lap: number | null; flags: number };
}

/** The parade's stages. */
export type ParadeStage = 'off' | 'gather' | 'ready' | 'march' | 'mark';

/** One marcher: their place in the column, and their flag. */
interface Marcher {
	id: string;
	row: number;
	side: number;
	flag: Sprite | null;
	dir: BannerDir;
}

/**
 * Set up the parade.
 *
 * @param d Dependencies.
 * @returns Parade.
 */
export function createParade(d: ParadeDeps): Parade {
	const L = d.world.tile;
	const scene = d.world.scene;
	const picture = createPictures(d.render, d.makeTexture);

	let stage: ParadeStage = 'off';
	let marchers: Marcher[] = [];
	let track: Track | null = null;
	let lapIndex: number | null = null;
	/** Where the head of the column starts, and time in this stage (ms). */
	let head0 = 0, t = 0, beatT = 0, beats = 0;
	const banner = new Sprite(Texture.EMPTY);
	banner.visible = false;
	d.stage.layer.addChild(banner);
	const bannerActor: Actor = { id: 'parade-banner', pos: [0, 0, 0] };

	/**
	 * Whether a comrade is still in the parade.
	 *
	 * @param m Marcher.
	 * @returns Their comrade, or null when a scene took them or they went.
	 */
	const still = (m: Marcher): Comrade | null => { const c = d.crew.get(m.id); return c && c.held === PARADE_HOLD ? c : null; };

	/**
	 * Drop a marcher: their flag goes, and they go back to placement (unless a scene took them).
	 *
	 * @param m Marcher.
	 */
	const drop = (m: Marcher): void => {
		m.flag?.destroy();
		m.flag = null;
		d.crew.release(m.id, PARADE_HOLD);
	};

	/** Dismiss the parade. */
	const dismiss = (): void => {
		for (const m of marchers) drop(m);
		marchers = [];
		stage = 'off';
		track = null;
		lapIndex = null;
		banner.visible = false;
	};

	/**
	 * Where a marcher stands in the column when the head is at a distance along the lap.
	 *
	 * @param m Marcher.
	 * @param head The head's distance.
	 * @returns Point and facing.
	 */
	const placeOf = (m: Marcher, head: number): { pos: V3; dir: BannerDir } => {
		const p = track!.at(head - m.row * ROW_GAP, m.side);
		return { pos: p.pos, dir: axisOf(p.heading) };
	};

	/**
	 * Flags up for everyone behind the front pair.
	 *
	 * @param who Only these (those who have just fallen in); everyone when left out.
	 */
	const raiseFlags = (who: Marcher[] = marchers): void => {
		for (const m of who) {
			if (m.flag || (m.row === 0 && lapIndex !== null)) continue;
			m.flag = new Sprite(Texture.EMPTY);
			m.flag.visible = false;
			d.stage.layer.addChild(m.flag);
		}
	};

	/**
	 * A beat of the drum, from where the column is.
	 *
	 * @param at Where to hear it from.
	 * @param loud The stronger beat.
	 */
	const beat = (at: V3, loud: boolean): void => {
		const [x, y] = feetOnScreen(scene, at);
		const sx = d.screenX(x, y - 30);
		if (sx !== null) d.play('snare', sx * 2 - 1, loud ? 0.5 : 0.22);
	};

	/**
	 * Move the parade along.
	 *
	 * @param dt Milliseconds.
	 */
	const step = (dt: number): void => {
		if (stage === 'off') return;
		t += dt;
		for (const m of [...marchers]) if (!still(m)) { m.flag?.destroy(); marchers = marchers.filter((x) => x !== m); }
		if (!marchers.length) { dismiss(); return; }
		if (stage === 'mark') {
			beatT += dt;
			if (beatT >= BEAT_MS) { beatT -= BEAT_MS; beat(d.crew.get(marchers[0].id)!.pos, beats++ % 2 === 0); }
			if (t >= MARK_MS) dismiss();
			return;
		}
		if (stage === 'gather') {
			const waiting = marchers.filter((m) => d.crew.get(m.id)!.path.length);
			// Each flag goes up as its bearer falls in, so the column visibly forms.
			raiseFlags(marchers.filter((m) => !waiting.includes(m)));
			if (waiting.length && t < GATHER_MAX_MS) return;
			// Whoever has not fallen in by now misses it.
			for (const m of waiting) { drop(m); marchers = marchers.filter((x) => x !== m); }
			if (!marchers.length) { dismiss(); return; }
			stage = 'ready';
			t = 0;
			raiseFlags();
			// A beat of the drum: the column is formed.
			const front = d.crew.get(marchers[0].id)!.pos;
			beat(front, true);
			return;
		}
		if (stage === 'ready') {
			if (t < READY_MS) return;
			stage = 'march';
			t = 0;
			beatT = 0;
			beats = 0;
			// All step off together, so they march in step.
			for (const m of marchers) d.crew.pose(m.id, 'walk', m.dir);
			return;
		}
		// Marching: one lap at walking pace, then dismissed.
		const head = head0 + WALK_SPEED * t;
		if (head - head0 >= track!.length) { dismiss(); return; }
		for (const m of marchers) {
			const at = placeOf(m, head);
			d.crew.place(m.id, at.pos);
			if (at.dir !== m.dir) { m.dir = at.dir; d.crew.pose(m.id, 'walk', at.dir); }
		}
		beatT += dt;
		if (beatT >= BEAT_MS) { beatT -= BEAT_MS; beat(track!.at(head, 0).pos, beats++ % 2 === 0); }
	};

	/** The banner a little ahead of the front pair, from when the column has formed until it is dismissed. */
	const placeBanner = (): void => {
		banner.visible = false;
		const carried = (stage === 'ready' || stage === 'march') && marchers.some((m) => m.row === 0);
		if (!carried || !track) return;
		const head = stage === 'march' ? head0 + WALK_SPEED * t : head0;
		const ahead = track.at(head + 16, 0);
		const dir = axisOf(ahead.heading);
		const tex = picture({ ambient: 'banner', dir });
		bannerActor.pos = ahead.pos;
		if (!tex) return;
		const [x, y] = feetOnScreen(scene, ahead.pos);
		banner.texture = tex.tex;
		banner.position.set(Math.round(x - tex.ax), Math.round(y - tex.ay));
		banner.visible = true;
	};

	return {
		start() {
			if (stage !== 'off') return false;
			// Ask for the flags and the banner now, so they are drawn by the time anyone falls in.
			for (const dir of AXIS) { picture({ ambient: 'flag', dir }); picture({ ambient: 'banner', dir }); }
			// The medal is a ceremony too: its two stay out of the parade.
			const all = d.crew.list().filter((c) => !c.hidden && !c.gone && !inScene(c) && c.held !== MEDAL_HOLD && c.place.zone !== 'siberia');
			if (!all.length) return false;
			const feet = scene.props.map((p) => p.foot);
			lapIndex = LAPS.findIndex((lap) => lapClear(trackOf(lap, L), feet));
			if (lapIndex < 0) {
				// No lap is clear: mark time where they stand.
				lapIndex = null;
				marchers = all.filter((c) => d.crew.hold(c.id, PARADE_HOLD)).map((c) => ({ id: c.id, row: 1, side: 0, flag: null, dir: 'SE' }));
				for (const m of marchers) {
					const c = d.crew.get(m.id)!;
					d.crew.place(m.id, c.pos);
					d.crew.pose(m.id, 'walk', 'SE');
				}
				if (!marchers.length) { dismiss(); return false; }
				stage = 'mark';
				t = 0;
				raiseFlags();
				const c0 = d.crew.get(marchers[0].id)!;
				const [x, y] = feetOnScreen(scene, c0.pos);
				d.glideTo({ x, y: y - 30 });
				return true;
			}
			track = trackOf(LAPS[lapIndex], L);
			// The column never laps itself: the tail stays clear of the head.
			const rows = Math.min(Math.ceil(all.length / 2), Math.floor(track.length / ROW_GAP) - 2);
			head0 = (LAPS[lapIndex].x1 - LAPS[lapIndex].x0) * L - 2 * CORNER - 10;
			const slots: { row: number; side: number; pos: V3 }[] = [];
			for (let r = 0; r < rows; r++) {
				const pair = r === rows - 1 && all.length % 2 && all.length < rows * 2 + 1 ? [0] : [-1, 1];
				for (const side of pair) slots.push({ row: r, side, pos: track.at(head0 - r * ROW_GAP, side).pos });
			}
			// Nearest first: each place to whoever is closest to it, closest pairs first.
			const pairs: [number, Comrade, number][] = [];
			for (const c of all) slots.forEach((s, k) => pairs.push([Math.hypot(c.pos[0] - s.pos[0], c.pos[1] - s.pos[1]), c, k]));
			pairs.sort((p, q) => p[0] - q[0]);
			const given = new Map<string, number>(), filled = new Set<number>();
			for (const [, c, k] of pairs) {
				if (given.has(c.id) || filled.has(k)) continue;
				given.set(c.id, k);
				filled.add(k);
			}
			marchers = [];
			for (const [id, k] of given) {
				const c = d.crew.get(id)!;
				const m: Marcher = { id, row: slots[k].row, side: slots[k].side, flag: null, dir: 'SE' };
				if (!d.crew.hold(id, PARADE_HOLD)) continue;
				const at = placeOf(m, head0);
				m.dir = at.dir;
				if (!d.crew.walk(id, at.pos)) { d.crew.release(id, PARADE_HOLD); continue; }
				d.crew.pose(id, null, at.dir);
				for (const dir of AXIS) d.prefetch(c.outfit, 'walk', dir);
				marchers.push(m);
			}
			if (!marchers.length) { dismiss(); return false; }
			stage = 'gather';
			t = 0;
			const mid = track.at(head0 - (rows / 2) * ROW_GAP, 0).pos;
			const [x, y] = feetOnScreen(scene, mid);
			d.glideTo({ x, y: y - 30 });
			return true;
		},
		stop() { if (stage !== 'off') dismiss(); },
		tick(dt) {
			step(dt);
			placeBanner();
		},
		draw() {
			for (const m of marchers) {
				if (!m.flag) continue;
				const c = d.crew.get(m.id);
				const z = d.zOf(m.id);
				const dir = (c?.dir ?? m.dir) as Dir;
				const tex = picture({ ambient: 'flag', dir });
				m.flag.visible = !!c && !c.hidden && z !== null && !!tex;
				if (!c || z === null || !tex) continue;
				const [x, y] = feetOnScreen(scene, c.pos);
				m.flag.texture = tex.tex;
				// Drawn on a comrade's own canvas, so placed exactly as their frame is (comrades.ts).
				m.flag.position.set(x - tex.ax, y - tex.ay);
				// Walking away, the pole is in the far hand: behind them.
				m.flag.zIndex = z + (dir === 'N' || dir === 'NE' || dir === 'NW' ? -0.5 : 0.5);
			}
		},
		extras: () => (banner.visible ? [{ actor: bannerActor, sprite: banner }] : []),
		state: () => ({ stage, marchers: marchers.map((m) => m.id), lap: lapIndex, flags: marchers.filter((m) => m.flag?.visible).length }),
	};
}
