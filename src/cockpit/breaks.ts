/**
 * Breaks and fidgets. An idle comrade in the Canteen takes a break every 30 to 90
 * seconds: a glass from the nearest free soda machine, a game at a chess table with another idle
 * comrade, tea at the samovar, sweeping where they stand, or (after five minutes with nothing to do)
 * a doze. Anyone standing still, working or not, fidgets every ten seconds or so: a stretch, a
 * yawn, a look at their pocket watch, one at a time in each room. Only idle comrades ever leave their
 * spot, so the plant stays honest: whoever is away from their station has nothing to do.
 *
 * A break holds a comrade lightly (crew's SOFT_HOLD): any scene can take them (a ceremony, the
 * cloakroom), work arriving sends them straight back, and furniture moved or taken away mid-break
 * ends that break.
 */
import { ANIMS, type Anim, DIRS, type Dir, YAW } from '../art/avatar';
import type { Facing } from '../art/furniture';
import type { Outfit } from '../art/outfits';
import type { V3 } from '../art/sdf';
import { findPath } from '../world/path';
import type { World } from '../world/types';
import { SAMOVAR } from '../world/zones';
import { type Comrade, type Crew, SOFT_HOLD } from './crew';

/** How long between an idle comrade's breaks (ms). */
export const BREAK_MIN_MS = 30_000, BREAK_MAX_MS = 90_000;
/** How long between fidgets for someone standing still (ms). */
export const FIDGET_MIN_MS = 8_000, FIDGET_MAX_MS = 14_000;
/** How long with nothing to do before a comrade may nod off (ms). */
export const DOZE_AFTER_MS = 5 * 60_000;
/** How long each break lasts once they are there (ms). */
export const LASTS: Record<Doing, number> = { soda: 8_000, chess: 25_000, tea: 9_000, sweep: 8_000, doze: 40_000 };

/** The breaks. */
export type Doing = 'soda' | 'chess' | 'tea' | 'sweep' | 'doze';
/** What each looks like. */
const ANIM: Record<Doing, Anim> = { soda: 'drink', chess: 'chess', tea: 'tea', sweep: 'sweep', doze: 'doze' };
/** The fidgets. */
const FIDGETS: Anim[] = ['stretch', 'yawn', 'watch'];
/** How likely each break is, where it can be had. */
const WEIGHT: Record<Doing, number> = { soda: 3, chess: 2, tea: 3, sweep: 1, doze: 2 };

/** A piece of furniture a break can use. */
export interface Usable {
	id: string;
	kind: 'soda' | 'chess';
	facing: Facing;
	/** The middle of its tile. */
	at: V3;
}

/** One place to take a break: where to walk to, where to be, and which way to face. */
export interface Use {
	/** What it is: a soda machine, a chess table's seat, or a place at the samovar. */
	kind: 'soda' | 'chess' | 'tea';
	/** Unique per place: the furniture's id and which seat. */
	key: string;
	/** The prop it belongs to, for sitting in front of or behind it. */
	prop: string | null;
	/** Where to walk to. */
	stand: V3;
	/** Where to be while at it (a stool: on it). */
	at: V3;
	dir: Dir;
	/** For a seat: true when it is the side nearer the viewer (drawn over the table). */
	front?: boolean;
}

/** Which way the piece's front (+x) points, per turn, and its back. */
const BACK: Dir[] = ['NW', 'NE', 'SE', 'SW'];

/**
 * The direction for a facing in degrees (0 = screen south-east), the nearest of the eight.
 *
 * @param yaw Degrees.
 * @returns Direction.
 */
function dirOf(yaw: number): Dir {
	const gap = (d: Dir): number => Math.abs((((YAW[d] - yaw) % 360) + 540) % 360 - 180);
	return DIRS.reduce((a, b) => (gap(b) < gap(a) ? b : a));
}

/**
 * An offset in a piece's own frame, turned and stood at its place.
 *
 * @param u Usable.
 * @param x Along its front.
 * @param y Across.
 * @returns World point.
 */
function off(u: Usable, x: number, y = 0): V3 {
	const c = [1, 0, -1, 0][u.facing], s = [0, 1, 0, -1][u.facing];
	return [u.at[0] + x * c - y * s, u.at[1] + x * s + y * c, 0];
}

/** Where a chess table's stools stand, in its own frame: at two opposite corners (see furniture.ts). */
export const CHESS_SEAT = 15;

