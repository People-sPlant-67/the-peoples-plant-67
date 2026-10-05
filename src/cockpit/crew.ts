/**
 * The crew: every comrade's position, route, facing and animation, driven by snapshots and a
 * frame clock. This is the cockpit's whole behaviour with no drawing in it, so the tests can
 * run it under Node against mock snapshots.
 *
 * - A snapshot decides where each comrade should be (placement), and assign.ts decides the
 *   exact slot. A comrade whose slot changes walks there along findPath's route.
 * - Comrades in the first snapshot start at their slots; anyone who joins later steps off the
 *   train at the platform and walks in. Anyone who leaves the org is removed.
 * - The Commissar ('roam') holds no slot. He shadows the busiest comrade (running, the latest
 *   heartbeat breaking a tie): he stands 2 tiles behind them, facing their back, and at each
 *   stop either peeks over his Pravda ('lurk') or writes in his notebook ('scribble'). He moves
 *   on 20 to 40 seconds after arriving, or as soon as his mark stops running. With nobody
 *   running he strolls to a random reachable free place outside Siberia instead.
 * - A scene (a train arrival, a trial) can hold a comrade: while held, placement no longer moves
 *   them and the scene walks, places and poses them instead. A held comrade who leaves the roster
 *   stays until the scene releases them, so a departure can be played out.
 */
import { ANIMS, type Anim, type Dir, YAW } from '../art/avatar';
import { type Outfit, seedOf } from '../art/outfits';
import type { V3 } from '../art/sdf';
import { outfitFor } from '../live/personas';
import { type Activity, type Placement, needsYou, placement } from '../live/placement';
import type { AgentState, Snapshot } from '../live/types';
import { findPath, isWalkable, segmentClear, tileCentre, tileOf } from '../world/path';
import { zoneAt } from '../world/zones';
import type { World, ZoneId } from '../world/types';
import { type Slot, assignSlots, slotKey, slotTable } from './assign';
import { WALK_SPEED, facingOf, stepAlong } from './walk';

/** Shortest and longest pause before The Commissar moves on, in ms. */
export const WANDER_MIN_MS = 20_000;
export const WANDER_MAX_MS = 40_000;
/** How soon The Commissar, idling on a wander, goes to watch someone who has started work. */
export const NOTICE_MS = 3_000;
/** How far behind his mark The Commissar stands, in tiles. */
export const SHADOW_TILES = 2;
/** Nobody stands closer than this to anyone else's place, in world units. */
export const PERSONAL_SPACE = 24;

/** Everything the view needs to draw one comrade. */
export interface Comrade {
	id: string;
	agent: AgentState;
	outfit: Outfit;
	place: Placement;
	/** Where they are headed and will stand; null when their zone is full, or for The Commissar. */
	slot: Slot | null;
	/** The Commissar's current stop, or null for everyone else. */
	roam: { pos: V3; facing: Dir } | null;
	pos: V3;
	/** Waypoints still ahead; empty when standing. */
	path: V3[];
	dir: Dir;
	anim: Anim;
	frame: number;
	/** Time spent in the current frame, ms. */
	frameT: number;
	/** Sim time (ms) when The Commissar next moves on; Infinity while walking or for anyone else. */
	nextWander: number;
	/** The comrade The Commissar is shadowing at this stop, or null. */
	shadow: string | null;
	/** What The Commissar does at this stop ('lurk' or 'scribble'), or null for everyone else. */
	idleAnim: Anim | null;
	needsYou: boolean;
	/** The scene holding this comrade, or null. */
	held: string | null;
	/** Not drawn (not yet off the train, or airbrushed). */
	hidden: boolean;
	/** Opacity, 1 normally; an airbrushing fades it to 0. */
	alpha: number;
	/** Left the roster while held; removed on release. */
	gone: boolean;
	/** What a held comrade does on arriving: face and animation, each null for "as now" / idle. */
	pose: { dir: Dir | null; anim: Anim | null } | null;
	/** Props this comrade draws over or under whatever their footprints say (sat at a chess table), or null. */
	stack: { over?: string[]; under?: string[] } | null;
}

