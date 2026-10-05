/**
 * Walking along a path, one frame at a time. Pure: no clock, no DOM, so the tests and the
 * headless run step it by hand.
 */
import { DIRS, type Dir, YAW } from '../art/avatar';
import { TILE } from '../art/render';
import type { V3 } from '../art/sdf';

/** Walking pace: one tile every 0.75s, in world units per millisecond. */
export const WALK_SPEED = TILE / 750;

/** Result of one step along a path. */
export interface Step {
	pos: V3;
	/** Waypoints still ahead, the next one first. Empty once arrived. */
	path: V3[];
	/** Facing for the direction of travel during this step, or null if the comrade did not move. */
	dir: Dir | null;
	arrived: boolean;
}

/**
 * The nearest of the 8 facings to a heading on the floor. Uses the model yaws the renderer
 * uses, so a comrade walking along +x faces SE, exactly as the sprite for SE is drawn.
 *
 * @param dx Heading x in world units.
 * @param dy Heading y in world units.
 * @returns Facing.
 */
export function facingOf(dx: number, dy: number): Dir {
	const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
	// Angular distance, wrapped into [0, 180].
	const off = (d: Dir): number => Math.abs(((deg - YAW[d] + 540) % 360) - 180);
	return DIRS.reduce((best, d) => (off(d) < off(best) ? d : best));
}

/**
 * Move up to `dist` world units along a path, passing through waypoints as they are reached.
 * Leftover distance after a waypoint carries on to the next one, so the pace is the same
 * whatever the frame rate. The facing is that of the last segment walked on.
 *
 * @param pos Current feet position.
 * @param path Waypoints ahead (the first one is the next to reach). Not modified.
 * @param dist Distance to cover, in world units (>= 0).
 * @returns New position, the waypoints still ahead, facing and whether the end was reached.
 */
export function stepAlong(pos: V3, path: V3[], dist: number): Step {
	let p: V3 = [pos[0], pos[1], 0];
	let k = 0;
	let dir: Dir | null = null;
	let left = Math.max(0, dist);
	while (k < path.length) {
		const q = path[k];
		const dx = q[0] - p[0], dy = q[1] - p[1];
		const d = Math.hypot(dx, dy);
		if (d > 1e-9) dir = facingOf(dx, dy);
		if (d <= left) {
			p = [q[0], q[1], 0];
			left -= d;
			k++;
			continue;
		}
		if (left > 0) p = [p[0] + (dx / d) * left, p[1] + (dy / d) * left, 0];
		break;
	}
	const rest = path.slice(k);
	return { pos: p, path: rest, dir: dist > 0 ? dir : null, arrived: rest.length === 0 };
}
