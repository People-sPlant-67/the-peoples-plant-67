/**
 * Checks for the whole-plant world: every zone is signed in letters the font can draw, every
 * station and idle spot is somewhere a comrade can stand without overlapping furniture, and
 * all of them can be walked to from the railway platform. Run with: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIGNAGE } from '../src/art/env';
import { missingGlyphs } from '../src/art/font';
import { project } from '../src/art/render';
import type { V3 } from '../src/art/sdf';
import { clearOf, findPath, isWalkable, segmentClear, tileOf } from '../src/world/path';
import type { ZoneId } from '../src/world/types';
import { RADIO, WORLD_H, WORLD_W, buildWorld, fixturePatches, radioLit, zoneAt } from '../src/world/zones';
import { fixtureAt } from '../src/cockpit/fixtures';

const t0 = Date.now();
const world = buildWorld();
const buildMs = Date.now() - t0;
const zones = Object.values(world.zones);
const feet = world.scene.props.map((p) => p.foot);

/**
 * Every station and spot, labelled for messages.
 *
 * @returns {[string, V3, ZoneId][]} Label, position, zone.
 */
function places(): [string, V3, ZoneId][] {
	return zones.flatMap((z) => [
		...z.stations.map((p, k): [string, V3, ZoneId] => [`${z.id} station ${k}`, p, z.id]),
		...z.spots.map((p, k): [string, V3, ZoneId] => [`${z.id} spot ${k}`, p, z.id]),
	]);
}

test('all ten zones exist, with a label, and their tiles do not overlap', () => {
	const ids: ZoneId[] = ['recruitment', 'directorate', 'planRoom', 'inspectorate', 'production', 'repair', 'hygiene', 'canteen', 'palace', 'siberia'];
	assert.deepEqual(Object.keys(world.zones).sort(), [...ids].sort());
	for (const z of zones) {
		assert.ok(z.label.length > 0, `${z.id} has no label`);
		assert.equal(world.zones[z.id].id, z.id);
	}
	assert.equal(world.grid.w, WORLD_W);
	assert.equal(world.grid.h, WORLD_H);
	assert.equal(world.grid.walkable.length, WORLD_W * WORLD_H);
	for (let ty = 0; ty < WORLD_H; ty++) for (let tx = 0; tx < WORLD_W; tx++) {
		const owners = zones.filter((z) => tx >= z.tiles.x0 && tx < z.tiles.x1 && ty >= z.tiles.y0 && ty < z.tiles.y1);
		assert.ok(owners.length <= 1, `tile ${tx},${ty} belongs to ${owners.map((z) => z.id).join(' and ')}`);
		// Only floor can be walked on.
		if (!owners.length) assert.equal(isWalkable(world, tx, ty), false, `void tile ${tx},${ty} is walkable`);
	}
});

test('every zone has a sign the font can draw, listed in SIGNAGE', () => {
	for (const z of zones) {
		assert.ok(z.sign.trim().length > 0, `${z.id} has no sign`);
		assert.deepEqual(missingGlyphs(z.sign), [], `${z.id} sign "${z.sign}" has characters the font lacks`);
		assert.ok(SIGNAGE.includes(z.sign), `${z.id} sign "${z.sign}" is missing from SIGNAGE`);
	}
});

test('each zone has the stations and spots its residents need, each station with a facing', () => {
	const want: Partial<Record<ZoneId, number>> = { directorate: 1, planRoom: 2, inspectorate: 1, production: 4, repair: 1, hygiene: 1 };
	for (const [id, n] of Object.entries(want)) assert.equal(world.zones[id as ZoneId].stations.length, n, `${id} stations`);
	for (const z of zones) assert.equal(z.stationFacing.length, z.stations.length, `${z.id} facings`);
	const spots: Partial<Record<ZoneId, number>> = { canteen: 10, siberia: 10, palace: 6, recruitment: 3 };
	for (const [id, n] of Object.entries(spots)) assert.ok(world.zones[id as ZoneId].spots.length >= n, `${id} has ${world.zones[id as ZoneId].spots.length} spots, needs ${n}`);
});

test('stations and spots sit inside their zone, on walkable tiles, clear of every prop', () => {
	for (const [label, p, id] of places()) {
		const [tx, ty] = tileOf(world, p);
		assert.equal(zoneAt(tx, ty), id, `${label} is outside its zone`);
		assert.ok(isWalkable(world, tx, ty), `${label} is on unwalkable tile ${tx},${ty}`);
		for (const prop of world.scene.props) assert.ok(clearOf(p[0], p[1], prop.foot), `${label} at ${p.map(Math.round).join(',')} overlaps ${prop.id}`);
	}
});