/**
 * The owner of a light hold: a break or a fidget. Any other scene can take a comrade
 * held this way (a ceremony, the cloakroom), and the break notices it lost them.
 */
export const SOFT_HOLD = 'break';
/** The easter eggs' light holds: the May Day parade, and the medal for the plan fulfilled. */
export const PARADE_HOLD = 'parade', MEDAL_HOLD = 'medal';
/** Every light hold: a scene may take a comrade from any of them, and each notices it lost them. */
const LIGHT = new Set([SOFT_HOLD, PARADE_HOLD, MEDAL_HOLD]);

/**
 * Whether a scene has a comrade: held by anything but a light hold (a break, the parade, the medal).
 * A comrade on a break or marching is as free as one standing at their place, for The Commissar, the
 * ceremonies and the scenes alike.
 *
 * @param c Comrade.
 * @returns True when a scene holds them.
 */
export const inScene = (c: Pick<Comrade, 'held'>): boolean => !!c.held && !LIGHT.has(c.held);

/** What changed in one apply(), so the view can create, drop and re-dress sprites. */
export interface CrewChange {
	arrived: string[];
	left: { id: string; outfitId: string }[];
	/** Comrades whose outfit changed (a rename matched a different persona), with the old outfit id. */
	redressed: { id: string; from: string }[];
}

export interface CrewOptions {
	/** Random numbers in [0, 1), injectable so tests are repeatable. */
	rng?: () => number;
	/** What a comrade wears (the wardrobe's kept look); defaults to their own outfit. */
	outfitOf?: (agent: AgentState) => Outfit;
}

export interface Crew {
	/** Apply a snapshot's roster. Call only with data worth showing (see app.ts). */
	apply(snapshot: Snapshot): CrewChange;
	/** Advance walking, wandering and animation by dt milliseconds. */
	step(dt: number): void;
	list(): Comrade[];
	get(id: string): Comrade | undefined;
	/** Sim time in ms since the crew was created. */
	readonly time: number;
	/**
	 * Take a comrade out of placement's hands.
	 *
	 * @returns False when another scene already holds them, or they do not exist.
	 */
	hold(id: string, owner: string): boolean;
	/** Hand a comrade back to placement (a comrade who left the roster is removed now). */
	release(id: string, owner: string): void;
	/** Walk a held comrade to a point along a path. Returns false when there is no route. */
	walk(id: string, to: V3): boolean;
	/** Put a held comrade somewhere at once (the z may lift them onto a stage). */
	place(id: string, pos: V3): void;
	/** Set what a held comrade does when standing: facing and animation. */
	pose(id: string, anim: Anim | null, dir?: Dir | null): void;
	/** Show or hide a comrade. */
	setHidden(id: string, hidden: boolean): void;
	/**
	 * Dress a comrade in an outfit for now (a step of changing at the cloakroom), whatever the
	 * wardrobe says; null hands them back to the wardrobe.
	 */
	dressAs(id: string, outfit: Outfit | null): void;
	/**
	 * Bring back a comrade who left while the plant was closed, held by a scene so their
	 * departure can be played out. They stand at their old workplace and are removed on release.
	 */
	ghost(agent: AgentState, owner: string): void;
	/**
	 * The furniture changed: forget the free places worked out before, and send anyone
	 * whose walk now runs into something round it, to the same place.
	 */
	refloor(): void;
}

/**
 * The animation a comrade plays once standing still. Only the Production Floor has anvils, so
 * only comrades working there swing the hammer; at a desk (and for The Commissar, who inspects
 * rather than hammers) working looks like idling.
 *
 * @param activity Activity from placement.
 * @param zone The zone they stand in, or 'roam'.
 * @returns Animation.
 */
export function restingAnim(activity: Activity, zone: ZoneId | 'roam'): Anim {
	if (activity === 'shivering') return 'shiver';
	if (activity === 'working' && zone === 'production') return 'work';
	return 'idle';
}

