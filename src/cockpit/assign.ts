/**
 * Who stands where. Each zone offers slots in hand-out order: its stations first (with the
 * facing the world gives them), then its idle spots, then, if a zone ever overflows, the
 * centres of its free walkable tiles. No two comrades share a slot, and a comrade keeps the
 * slot it already holds while it stays in that zone, so a new snapshot never reshuffles the room.
 *
 * Pure and DOM-free: tested in tests/cockpit-crew.test.ts.
 */
import type { Dir } from '../art/avatar';
import type { Footprint } from '../art/scene';
import type { V3 } from '../art/sdf';
import { isWalkable, tileCentre } from '../world/path';
import type { World, ZoneId } from '../world/types';
import { facingOf } from './walk';

export type SlotKind = 'station' | 'spot' | 'tile';

/** One place a comrade can stand. */
export interface Slot {
	zone: ZoneId;
	kind: SlotKind;
	/** Index within its kind in the zone: station 0 is the zone's first station. */
	index: number;
	pos: V3;
	/** Direction to face on arrival. */
	facing: Dir;
}

/** A comrade asking for a slot. */
export interface Want {
	id: string;
	zone: ZoneId;
}

/**
 * Stable key for a slot, used to tell whether two comrades hold the same one.
 *
 * @param s Slot.
 * @returns Key.
 */
export function slotKey(s: Slot): string {
	return `${s.zone}|${s.kind}|${s.index}`;
}

/**
 * The facing for a spot with no facing of its own: towards the nearest point of the nearest
 * prop within reach (the canteen table in front of you), or towards the middle of the zone's
 * spots in Siberia, where the huddle faces inwards. Falls back to facing the viewer (S).
 *
 * @param world World.
 * @param zone Zone of the spot.
 * @param p Spot.
 * @returns Facing.
 */
export function facingForSpot(world: World, zone: ZoneId, p: V3): Dir {
	if (zone === 'siberia') {
		const spots = world.zones.siberia.spots;
		const cx = spots.reduce((a, s) => a + s[0], 0) / spots.length, cy = spots.reduce((a, s) => a + s[1], 0) / spots.length;
		if (Math.hypot(cx - p[0], cy - p[1]) > 1) return facingOf(cx - p[0], cy - p[1]);
		return 'S';
	}
	let best: { d: number; dx: number; dy: number } | null = null;
	for (const prop of world.scene.props) {
		const f: Footprint = prop.foot;
		const nx = Math.min(Math.max(p[0], f.x0), f.x1), ny = Math.min(Math.max(p[1], f.y0), f.y1);
		const dx = nx - p[0], dy = ny - p[1];
		const d = Math.hypot(dx, dy);
		if (d > 1e-6 && d < 60 && (!best || d < best.d)) best = { d, dx, dy };
	}
	return best ? facingOf(best.dx, best.dy) : 'S';
}

/**
 * Every slot a zone offers, in hand-out order. Tile slots are the centres of the zone's
 * walkable tiles that are not within a comrade's width of a station or spot.
 *
 * @param world World.
 * @param zone Zone.
 * @returns Slots.
 */
export function slotsOf(world: World, zone: ZoneId): Slot[] {
	const z = world.zones[zone];
	const out: Slot[] = [];
	z.stations.forEach((pos, index) => out.push({ zone, kind: 'station', index, pos, facing: z.stationFacing[index] ?? 'S' }));
	z.spots.forEach((pos, index) => out.push({ zone, kind: 'spot', index, pos, facing: facingForSpot(world, zone, pos) }));
	const taken = [...z.stations, ...z.spots];
	let index = 0;
	for (let ty = z.tiles.y0; ty < z.tiles.y1; ty++) for (let tx = z.tiles.x0; tx < z.tiles.x1; tx++) {
		if (!isWalkable(world, tx, ty)) continue;
		const pos = tileCentre(world, tx, ty);
		if (taken.some((t) => Math.hypot(t[0] - pos[0], t[1] - pos[1]) < 24)) continue;
		out.push({ zone, kind: 'tile', index: index++, pos, facing: 'S' });
	}
	return out;
}

/**
 * Hand out slots.
 *
 * First everyone whose previous slot is in the zone they now want keeps it (in id order, so
 * the result never depends on the roster's order). Then the rest take the first free slot of
 * their zone, in id order. Anyone left over when a zone is completely full gets no slot
 * (it cannot happen with today's zones and a roster of dozens, but the caller must cope).
 *
 * @param slots Slots per zone, from slotsOf.
 * @param wants Who wants which zone.
 * @param previous Slots held before this call.
 * @returns Slot per comrade id.
 */
export function assignSlots(slots: (zone: ZoneId) => Slot[], wants: Want[], previous: ReadonlyMap<string, Slot>): Map<string, Slot> {
	const out = new Map<string, Slot>();
	const held = new Set<string>();
	const sorted = [...wants].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	for (const w of sorted) {
		const prev = previous.get(w.id);
		if (!prev || prev.zone !== w.zone || held.has(slotKey(prev))) continue;
		out.set(w.id, prev);
		held.add(slotKey(prev));
	}
	for (const w of sorted) {
		if (out.has(w.id)) continue;
		const free = slots(w.zone).find((s) => !held.has(slotKey(s)));
		if (!free) continue;
		out.set(w.id, free);
		held.add(slotKey(free));
	}
	return out;
}

/**
 * Wrap slotsOf in a per-zone cache: slots never change once the world is built.
 *
 * @param world World.
 * @returns Lookup of slots per zone.
 */
export function slotTable(world: World): (zone: ZoneId) => Slot[] {
	const cache = new Map<ZoneId, Slot[]>();
	return (zone) => {
		let s = cache.get(zone);
		if (!s) { s = slotsOf(world, zone); cache.set(zone, s); }
		return s;
	};
}
