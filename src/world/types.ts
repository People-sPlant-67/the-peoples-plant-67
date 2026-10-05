/**
 * Contract for the plant's world: one tile grid holding every zone, a depth-sortable scene,
 * and a walkability grid for pathfinding.
 */
import type { Scene } from '../art/scene';
import type { V3 } from '../art/sdf';

export type ZoneId =
	| 'recruitment' | 'directorate' | 'planRoom' | 'inspectorate' | 'production'
	| 'repair' | 'hygiene' | 'canteen' | 'palace' | 'siberia';

/** Tile rectangle, inclusive of x0/y0 and exclusive of x1/y1. */
export interface TileRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface Zone {
	id: ZoneId;
	/** English name for the name card and roster. */
	label: string;
	/** Cyrillic sign painted in the zone. */
	sign: string;
	tiles: TileRect;
	/** Work positions (feet, world units), in the order they are handed out. */
	stations: V3[];
	/** Direction a comrade faces while working at the station with the same index. */
	stationFacing: ('S' | 'SE' | 'E' | 'NE' | 'N' | 'NW' | 'W' | 'SW')[];
	/** Where comrades without a station stand (canteen tables, Siberian huddle, etc.). */
	spots: V3[];
}

/** The two back walls: north-east (the y = 0 plane) and north-west (the x = 0 plane). */
export type Wall = 'ne' | 'nw';

/** Where something hangs on a back wall: which wall, its middle along it and its top edge, world units. */
export interface WallSpot {
	wall: Wall;
	at: number;
	zTop: number;
}

/** The room something takes on a back wall, world units: from a0 to a1 along it, z0 to z1 up it. */
export interface WallRect {
	wall: Wall;
	a0: number;
	a1: number;
	z0: number;
	z1: number;
}

/** Pixels at a place on the base layer. */
export interface Patch { x: number; y: number; w: number; h: number; rgba: Uint8ClampedArray }

/** A poster the plant had from the start, which furnishing can take down and hang elsewhere. */
export interface HomePoster {
	id: string;
	/** Where it hangs at first. */
	spot: WallSpot;
	/** The base layer's pixels round it without it, and with it: swapped in to take it down and put it back. */
	under: Patch;
	over: Patch;
}

export interface World {
	scene: Scene;
	zones: Record<ZoneId, Zone>;
	/** Walkability per tile, row-major: 1 = a comrade can stand here with full clearance. */
	grid: { w: number; h: number; walkable: Uint8Array };
	/** World units per tile edge. */
	tile: number;
	/** Where new comrades appear (the railway platform). */
	spawn: V3;
	/** What hangs on the back walls for good (signs, boards, the photo, the goods doors), and the posters that can move. */
	walls: { art: WallRect[]; posters: HomePoster[] };
	/** Fixed places scenes send comrades to, each with the way to face there. */
	marks: Record<'desk' | 'dock' | 'bench' | 'benchStep' | 'prosecutor' | 'waiting' | 'cloak' | 'attendant', Mark>;
}

/** A place a scene sends someone, and which way they face there. */
export interface Mark {
	pos: V3;
	dir: 'S' | 'SE' | 'E' | 'NE' | 'N' | 'NW' | 'W' | 'SW';
}