/**
 * Whether a comrade is at the anvil and swinging, so its sprite must draw over the anvil
 * (the hammer lands on top of it), as the previewer does with the scene's workProps.
 *
 * @param c Comrade.
 * @returns True at production station 0 while working and standing.
 */
export function atAnvil(c: Comrade): boolean {
	return !!c.slot && c.slot.zone === 'production' && c.slot.kind === 'station' && c.slot.index === 0 && c.anim === 'work' && c.path.length === 0;
}

/**
 * The comrade The Commissar shadows: running (Paperclip's status, not a recent heartbeat), the
 * latest heartbeat breaking a tie, then the name. Nobody held by a scene, hidden or roaming.
 *
 * @param list The crew.
 * @param self The Commissar's id.
 * @returns The busiest comrade, or null when nobody is running.
 */
export function busiest(list: Comrade[], self: string): Comrade | null {
	return byBusyness(list, self)[0] ?? null;
}

/**
 * Everyone running, busiest first (see busiest).
 *
 * @param list The crew.
 * @param self The Commissar's id.
 * @returns Comrades.
 */
function byBusyness(list: Comrade[], self: string): Comrade[] {
	const beat = (c: Comrade): number => { const t = c.agent.lastHeartbeatAt ? Date.parse(c.agent.lastHeartbeatAt) : NaN; return Number.isFinite(t) ? t : -Infinity; };
	const running = list.filter((c) => c.id !== self && c.agent.status === 'running' && !inScene(c) && !c.hidden && !c.gone && c.place.zone !== 'roam' && c.place.zone !== 'siberia');
	running.sort((a, b) => beat(b) - beat(a) || a.agent.name.localeCompare(b.agent.name));
	return running;
}

/**
 * Where to stand to shadow someone: the walkable tile SHADOW_TILES behind them (opposite the
 * way they face), or the nearest walkable one around it, in the same room as them (never
 * through a wall), clear of everyone's places and reachable from where The Commissar is. He faces
 * them. A tile other than the one he stands on is preferred, so moving on behind the same
 * comrade is a visible shuffle. The search covers two tiles either side of the ideal spot, so a
 * mark with a wall close behind them still has somewhere to be watched from.
 *
 * @param world World.
 * @param mark Where the shadowed comrade stands (or will stand) and which way they face.
 * @param taken Everyone else's places, the mark's included.
 * @param from Where The Commissar is now.
 * @returns The spot and facing, or null when there is none.
 */
export function shadowSpot(world: World, mark: { pos: V3; facing: Dir }, taken: V3[], from: V3): { pos: V3; facing: Dir } | null {
	const a = (YAW[mark.facing] * Math.PI) / 180;
	const behind: V3 = [mark.pos[0] - Math.cos(a) * SHADOW_TILES * world.tile, mark.pos[1] - Math.sin(a) * SHADOW_TILES * world.tile, 0];
	const [bx, by] = tileOf(world, behind);
	const room = zoneAt(...tileOf(world, mark.pos));
	if (!room || room === 'siberia') return null;
	const candidates: V3[] = [];
	for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
		const tx = bx + dx, ty = by + dy;
		if (!isWalkable(world, tx, ty) || zoneAt(tx, ty) !== room) continue;
		candidates.push(tileCentre(world, tx, ty));
	}
	const here = (p: V3): number => (Math.hypot(p[0] - from[0], p[1] - from[1]) <= 0.5 ? 1 : 0);
	candidates.sort((p, q) => here(p) - here(q) || Math.hypot(p[0] - behind[0], p[1] - behind[1]) - Math.hypot(q[0] - behind[0], q[1] - behind[1]));
	for (const p of candidates) {
		if (!taken.every((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) >= PERSONAL_SPACE)) continue;
		if (Math.hypot(p[0] - from[0], p[1] - from[1]) > 0.5 && !findPath(world, from, p)) continue;
		return { pos: p, facing: facingOf(mark.pos[0] - p[0], mark.pos[1] - p[1]) };
	}
	return null;
}

