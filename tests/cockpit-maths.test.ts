/**
 * The cockpit's pure maths, no world needed: walking along a path, the camera clamp and zoom,
 * the edge-scroll guard, minimap coordinates, picking a comrade under the pointer, and the
 * words shown for each status. Run with: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TILE } from '../src/art/render';
import type { V3 } from '../src/art/sdf';
import { EDGE_DWELL_MS, EDGE_PX, MAX_ZOOM, clampCamera, centredOn, edgeScroll, viewToWorld, zoomAbout, type EdgeInput } from '../src/cockpit/camera';
import { fromMini, miniFit, toMini, viewportOnMini } from '../src/cockpit/minimap';
import { pickAt, pickBox } from '../src/cockpit/pick';
import { statusColour, statusWords } from '../src/cockpit/status';
import { WALK_SPEED, facingOf, stepAlong } from '../src/cockpit/walk';

test('walking pace is one tile every 0.75s', () => {
	assert.ok(Math.abs(WALK_SPEED * 750 - TILE) < 1e-9);
});

test('facing follows the model yaws: +x is SE, +y is SW, -x is NW, -y is NE', () => {
	assert.equal(facingOf(1, 0), 'SE');
	assert.equal(facingOf(0, 1), 'SW');
	assert.equal(facingOf(-1, 0), 'NW');
	assert.equal(facingOf(0, -1), 'NE');
	assert.equal(facingOf(1, 1), 'S');
	assert.equal(facingOf(-1, -1), 'N');
	assert.equal(facingOf(1, -1), 'E');
	assert.equal(facingOf(-1, 1), 'W');
});

test('stepAlong moves the exact distance, carries leftovers past a waypoint, and arrives', () => {
	const path: V3[] = [[10, 0, 0], [10, 10, 0]];
	let s = stepAlong([0, 0, 0], path, 4);
	assert.deepEqual(s.pos, [4, 0, 0]);
	assert.equal(s.path.length, 2);
	assert.equal(s.dir, 'SE');
	assert.equal(s.arrived, false);
	// 6 to the corner, then 3 more along the second leg: the pace does not depend on frame size.
	s = stepAlong(s.pos, s.path, 9);
	assert.deepEqual(s.pos, [10, 3, 0]);
	assert.equal(s.path.length, 1);
	assert.equal(s.dir, 'SW');
	s = stepAlong(s.pos, s.path, 100);
	assert.deepEqual(s.pos, [10, 10, 0]);
	assert.equal(s.arrived, true);
	assert.deepEqual(s.path, []);
	// The input path is never modified.
	assert.equal(path.length, 2);
});

test('stepAlong with no distance stays put and reports no facing', () => {
	const s = stepAlong([1, 1, 0], [[5, 1, 0]], 0);
	assert.deepEqual(s.pos, [1, 1, 0]);
	assert.equal(s.dir, null);
	assert.equal(s.arrived, false);
});

test('many small steps land where one big step does', () => {
	const path: V3[] = [[30, 0, 0], [30, 40, 0], [0, 40, 0]];
	let pos: V3 = [0, 0, 0], rest = path;
	for (let k = 0; k < 50; k++) { const s = stepAlong(pos, rest, 1.7); pos = s.pos; rest = s.path; }
	const once = stepAlong([0, 0, 0], path, 85);
	assert.ok(Math.hypot(pos[0] - once.pos[0], pos[1] - once.pos[1]) < 1e-9);
});

const WORLD = { w: 1600, h: 860 };
const VIEW = { w: 1000, h: 600 };

test('camera clamp: stays inside the world and centres a world smaller than the view', () => {
	assert.deepEqual(clampCamera({ x: -50, y: -50, zoom: 2 }, VIEW, WORLD), { x: 0, y: 0, zoom: 2 });
	assert.deepEqual(clampCamera({ x: 5000, y: 5000, zoom: 2 }, VIEW, WORLD), { x: 1600 - 500, y: 860 - 300, zoom: 2 });
	// At 1x the view still fits inside the world on both axes, so it is clamped, not centred.
	assert.deepEqual(clampCamera({ x: 9999, y: 0, zoom: 1 }, VIEW, WORLD), { x: 600, y: 0, zoom: 1 });
	// A view bigger than the world centres it (negative offset = margin on both sides).
	const big = clampCamera({ x: 300, y: 300, zoom: 1 }, { w: 2000, h: 1000 }, WORLD);
	assert.deepEqual(big, { x: -200, y: -70, zoom: 1 });
});

test('camera zoom is a whole number from 1 to 3', () => {
	assert.equal(clampCamera({ x: 0, y: 0, zoom: 7 }, VIEW, WORLD).zoom, MAX_ZOOM);
	assert.equal(clampCamera({ x: 0, y: 0, zoom: 0 }, VIEW, WORLD).zoom, 1);
	assert.equal(clampCamera({ x: 0, y: 0, zoom: 2.4 }, VIEW, WORLD).zoom, 2);
	assert.equal(zoomAbout({ x: 0, y: 0, zoom: 3 }, 4, { x: 0, y: 0 }, VIEW, WORLD).zoom, 3);
	assert.equal(zoomAbout({ x: 0, y: 0, zoom: 1 }, 0, { x: 0, y: 0 }, VIEW, WORLD).zoom, 1);
});

test('zooming about a point keeps that world point under the pointer', () => {
	const cam = { x: 400, y: 200, zoom: 2 };
	const at = { x: 300, y: 250 };
	const before = viewToWorld(cam, at);
	const after = zoomAbout(cam, 3, at, VIEW, WORLD);
	const moved = viewToWorld(after, at);
	assert.ok(Math.abs(moved.x - before.x) < 1e-9 && Math.abs(moved.y - before.y) < 1e-9);
});

test('centredOn puts a point in the middle, unless the clamp forbids it', () => {
	const c = centredOn({ x: 0, y: 0, zoom: 2 }, { x: 800, y: 430 }, VIEW, WORLD);
	assert.deepEqual(viewToWorld(c, { x: 500, y: 300 }), { x: 800, y: 430 });
	assert.deepEqual(centredOn({ x: 0, y: 0, zoom: 2 }, { x: 0, y: 0 }, VIEW, WORLD), { x: 0, y: 0, zoom: 2 });
});

/**
 * Edge-scroll input with sensible defaults.
 *
 * @param over Fields to change.
 * @returns Input.
 */
