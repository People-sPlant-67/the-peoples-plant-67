/**
 * The menus in the scenery: each fixture's pixels are exactly what the plant painted,
 * the noticeboard's counts change only the board, the pointer finds the right fixture (its own
 * pixels first, then the nearest padded box), the hover outline rings the drawing without
 * covering it, and the wobble and the ring keep their timing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXTURE_ORDER, FIXTURE_PAD, RING_BURST_MS, RING_GAP_MS, RING_HOP_MS, WOBBLE, WOBBLE_STEP_MS, fixtureAt, glow, outline, painted, ringAt, ringMarks, wobbleAt } from '../src/cockpit/fixtures';
import { type Patch, buildWorld, fixturePatches, lampPatch, noticeboardPatch } from '../src/world/zones';

const world = buildWorld();
const patches = fixturePatches(world.scene);

/**
 * Every painted pixel of a patch, as base-layer points.
 *
 * @param p Patch.
 * @returns Points.
 */
const pixels = (p: Patch): [number, number][] => {
	const out: [number, number][] = [];
	for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) if (p.rgba[(j * p.w + i) * 4 + 3]) out.push([p.x + i, p.y + j]);
	return out;
};

test('each fixture is something on screen, and the wall ones are exactly the pixels the wall shows', () => {
	for (const id of FIXTURE_ORDER) assert.ok(pixels(patches[id]).length > 20, `${id} has pixels`);
	const { base } = world.scene;
	for (const id of ['noticeboard', 'plaque'] as const) {
		const p = patches[id];
		let differ = 0;
		for (const [x, y] of pixels(p)) {
			const k = ((y - p.y) * p.w + (x - p.x)) * 4, b = (y * base.w + x) * 4;
			if (p.rgba[k] !== base.rgba[b] || p.rgba[k + 1] !== base.rgba[b + 1] || p.rgba[k + 2] !== base.rgba[b + 2]) differ++;
		}
		assert.equal(differ, 0, `${id} lines up with the wall, pixel for pixel`);
	}
	// The desk things are the desk's own pixels, in the desk's place.
	const desk = world.scene.props.find((q) => q.id === 'dir-desk')!;
	for (const [x, y] of pixels(patches.telephone)) assert.equal(desk.sprite.groups[desk.sprite.group[(y - desk.y) * desk.sprite.w + (x - desk.x)]], 'phone');
});

test('the counts change only the board: same place, and only inside its slips', () => {
	const blank = patches.noticeboard;
	const counted = noticeboardPatch(world.scene.base, [3, 12, 1]);
	assert.deepEqual([counted.x, counted.y, counted.w, counted.h], [blank.x, blank.y, blank.w, blank.h]);
	let changed = 0;
	for (let k = 0; k < blank.rgba.length; k += 4) {
		if (blank.rgba[k + 3] !== counted.rgba[k + 3]) assert.fail('the board\'s outline moved');
		if (blank.rgba[k] !== counted.rgba[k]) changed++;
	}
	assert.ok(changed > 10, 'the numbers are drawn');
	const many = noticeboardPatch(world.scene.base, [100, 0, 0]);
	assert.deepEqual([many.w, many.h], [blank.w, blank.h], 'a count past 99 still fits its slip');
});

test('the pointer finds a fixture by its own pixels first, then by the nearest padded box', () => {
	for (const id of FIXTURE_ORDER) {
		const [x, y] = pixels(patches[id])[Math.floor(pixels(patches[id]).length / 2)];
		assert.equal(fixtureAt(patches, { x, y }), id, `on ${id}`);
	}
	const t = patches.telephone;
	assert.equal(fixtureAt(patches, { x: t.x - FIXTURE_PAD + 0.5, y: t.y + t.h / 2 }), 'telephone', 'just beside the small telephone still counts');
	assert.equal(fixtureAt(patches, { x: t.x - FIXTURE_PAD - 1, y: t.y - FIXTURE_PAD - 1 }), null);
	assert.equal(fixtureAt(patches, { x: 5, y: 5 }), null, 'nothing out in the wasteland');
	assert.ok(!painted(t, t.x - 1, t.y), 'outside a patch is never painted');
});

test('the outline rings the drawing, one pixel out, and never covers it', () => {
	const dot: Patch = { x: 10, y: 20, w: 1, h: 1, rgba: new Uint8ClampedArray([1, 2, 3, 255]) };
	const o = outline(dot);
	assert.deepEqual([o.x, o.y, o.w, o.h], [9, 19, 3, 3]);
	assert.deepEqual(pixels(o).sort(), [[9, 20], [10, 19], [10, 21], [11, 20]].sort(), 'a dot gets four neighbours, no corners');
	for (const id of FIXTURE_ORDER) {
		const ring = outline(patches[id]);
		for (const [x, y] of pixels(ring)) assert.ok(!painted(patches[id], x, y), `${id}'s outline stays off the drawing`);
	}
});

test('the wobble is a pixel each way and over in a moment; the ring comes in bursts with marks', () => {
	assert.deepEqual(WOBBLE.map((_, k) => wobbleAt(k * WOBBLE_STEP_MS)), [...WOBBLE]);
	assert.equal(wobbleAt(WOBBLE.length * WOBBLE_STEP_MS), 0);
	assert.equal(wobbleAt(-1), 0);
	assert.deepEqual(ringAt(0), { hop: 0, marks: true });
	assert.deepEqual(ringAt(RING_HOP_MS), { hop: 1, marks: true });
	assert.deepEqual(ringAt(RING_BURST_MS + 1), { hop: 0, marks: false }, 'quiet between bursts');
	assert.deepEqual(ringAt(RING_BURST_MS + RING_GAP_MS + RING_HOP_MS), { hop: 1, marks: true }, 'and again');
	const m = ringMarks(patches.telephone), g = glow(patches.telephone);
	const cx = patches.telephone.x + patches.telephone.w / 2;
	assert.ok(Math.abs(m.x + m.w / 2 - cx) <= 1 && Math.abs(g.x + g.w / 2 - cx) <= 1, 'marks and glow centre on the telephone');
	const left = pixels(m).filter(([x]) => x < m.x + m.w / 2).length, right = pixels(m).filter(([x]) => x > m.x + m.w / 2).length;
	assert.equal(left, right, 'the marks are the same either side');
});

test('the emergency lamp, lit or not, is the same shape in the same place, above the noticeboard', () => {
	const off = lampPatch(world.scene.base, false), on = lampPatch(world.scene.base, true);
	assert.deepEqual([on.x, on.y, on.w, on.h], [off.x, off.y, off.w, off.h]);
	// The wall slopes, so compare in the lamp's own middle column: the board's top there is below the lamp.
	const b = patches.noticeboard, cx = Math.round(off.x + off.w / 2);
	let top = b.y;
	while (top < b.y + b.h && !painted(b, cx, top)) top++;
	assert.ok(cx > b.x && cx < b.x + b.w, 'over the board');
	assert.ok(off.y + off.h <= top, 'and above it');
	const red = (p: Patch) => { let n = 0; for (let k = 0; k < p.rgba.length; k += 4) n += p.rgba[k]; return n; };
	assert.ok(red(on) > red(off), 'lit is brighter');
});