/**
 * The places a piece offers: in front of a soda machine; a stool at each corner of a chess table,
 * the players facing each other across the board.
 *
 * @param u Usable.
 * @returns Places.
 */
export function usesOf(u: Usable): Use[] {
	if (u.kind === 'soda') return [{ kind: 'soda', key: u.id, prop: u.id, stand: off(u, 25), at: off(u, 25), dir: BACK[u.facing] }];
	/**
	 * One stool.
	 *
	 * @param side Which corner.
	 * @returns Place.
	 */
	const seat = (side: 1 | -1): Use => {
		const at = off(u, side * CHESS_SEAT, -side * CHESS_SEAT);
		return {
			kind: 'chess', key: `${u.id}:${side}`, prop: u.id, stand: off(u, side * 32, -side * 32), at,
			// Facing the board: the stool at (+, −) looks back along (−, +).
			dir: dirOf((side > 0 ? 135 : -45) + u.facing * 90),
			// Side by side across the screen, or one nearer than the other once the table is turned.
			front: at[0] + at[1] >= u.at[0] + u.at[1] - 1e-6,
		};
	};
	return [seat(1), seat(-1)];
}

/** The places at the samovar's counter, clear of the Canteen's spots. */
export const TEA_PLACES: V3[] = [-40, -2, 36].map((dy) => [SAMOVAR[0] - 24, SAMOVAR[1] + dy, 0]);

/** What breaks need from the cockpit. */
export interface BreaksDeps {
	crew: Crew;
	world: World;
	/** Every soda machine and chess table standing now. */
	usable(): Usable[];
	/** Start rendering an animation's frames for someone, so it is ready when they get there. */
	prefetch(o: Outfit, anim: Anim, dir: Dir): void;
	/** Random numbers in [0, 1). */
	rng?: () => number;
	/** Something to say on the card changed. */
	onChange?(id: string): void;
}

/** Breaks, for the cockpit. */
export interface Breaks {
	/** Move everything along. */
	tick(dt: number): void;
	/** What the card says about someone on a break, or null. */
	words(id: string): string | null;
	/** Who is on a break and doing what, for checks. */
	readonly doing: ReadonlyMap<string, Doing>;
}

/** One comrade's break. */
interface Errand {
	doing: Doing;
	use: Use | null;
	/** The other player, at chess. */
	partner: string | null;
	stage: 'going' | 'there' | 'leaving';
	/** Time left there (ms). */
	left: number;
}

/** The card's words for each break. */
const WORDS: Record<Doing, string> = {
	soda: 'On a break: a glass of soda water.',
	chess: 'On a break: a game of chess.',
	tea: 'On a break: tea at the samovar.',
	sweep: 'Nothing to do, so sweeping the floor.',
	doze: 'Nothing to do for a while, and nodding off.',
};

/**
 * Set up breaks and fidgets.
 *
 * @param d Dependencies.
 * @returns Breaks.
 */
