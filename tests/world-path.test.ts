/**
 * Checks for pathfinding over the world grid: routes keep a comrade's footprint off every
 * prop, never squeeze diagonally past a blocked tile, and report unreachable goals as null.
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTOR_RADIUS } from '../src/art/scene';
import type { V3 } from '../src/art/sdf';
import { clearOf, findPath, isWalkable, simplify, tileCentre } from '../src/world/path';
import type { World } from '../src/world/types';
import { buildWorld } from '../src/world/zones';

const world = buildWorld();
const L = world.tile;

/**
 * Points every unit along a path.
 *
 * @param {V3[]} path Waypoints.
 * @returns {V3[]} Samples, including every waypoint.
 */
function samples(path: V3[]): V3[] {
	const out: V3[] = [path[0]];
	for (let k = 1; k < path.length; k++) {
		const a = path[k - 1], b = path[k];
		const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
		for (let i = 1; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 0]);
	}
	return out;
}

/**
 * Assert a path is safe to walk: clear of props at every unit, and every tile it touches
 * (including all four round a corner it passes through) is walkable.
 *
 * @param {World} w World.
 * @param {V3[]} path Waypoints.
 * @param {string} what Label for messages.
 */
function assertWalkable(w: World, path: V3[], what: string): void {
	const eps = 1e-3;
	for (const p of samples(path)) {
		for (const prop of w.scene.props) assert.ok(clearOf(p[0], p[1], prop.foot), `${what}: ${p.map(Math.round).join(',')} overlaps ${prop.id}`);
		for (const [dx, dy] of [[-eps, -eps], [eps, -eps], [-eps, eps], [eps, eps]]) {
			const tx = Math.floor((p[0] + dx) / L), ty = Math.floor((p[1] + dy) / L);
			assert.ok(isWalkable(w, tx, ty), `${what}: ${p.map(Math.round).join(',')} touches unwalkable tile ${tx},${ty}`);
		}
	}
}

/** Every walkable tile centre. */
const centres: V3[] = [];
for (let ty = 0; ty < world.grid.h; ty++) for (let tx = 0; tx < world.grid.w; tx++) if (isWalkable(world, tx, ty)) centres.push(tileCentre(world, tx, ty));

test('paths between stations and spots keep clear of props and never cut corners', () => {
	const pts = Object.values(world.zones).flatMap((z) => [...z.stations, ...z.spots]);
	let n = 0;
	for (let i = 0; i < pts.length; i += 3) for (let j = 1; j < pts.length; j += 7) {
		const path = findPath(world, pts[i], pts[j]);
		assert.ok(path, `no path from ${pts[i].map(Math.round)} to ${pts[j].map(Math.round)}`);
		assertWalkable(world, path, `path ${i}→${j}`);
		n++;
	}
	assert.ok(n > 100);
});

test('paths between tile centres across the whole plant are walkable', () => {
	// A deterministic spread of pairs; any that are unreachable must be null, not a bad route.
	let found = 0;
	for (let k = 0; k < 300; k++) {
		const a = centres[(k * 7919) % centres.length], b = centres[(k * 104729 + 17) % centres.length];
		const path = findPath(world, a, b);
		if (!path) continue;
		found++;
		assertWalkable(world, path, `pair ${k}`);
	}
	assert.ok(found > 280, `only ${found} of 300 pairs connected`);
});

test('a partition with no door is walked round, not through', () => {
	// Either side of the Hygiene office's window onto the Palace: adjacent tiles, no doorway.
	const a = tileCentre(world, 6, 9), b = tileCentre(world, 7, 9);
	assert.ok(isWalkable(world, 6, 9) && isWalkable(world, 7, 9));
	const path = findPath(world, a, b)!;
	assert.ok(path.length > 2, 'walked straight through the window');
	let len = 0;
	for (let k = 1; k < path.length; k++) len += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
	assert.ok(len > 4 * L, `detour of only ${(len / L).toFixed(1)} tiles`);
	assertWalkable(world, path, 'round the window');
});

test('no three consecutive waypoints are collinear', () => {
	for (let k = 0; k < 60; k++) {
		const path = findPath(world, centres[(k * 31) % centres.length], centres[(k * 57 + 5) % centres.length]);
		if (!path) continue;
		assert.deepEqual(simplify(path), path);
		for (let i = 2; i < path.length; i++) {
			const [a, b, c] = [path[i - 2], path[i - 1], path[i]];
			const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
			assert.ok(Math.abs(cross) > 1e-6, `collinear waypoints at ${i - 1}`);
		}
	}
});

test('an unreachable goal gives null', () => {
	// Close the gate to Siberia: the fence then seals it off completely.
	const walkable = new Uint8Array(world.grid.walkable);
	walkable[4 * world.grid.w + 24] = 0;
	const sealed: World = { ...world, grid: { ...world.grid, walkable } };
	assert.equal(findPath(sealed, world.spawn, world.zones.siberia.spots[0]), null);
	assert.ok(findPath(world, world.spawn, world.zones.siberia.spots[0]));
	// And a world with nowhere to stand at all.
	const none: World = { ...world, grid: { ...world.grid, walkable: new Uint8Array(world.grid.walkable.length) } };
	assert.equal(findPath(none, world.spawn, world.spawn), null);
});

test('start equal to end is a one-point path', () => {
	const p = world.zones.production.stations[0];
	assert.deepEqual(findPath(world, p, p), [[p[0], p[1], 0]]);
	assert.deepEqual(findPath(world, world.spawn, world.spawn), [world.spawn]);
});

test('ends inside furniture or off the floor snap to the nearest walkable tile', () => {
	const anvil = world.scene.props.find((p) => p.id === 'anvil')!.foot;
	const inside: V3 = [(anvil.x0 + anvil.x1) / 2, (anvil.y0 + anvil.y1) / 2, 0];
	const path = findPath(world, world.spawn, inside)!;
	assert.ok(path);
	const end = path[path.length - 1];
	assert.notDeepEqual(end, inside);
	assert.ok(Math.hypot(end[0] - inside[0], end[1] - inside[1]) < 1.5 * L, 'snapped too far from the anvil');
	assertWalkable(world, path, 'to the anvil');
	const off: V3 = [-50, -50, 0];
	const fromOff = findPath(world, off, world.spawn)!;
	// Off the floor, the route starts at the centre of the nearest walkable tile, not the point itself.
	const [sx, sy] = [Math.floor(fromOff[0][0] / L), Math.floor(fromOff[0][1] / L)];
	assert.ok(isWalkable(world, sx, sy));
	assert.deepEqual(fromOff[0], tileCentre(world, sx, sy));
	assertWalkable(world, fromOff, 'from off the floor');
});

test('walkable tiles leave a full comrade radius clear of every prop', () => {
	for (const c of centres) for (const p of world.scene.props) assert.ok(clearOf(c[0], c[1], p.foot), `tile centre ${c.map(Math.round)} is within ${ACTOR_RADIUS} of ${p.id}`);
});