/**
 * Create an empty crew for a world.
 *
 * @param world World.
 * @param opts Options.
 * @returns Crew.
 */
export function createCrew(world: World, opts: CrewOptions = {}): Crew {
	const rng = opts.rng ?? Math.random;
	/**
	 * What a comrade wears: the wardrobe's word, else their own outfit.
	 *
	 * @param agent Comrade.
	 * @returns Outfit.
	 */
	const dressOf = (agent: AgentState): Outfit => opts.outfitOf?.(agent) ?? outfitFor(agent);
	/** Outfits put on for now, by comrade. */
	const dressed = new Map<string, Outfit>();
	let slots = slotTable(world);
	const comrades = new Map<string, Comrade>();
	let t = 0;
	let started = false;
	/** Roamers whose last look found busy comrades but no room behind any of them. */
	const nowhereBehind = new Set<string>();
	/** Places The Commissar may wander to: every slot outside Siberia. Built on first use. */
	let roamPool: Slot[] | null = null;

	/**
	 * Point a comrade at a new destination, walking from where it stands.
	 *
	 * @param c Comrade.
	 * @param to Destination.
	 */
	function walkTo(c: Comrade, to: V3): void {
		if (Math.hypot(to[0] - c.pos[0], to[1] - c.pos[1]) < 0.5) { c.path = []; return; }
		const route = findPath(world, c.pos, to);
		// No route should never happen (tests/world-zones.test.ts proves every station and spot
		// is reachable), but if it does, arrive at once rather than stand frozen forever.
		if (!route) { c.pos = [to[0], to[1], 0]; c.path = []; return; }
		// The route starts where the comrade stands (or at the nearest tile centre); drop a
		// first waypoint that is the current position so the first step has a real heading.
		c.path = route.filter((p, k) => k > 0 || Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1]) > 0.5);
	}

	/**
	 * Choose The Commissar's next stop: behind the busiest comrade if anyone is running, otherwise a
	 * random free, reachable place outside Siberia, not within a comrade's width of anyone else's
	 * destination. Either way he picks what to do when he gets there.
	 *
	 * @param c The roaming comrade.
	 */
	function wander(c: Comrade): void {
		const others = [...comrades.values()].filter((o) => o !== c).map((o) => o.slot?.pos ?? o.roam?.pos ?? (o.gone ? null : o.pos)).filter((p): p is V3 => !!p);
		// The busiest comrade with room behind them; the next busiest when there is none.
		let mark: Comrade | null = null;
		let spot: { pos: V3; facing: Dir } | null = null;
		for (const m of byBusyness([...comrades.values()], c.id)) {
			spot = shadowSpot(world, m.slot ? { pos: m.slot.pos, facing: m.slot.facing } : { pos: m.pos, facing: m.dir }, others, c.pos);
			if (spot) { mark = m; break; }
		}
		// Remembered, so a busy plant with no room behind anyone does not cut every pause short.
		if (mark || !busiest([...comrades.values()], c.id)) nowhereBehind.delete(c.id); else nowhereBehind.add(c.id);
		if (mark && spot) {
			c.shadow = mark.id;
			c.roam = spot;
			c.idleAnim = rng() < 0.5 ? 'lurk' : 'scribble';
			walkTo(c, spot.pos);
			c.nextWander = Infinity;
			// Already there (nowhere else free behind them): settle and start the pause now.
			if (!c.path.length) arrive(c);
			return;
		}
		c.shadow = null;
		roamPool ??= (Object.keys(world.zones) as ZoneId[]).filter((z) => z !== 'siberia').flatMap((z) => slots(z));
		const free = roamPool.filter((s) => others.every((p) => Math.hypot(p[0] - s.pos[0], p[1] - s.pos[1]) >= PERSONAL_SPACE));
		for (let tries = 0; tries < 8 && free.length; tries++) {
			const pick = free[Math.floor(rng() * free.length)];
			if (Math.hypot(pick.pos[0] - c.pos[0], pick.pos[1] - c.pos[1]) < 1) continue;
			if (!findPath(world, c.pos, pick.pos)) continue;
			c.roam = { pos: pick.pos, facing: pick.facing };
			c.idleAnim = rng() < 0.5 ? 'lurk' : 'scribble';
			walkTo(c, pick.pos);
			c.nextWander = Infinity;
			return;
		}
		// Nowhere to go this time; try again after another pause.
		c.nextWander = t + WANDER_MIN_MS;
	}

	/**
	 * Whether The Commissar's mark has stopped running (or left), so he should move on now.
	 *
	 * @param c The roaming comrade.
	 * @returns True when the mark is no longer worth shadowing.
	 */
	function markLost(c: Comrade): boolean {
		if (!c.shadow) return false;
		const m = comrades.get(c.shadow);
		return !m || m.gone || m.hidden || inScene(m) || m.agent.status !== 'running';
	}

	/**
	 * Switch animation, restarting it from its first frame when it changes.
	 *
	 * @param c Comrade.
	 * @param anim Animation.
	 */
	function setAnim(c: Comrade, anim: Anim): void {
		if (c.anim === anim) return;
		c.anim = anim;
		c.frame = 0;
		c.frameT = 0;
	}

	/**
	 * Face the destination's way and play the animation for the comrade's activity.
	 *
	 * @param c Comrade.
	 */
	function settle(c: Comrade): void {
		if (c.held) {
			if (c.pose?.dir) c.dir = c.pose.dir;
			setAnim(c, c.pose?.anim ?? 'idle');
			return;
		}
		const roaming = c.place.zone === 'roam';
		const facing = roaming ? c.roam?.facing : c.slot?.facing;
		if (facing) c.dir = facing;
		setAnim(c, roaming && c.idleAnim ? c.idleAnim : restingAnim(c.place.activity, c.place.zone));
	}

	/**
	 * A comrade has just reached its destination: settle, and start The Commissar's pause.
	 *
	 * @param c Comrade.
	 */
	function arrive(c: Comrade): void {
		settle(c);
		if (c.place.zone === 'roam' && !c.held) c.nextWander = t + WANDER_MIN_MS + rng() * (WANDER_MAX_MS - WANDER_MIN_MS);
	}

	/**
	 * Hand out slots and send everyone not held where placement wants them.
	 *
	 * @param first True on the first roster: everyone starts at their slot.
	 * @param arrived Ids that joined in this roster.
	 */
	function assign(first: boolean, arrived: string[]): void {
		const fixed = [...comrades.values()].filter((c) => c.place.zone !== 'roam' && !c.held);
		// Held comrades keep their slots reserved, so nobody takes them while they are away.
		const heldSlots = [...comrades.values()].filter((c) => c.held && c.slot && c.place.zone !== 'roam').map((c) => ({ id: c.id, zone: c.slot!.zone }));
		const before = new Map([...comrades.values()].filter((c) => c.slot && c.place.zone !== 'roam').map((c) => [c.id, c.slot!] as const));
		const given = assignSlots(slots, [...fixed.map((c) => ({ id: c.id, zone: c.place.zone as ZoneId })), ...heldSlots], before);
		for (const c of fixed) {
			const isNew = arrived.includes(c.id);
			const slot = given.get(c.id) ?? null;
			const moved = !c.slot || !slot || slotKey(c.slot) !== slotKey(slot);
			c.slot = slot;
			if (!slot) { c.path = []; settle(c); continue; }
			if (first && isNew) { c.pos = [slot.pos[0], slot.pos[1], 0]; c.path = []; settle(c); continue; }
			if (moved || (c.path.length === 0 && Math.hypot(slot.pos[0] - c.pos[0], slot.pos[1] - c.pos[1]) > 0.5)) walkTo(c, slot.pos);
			if (c.path.length === 0) settle(c);
			else setAnim(c, 'walk');
		}
		// Roamers last, so they steer clear of the slots just handed out.
		for (const c of comrades.values()) {
			if (c.place.zone !== 'roam' || c.held) continue;
			// Idling on a wander when someone starts work: go and watch them soon, not after the full pause.
			if (!c.shadow && c.path.length === 0 && !nowhereBehind.has(c.id) && busiest([...comrades.values()], c.id)) c.nextWander = Math.min(c.nextWander, t + NOTICE_MS);
			if (first && arrived.includes(c.id)) {
				// Opening the cockpit: The Commissar is already somewhere, not on the platform.
				wander(c);
				if (c.roam) { c.pos = [c.roam.pos[0], c.roam.pos[1], 0]; c.path = []; arrive(c); }
			} else if (!c.roam) wander(c);
			// Standing: refresh the animation (the activity may have changed) but keep the pause running.
			else if (c.path.length === 0) settle(c);
		}
	}

	/**
	 * A comrade held by this owner, or undefined.
	 *
	 * @param id Comrade id.
	 * @returns Comrade if held.
	 */
	const heldOne = (id: string): Comrade | undefined => { const c = comrades.get(id); return c?.held ? c : undefined; };

	return {
		get time() { return t; },
		list: () => [...comrades.values()],
		get: (id) => comrades.get(id),
		hold(id, owner) {
			const c = comrades.get(id);
			if (!c || (c.held && c.held !== owner && !LIGHT.has(c.held))) return false;
			// Taken from a light hold (a break, the parade, the medal): off the stool and out of the pose first.
			const fromBreak = !!c.held && LIGHT.has(c.held) && owner !== c.held;
			if (fromBreak) { c.stack = null; c.pose = null; }
			c.held = owner;
			if (fromBreak && !c.path.length) settle(c);
			c.nextWander = Infinity;
			return true;
		},
		release(id, owner) {
			const c = comrades.get(id);
			if (!c || c.held !== owner) return;
			c.held = null;
			c.pose = null;
			c.stack = null;
			if (c.gone) { comrades.delete(id); return; }
			c.hidden = false;
			if (c.place.zone === 'roam') { c.roam = null; c.shadow = null; }
			// Back to placement straight away, not at the next snapshot.
			assign(false, []);
		},
		walk(id, to) {
			const c = heldOne(id);
			if (!c) return false;
			const from = c.pos;
			c.pos = [c.pos[0], c.pos[1], 0];
			walkTo(c, to);
			if (!c.path.length && Math.hypot(to[0] - c.pos[0], to[1] - c.pos[1]) >= 0.5) { c.pos = from; return false; }
			if (c.path.length) setAnim(c, 'walk');
			else settle(c);
			return true;
		},
		place(id, pos) {
			const c = heldOne(id);
			if (!c) return;
			c.pos = [pos[0], pos[1], pos[2]];
			c.path = [];
			settle(c);
		},
		pose(id, anim, dir = null) {
			const c = heldOne(id);
			if (!c) return;
			c.pose = { anim, dir };
			if (!c.path.length) settle(c);
		},
		dressAs(id, outfit) {
			if (outfit) dressed.set(id, outfit); else dressed.delete(id);
			const c = comrades.get(id);
			if (c) c.outfit = dressed.get(id) ?? dressOf(c.agent);
		},
		setHidden(id, hidden) {
			const c = comrades.get(id);
			if (c) c.hidden = hidden;
		},
		refloor() {
			slots = slotTable(world);
			roamPool = null;
			const feet = world.scene.props.map((p) => p.foot);
			for (const c of comrades.values()) {
				if (!c.path.length) continue;
				const pts = [c.pos, ...c.path];
				if (pts.slice(1).every((p, k) => segmentClear(pts[k], p, feet))) continue;
				walkTo(c, c.path[c.path.length - 1]);
			}
		},
		ghost(agent, owner) {
			if (comrades.has(agent.id)) return;
			const home = placement({ ...agent, status: 'running', lastHeartbeatAt: null }, t).zone;
			const zone: ZoneId = home === 'roam' ? 'canteen' : home;
			// Somewhere free at their old workplace, so they are not standing inside a colleague.
			const taken = [...comrades.values()].map((o) => o.slot?.pos ?? o.pos);
			const spot = slots(zone).find((s) => taken.every((p) => Math.hypot(p[0] - s.pos[0], p[1] - s.pos[1]) >= PERSONAL_SPACE)) ?? slots(zone)[0];
			comrades.set(agent.id, {
				id: agent.id, agent, outfit: dressOf(agent), place: { zone, activity: 'idle' }, slot: null, roam: null,
				pos: spot ? [spot.pos[0], spot.pos[1], 0] : [world.spawn[0], world.spawn[1], 0], path: [], dir: spot?.facing ?? 'SE', anim: 'idle',
				frame: 0, frameT: 0, nextWander: Infinity, shadow: null, idleAnim: null, needsYou: false,
				held: owner, hidden: false, alpha: 1, gone: true, pose: null, stack: null,
			});
		},
		apply(snapshot) {
			const change: CrewChange = { arrived: [], left: [], redressed: [] };
			const first = !started;
			// An empty first roster (a lapsed sign-in at start-up) must not turn the real first
			// roster into a parade from the platform.
			if (snapshot.agents.length) started = true;
			const seen = new Set<string>();
			for (const agent of snapshot.agents) {
				seen.add(agent.id);
				const place = placement(agent, snapshot.at);
				const outfit = dressed.get(agent.id) ?? dressOf(agent);
				let c = comrades.get(agent.id);
				if (!c) {
					const spawn = world.spawn;
					c = {
						id: agent.id, agent, outfit, place, slot: null, roam: null,
						pos: [spawn[0], spawn[1], 0], path: [], dir: 'SE', anim: 'idle',
						// Start each comrade part-way into its idle, so the room doesn't blink in unison.
						frame: seedOf(agent.id) % ANIMS.idle.length, frameT: 0, nextWander: Infinity, shadow: null, idleAnim: null, needsYou: false,
						held: null, hidden: false, alpha: 1, gone: false, pose: null, stack: null,
					};
					comrades.set(agent.id, c);
					change.arrived.push(agent.id);
				} else if (c.outfit.id !== outfit.id) {
					change.redressed.push({ id: c.id, from: c.outfit.id });
				}
				const wasRoaming = c.place.zone === 'roam' && !change.arrived.includes(c.id);
				c.agent = agent;
				c.outfit = outfit;
				c.place = place;
				c.needsYou = needsYou(agent, snapshot);
				c.gone = false;
				if (c.held) continue;
				if (place.zone !== 'roam') { c.roam = null; c.shadow = null; c.idleAnim = null; }
				else if (!wasRoaming) c.slot = null;
			}
			for (const [id, c] of comrades) {
				if (seen.has(id)) continue;
				change.left.push({ id, outfitId: c.outfit.id });
				// A held comrade stays for the scene to play out; release removes them.
				if (c.held) { c.gone = true; c.needsYou = false; continue; }
				comrades.delete(id);
			}

			assign(first, change.arrived);
			return change;
		},
		step(dt) {
			t += dt;
			for (const c of comrades.values()) {
				if (c.place.zone === 'roam' && !c.held && ((c.path.length === 0 && t >= c.nextWander) || markLost(c))) wander(c);
				if (c.path.length) {
					const s = stepAlong(c.pos, c.path, WALK_SPEED * dt);
					c.pos = s.pos;
					c.path = s.path;
					if (s.dir) c.dir = s.dir;
					if (s.arrived) arrive(c);
					else setAnim(c, 'walk');
				}
				const durations = ANIMS[c.anim];
				c.frameT += dt;
				// A long pause (a hidden tab) must not spin through thousands of frames.
				if (c.frameT > 10_000) c.frameT %= durations.reduce((a, b) => a + b, 0);
				while (c.frameT >= durations[c.frame % durations.length]) {
					c.frameT -= durations[c.frame % durations.length];
					c.frame = (c.frame + 1) % durations.length;
				}
				c.frame %= durations.length;
			}
		},
	};
}