export function createBreaks(d: BreaksDeps): Breaks {
	const rng = d.rng ?? Math.random;
	const errands = new Map<string, Errand>();
	const doing = new Map<string, Doing>();
	/** When each idle comrade's next break is due, and since when they have had nothing to do (sim ms). */
	const due = new Map<string, number>();
	const idleSince = new Map<string, number>();
	/** Fidgets under way (time left), and when the next is due, per comrade. */
	const fidgeting = new Map<string, number>();
	const fidgetDue = new Map<string, number>();
	let t = 0;

	/**
	 * A random time between two.
	 *
	 * @param lo Shortest.
	 * @param hi Longest.
	 * @returns Milliseconds.
	 */
	const between = (lo: number, hi: number): number => lo + rng() * (hi - lo);
	/**
	 * Whether a comrade may take a break: idle in the Canteen, seen, and not held by a scene.
	 *
	 * @param c Comrade.
	 * @returns True when they may.
	 */
	const free = (c: Comrade): boolean => !c.hidden && !c.gone && c.place.activity === 'idle' && c.place.zone === 'canteen' && (!c.held || c.held === SOFT_HOLD);

	/**
	 * End a break: off the stool, out of the pose, and back to placement (who walks them to their spot).
	 * A game of chess ends for both players.
	 *
	 * @param id Comrade.
	 * @param moved Their furniture moved away: they get up where they are, the stool being gone.
	 */
	const end = (id: string, moved = false): void => {
		const e = errands.get(id);
		if (!e) return;
		errands.delete(id);
		doing.delete(id);
		const c = d.crew.get(id);
		if (c && c.held === SOFT_HOLD) {
			if (e.use?.kind === 'chess' && e.stage !== 'going' && !moved) d.crew.place(id, e.use.stand);
			d.crew.release(id, SOFT_HOLD);
		}
		due.set(id, t + between(BREAK_MIN_MS, BREAK_MAX_MS));
		d.onChange?.(id);
		if (e.partner) end(e.partner, moved);
	};

	/**
	 * Whether a place can be walked to, all the way.
	 *
	 * @param c Who would walk.
	 * @param p Where.
	 * @returns True when a route ends exactly there.
	 */
	const reachable = (c: Comrade, p: V3): boolean => {
		const route = findPath(d.world, c.pos, p);
		const last = route?.at(-1);
		return !!last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1;
	};

	/**
	 * The places of a kind nobody is using now, nearest first.
	 *
	 * @param c Who is looking.
	 * @param kind What.
	 * @returns Places.
	 */
	const freeUses = (c: Comrade, kind: Use['kind']): Use[] => {
		const taken = new Set([...errands.values()].map((e) => e.use?.key));
		const all: Use[] = kind === 'tea'
			? TEA_PLACES.map((p, k) => ({ kind: 'tea', key: `samovar:${k}`, prop: null, stand: p, at: p, dir: 'SE' }))
			: d.usable().filter((u) => u.kind === kind).flatMap(usesOf);
		return all.filter((u) => !taken.has(u.key)).sort((a, b) => Math.hypot(a.stand[0] - c.pos[0], a.stand[1] - c.pos[1]) - Math.hypot(b.stand[0] - c.pos[0], b.stand[1] - c.pos[1]));
	};

	/**
	 * Send a comrade on a break.
	 *
	 * @param c Comrade.
	 * @param what The break.
	 * @param use Where, or null for one taken where they stand.
	 * @returns True when they went.
	 */
	const send = (c: Comrade, what: Doing, use: Use | null, partner: string | null = null): boolean => {
		if (!d.crew.hold(c.id, SOFT_HOLD)) return false;
		fidgeting.delete(c.id);
		d.prefetch(c.outfit, ANIM[what], use?.dir ?? c.dir);
		const e: Errand = { doing: what, use, partner, stage: 'going', left: LASTS[what] };
		errands.set(c.id, e);
		doing.set(c.id, what);
		if (use) {
			if (!d.crew.walk(c.id, use.stand)) { end(c.id); return false; }
		} else arrive(c, e);
		d.onChange?.(c.id);
		return true;
	};

	/**
	 * They are there: onto the stool for chess, and into the pose.
	 *
	 * @param c Comrade.
	 * @param e Their break.
	 */
	const arrive = (c: Comrade, e: Errand): void => {
		e.stage = 'there';
		if (e.use?.kind === 'chess' && e.use.prop) {
			d.crew.place(c.id, e.use.at);
			c.stack = e.use.front ? { over: [e.use.prop] } : { under: [e.use.prop] };
		}
		d.crew.pose(c.id, ANIM[e.doing], e.use?.dir ?? null);
	};

	/**
	 * Choose a break for someone due one, and send them (and a partner, for chess).
	 *
	 * @param c Comrade.
	 * @param standing Everyone free and standing, for a chess partner.
	 */
	const begin = (c: Comrade, standing: Comrade[]): void => {
		const options: [Doing, () => boolean][] = [];
		const soda = freeUses(c, 'soda').find((u) => reachable(c, u.stand));
		if (soda) options.push(['soda', () => send(c, 'soda', soda)]);
		const tea = freeUses(c, 'tea').find((u) => reachable(c, u.stand));
		if (tea) options.push(['tea', () => send(c, 'tea', tea)]);
		const partner = standing.find((o) => o.id !== c.id && !errands.has(o.id));
		if (partner) {
			// Both seats of one table, each reachable by the one who takes it.
			const seats = freeUses(c, 'chess');
			const table = [...new Set(seats.map((s) => s.prop))].map((p) => seats.filter((s) => s.prop === p)).find((pair) => pair.length === 2 && reachable(c, pair[0].stand) && reachable(partner, pair[1].stand));
			if (table) options.push(['chess', () => send(c, 'chess', table[0], partner.id) && (send(partner, 'chess', table[1], c.id) || (end(c.id), false))]);
		}
		options.push(['sweep', () => send(c, 'sweep', null)]);
		if (t - (idleSince.get(c.id) ?? t) >= DOZE_AFTER_MS) options.push(['doze', () => send(c, 'doze', null)]);
		let pick = rng() * options.reduce((n, [k]) => n + WEIGHT[k], 0);
		for (const [k, go] of options) {
			pick -= WEIGHT[k];
			if (pick <= 0) { if (!go()) due.set(c.id, t + 5_000); return; }
		}
	};

	return {
		get doing() { return doing; },
		words: (id) => { const e = errands.get(id); return e ? WORDS[e.doing] : null; },
		tick(dt) {
			t += dt;
			const all = d.crew.list();
			const places = new Map(d.usable().flatMap(usesOf).map((u) => [u.key, u]));
			// Breaks under way: ended by a scene taking them, work arriving, or their furniture moving or going.
			for (const [id, e] of [...errands]) {
				if (!errands.has(id)) continue;
				const c = d.crew.get(id);
				if (!c || c.held !== SOFT_HOLD) {
					errands.delete(id);
					doing.delete(id);
					d.onChange?.(id);
					if (e.partner) end(e.partner);
					continue;
				}
				const now = e.use && e.use.kind !== 'tea' ? places.get(e.use.key) : null;
				const moved = !!e.use && e.use.kind !== 'tea' && (!now || now.at[0] !== e.use.at[0] || now.at[1] !== e.use.at[1]);
				if (!free(c) || moved) { end(id, moved); continue; }
				if (e.stage === 'going') { if (!c.path.length) arrive(c, e); continue; }
				e.left -= dt;
				if (e.left <= 0) end(id);
			}
			// Fidgets under way, and their end.
			for (const [id, left] of [...fidgeting]) {
				const c = d.crew.get(id);
				const next = left - dt;
				if (!c || c.held !== SOFT_HOLD || errands.has(id)) { fidgeting.delete(id); continue; }
				if (next > 0) { fidgeting.set(id, next); continue; }
				fidgeting.delete(id);
				d.crew.release(id, SOFT_HOLD);
			}
			const standing = all.filter((c) => free(c) && !c.held && !c.path.length);
			// One fidget at a time in each room, so a busy room is lively rather than restless.
			const zoneOf = (id: string): string | undefined => d.crew.get(id)?.place.zone;
			const fidgetRooms = new Set([...fidgeting.keys()].map(zoneOf));
			for (const c of all) {
				if (free(c)) {
					if (!idleSince.has(c.id)) idleSince.set(c.id, t);
					if (!due.has(c.id)) due.set(c.id, t + between(BREAK_MIN_MS, BREAK_MAX_MS));
					if (!errands.has(c.id) && !c.held && !c.path.length && t >= due.get(c.id)!) begin(c, standing);
				} else if (!errands.has(c.id)) { idleSince.delete(c.id); due.delete(c.id); }
				// A fidget for anyone standing still at rest: idle, or at a desk (not at the anvil, not in Siberia).
				if (c.held || c.path.length || c.hidden || c.gone || c.anim !== 'idle' || c.place.zone === 'roam' || c.place.zone === 'siberia') continue;
				if (!fidgetDue.has(c.id)) { fidgetDue.set(c.id, t + between(FIDGET_MIN_MS, FIDGET_MAX_MS)); continue; }
				if (t < fidgetDue.get(c.id)! || fidgetRooms.has(c.place.zone)) continue;
				fidgetDue.set(c.id, t + between(FIDGET_MIN_MS, FIDGET_MAX_MS));
				fidgetRooms.add(c.place.zone);
				const anim = FIDGETS[Math.floor(rng() * FIDGETS.length)];
				if (!d.crew.hold(c.id, SOFT_HOLD)) continue;
				d.prefetch(c.outfit, anim, c.dir);
				d.crew.pose(c.id, anim, null);
				fidgeting.set(c.id, ANIMS[anim].reduce((a, b) => a + b, 0));
			}
			// Forget anyone who has left.
			const here = new Set(all.map((c) => c.id));
			for (const m of [due, idleSince, fidgetDue]) for (const id of m.keys()) if (!here.has(id)) m.delete(id);
		},
	};
}