test('the spawn point is walkable, on the platform', () => {
	const [tx, ty] = tileOf(world, world.spawn);
	assert.equal(zoneAt(tx, ty), 'recruitment');
	assert.ok(isWalkable(world, tx, ty));
	assert.ok(feet.every((f) => clearOf(world.spawn[0], world.spawn[1], f)));
});

test('every station and spot can be walked to from the platform', () => {
	for (const [label, p] of places()) {
		const path = findPath(world, world.spawn, p);
		assert.ok(path, `${label} is unreachable from the platform`);
		assert.deepEqual(path[0], world.spawn, `${label}: path does not start at the spawn`);
		assert.deepEqual(path[path.length - 1], [p[0], p[1], 0], `${label}: path does not end on the spot`);
	}
});

test('Siberia is the east-most zone, and a long walk from the platform', () => {
	const sib = world.zones.siberia;
	// East in both senses: along +x, and to the right of everything on screen (x - y).
	const screenX = (x: number, y: number): number => project(world.scene.base, [x * world.tile, y * world.tile, 0])[0];
	const centre = (t: { x0: number; y0: number; x1: number; y1: number }): number => screenX((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2);
	for (const z of zones) {
		if (z.id === 'siberia') continue;
		assert.ok(sib.tiles.x0 >= z.tiles.x1, `${z.id} reaches further east than Siberia`);
		assert.ok(centre(sib.tiles) > centre(z.tiles), `${z.id} is further right on screen than Siberia`);
	}
	const path = findPath(world, world.spawn, sib.spots[0])!;
	let len = 0;
	for (let k = 1; k < path.length; k++) len += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
	assert.ok(len > 25 * world.tile, `Siberia is only ${(len / world.tile).toFixed(1)} tiles' walk away`);
});

test('the demo patrol never walks a comrade through a prop', () => {
	const loop = world.scene.patrol;
	assert.ok(loop.length > 4);
	for (let k = 0; k < loop.length; k++) assert.ok(segmentClear(loop[k], loop[(k + 1) % loop.length], feet), `patrol leg ${k} crosses a prop`);
});

test('every prop has a non-empty sprite inside the base layer, with a unique id', () => {
	const { base, props } = world.scene;
	assert.equal(new Set(props.map((p) => p.id)).size, props.length);
	for (const p of props) {
		let opaque = 0;
		for (let k = 3; k < p.sprite.rgba.length; k += 4) if (p.sprite.rgba[k]) opaque++;
		assert.ok(opaque > 40, `${p.id} is nearly empty`);
		assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.sprite.w <= base.w && p.y + p.sprite.h <= base.h, `${p.id} spills off the base`);
	}
	for (const id of ['anvil', 'workbench', 'crates', 'coal', 'column', 'hut', 'signpost']) assert.ok(props.some((p) => p.id === id), `missing ${id}`);
});

test('the radiogram stands in the Company Lead\'s office; switched on, only its dial changes; clicks land on its pixels only', () => {
	const p = world.scene.props.find((q) => q.id === 'dir-radio');
	assert.ok(p, 'the radiogram is a prop');
	assert.equal(zoneAt(Math.floor(RADIO[0] / world.tile), Math.floor(RADIO[1] / world.tile)), 'directorate');
	const lit = radioLit(p.sprite);
	const body = p.sprite.groups.indexOf('radio');
	let changed = 0;
	for (let i = 0; i < p.sprite.w * p.sprite.h; i++) {
		if (lit.slice(i * 4, i * 4 + 4).join() === p.sprite.rgba.slice(i * 4, i * 4 + 4).join()) continue;
		changed++;
		assert.equal(p.sprite.group[i], body, 'only the cabinet front (the dial) changes');
	}
	assert.ok(changed >= 6 && changed <= 60, `a small glowing dial, not the whole set (${changed} pixels)`);
	const [cx, cy] = project(world.scene.base, [RADIO[0], RADIO[1], 20]);
	const fixtures = fixturePatches(world.scene);
	assert.equal(fixtureAt(fixtures, { x: cx, y: cy }), 'radiogram', 'the middle of the cabinet is clickable');
	assert.equal(fixtureAt(fixtures, { x: p.x - 10, y: p.y - 10 }), null, 'well outside it is not');
});

test('the world renders within budget', () => {
	const px = world.scene.base.w * world.scene.base.h;
	assert.ok(px < 2.2e6, `${(px / 1e6).toFixed(2)}M pixels`);
	// Generous: this is a guard against an accidental 10× regression, not a benchmark.
	assert.ok(buildMs < 15000, `buildWorld took ${buildMs}ms`);
});