const edge = (over: Partial<EdgeInput>): EdgeInput => ({ enabled: true, blocked: false, pointer: { x: 5, y: 300 }, view: VIEW, now: 1000, ...over });

test('edge scroll: only after the pointer rests in the band for the dwell time', () => {
	let r = edgeScroll(null, edge({ now: 1000 }));
	assert.deepEqual(r, { since: 1000, dir: [0, 0] });
	r = edgeScroll(r.since, edge({ now: 1000 + EDGE_DWELL_MS - 1 }));
	assert.deepEqual(r.dir, [0, 0]);
	r = edgeScroll(r.since, edge({ now: 1000 + EDGE_DWELL_MS }));
	assert.deepEqual(r.dir, [-1, 0]);
});

test('edge scroll: never when the setting is off, something is open, or the pointer is away', () => {
	for (const over of [{ enabled: false }, { blocked: true }, { pointer: null }] as Partial<EdgeInput>[]) {
		const r = edgeScroll(0, edge({ ...over, now: 99_999 }));
		assert.deepEqual(r, { since: null, dir: [0, 0] }, JSON.stringify(over));
	}
});

test('edge scroll: the band is EDGE_PX wide on every side, and leaving it restarts the dwell', () => {
	const late = 10_000;
	assert.deepEqual(edgeScroll(0, edge({ pointer: { x: EDGE_PX - 1, y: 300 }, now: late })).dir, [-1, 0]);
	assert.deepEqual(edgeScroll(0, edge({ pointer: { x: EDGE_PX, y: 300 }, now: late })), { since: null, dir: [0, 0] });
	assert.deepEqual(edgeScroll(0, edge({ pointer: { x: VIEW.w - EDGE_PX, y: 300 }, now: late })).dir, [1, 0]);
	assert.deepEqual(edgeScroll(0, edge({ pointer: { x: 500, y: 2 }, now: late })).dir, [0, -1]);
	assert.deepEqual(edgeScroll(0, edge({ pointer: { x: VIEW.w - 1, y: VIEW.h - 1 }, now: late })).dir, [1, 1]);
	// Out of the band for one frame, then back: the clock starts again.
	const out = edgeScroll(0, edge({ pointer: { x: 500, y: 300 }, now: late }));
	const back = edgeScroll(out.since, edge({ now: late + 10 }));
	assert.deepEqual(back, { since: late + 10, dir: [0, 0] });
	// Opening a card also restarts it.
	const blocked = edgeScroll(0, edge({ blocked: true, now: late }));
	assert.equal(edgeScroll(blocked.since, edge({ now: late + 10 })).dir[0], 0);
});

test('minimap fit keeps the shape and round-trips points', () => {
	const m = miniFit(WORLD, { w: 200, h: 200 });
	assert.equal(m.w, 200);
	assert.equal(m.h, Math.round(860 * (200 / 1600)));
	const p = { x: 731, y: 402 };
	const back = fromMini(m, toMini(m, p));
	assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
	// Off-map clicks are pulled onto the map's edge.
	assert.deepEqual(fromMini(m, { x: -20, y: 9999 }), { x: 0, y: m.h / m.scale });
});

test('minimap viewport rectangle matches what the camera sees', () => {
	const m = miniFit(WORLD, { w: 160, h: 400 });
	const v = viewportOnMini(m, { x: 100, y: 50, zoom: 2 }, VIEW);
	assert.deepEqual(v, { x: 10, y: 5, w: 50, h: 30 });
});

test('pick finds the front-most comrade under the pointer, or nobody', () => {
	const back = pickBox('back', 100, 100, 60);
	const front = pickBox('front', 105, 110, 60);
	assert.equal(pickAt([back, front], { x: 104, y: 90 }), 'front');
	assert.equal(pickAt([front, back], { x: 104, y: 90 }), 'back');
	assert.equal(pickAt([back, front], { x: 100, y: 45 }), 'back');
	assert.equal(pickAt([back, front], { x: 300, y: 300 }), null);
});

test('every status reads as a full sentence, and unknown ones are quoted as they came', () => {
	for (const s of ['running', 'idle', 'paused', 'error', 'pending_approval', 'waiting', 'terminated', 'hibernating']) {
		assert.match(statusWords(s), /^[A-Z].+\.$/, s);
		assert.match(statusColour(s), /^#[0-9a-f]{6}$/);
	}
	assert.match(statusWords('hibernating'), /"hibernating"/);
	assert.notEqual(statusColour('hibernating'), statusColour('idle'));
});
