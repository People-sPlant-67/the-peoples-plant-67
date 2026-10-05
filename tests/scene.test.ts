/**
 * Checks for layered scenes: props render, depth sorting puts agents behind and in front
 * of furniture correctly, and flattening the layers still looks like the old single image.
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plantCorner, siberia } from '../src/art/env';
import { SPRITE, renderAvatar } from '../src/art/avatar';
import { ALEXEI } from '../src/art/outfits';
import { ACTOR_RADIUS, type Footprint, behind, drawOrder, feetOnScreen } from '../src/art/scene';
import { dot } from '../src/art/sdf';
import type { V3 } from '../src/art/sdf';

const plant = plantCorner();
const sib = siberia();

/**
 * Index of an item in a draw order.
 *
 * @param {ReturnType<typeof drawOrder>} order Draw order.
 * @param {string} id Item id.
 * @returns {number} Position, or -1.
 */
const at = (order: ReturnType<typeof drawOrder>, id: string): number => order.findIndex((d) => d.id === id);

test('every prop has a non-empty sprite inside the base layer', () => {
	for (const sc of [plant, sib]) {
		assert.ok(sc.props.length > 0);
		for (const p of sc.props) {
			let opaque = 0;
			for (let k = 3; k < p.sprite.rgba.length; k += 4) if (p.sprite.rgba[k]) opaque++;
			assert.ok(opaque > 100, `${p.id} is nearly empty`);
			assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.sprite.w <= sc.base.w && p.y + p.sprite.h <= sc.base.h, `${p.id} spills off the base`);
			assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y), `${p.id} sits between pixels`);
		}
	}
	assert.deepEqual(plant.props.map((p) => p.id).sort(), ['anvil', 'coal', 'column', 'crates', 'workbench']);
	assert.deepEqual(sib.props.map((p) => p.id).sort(), ['hut', 'pine0', 'pine1', 'pine2', 'pine3', 'pine4', 'signpost']);
});

test('an agent behind the workbench draws before it, and after it when in front', () => {
	const cases: [V3, 'before' | 'after'][] = [
		[[10, 38, 0], 'before'], // tucked behind the bench's far end
		[[40, 70, 0], 'after'], // beside it, on the open-floor side
		[[34, 112, 0], 'after'], // past its near end
	];
	for (const [pos, want] of cases) {
		const order = drawOrder(plant.props, [{ id: 'v', pos }]);
		const got = at(order, 'v') < at(order, 'workbench') ? 'before' : 'after';
		assert.equal(got, want, `agent at ${pos.join(',')} should draw ${want} the workbench`);
	}
});

test('an agent behind the crates draws before them; the column goes behind an agent in front of it', () => {
	const order = drawOrder(plant.props, [{ id: 'a', pos: [256, 18, 0] }, { id: 'b', pos: [180, 22, 0] }]);
	assert.ok(at(order, 'a') < at(order, 'crates'));
	assert.ok(at(order, 'column') < at(order, 'b'));
});

test('a working agent draws over the prop it works at', () => {
	const plain = drawOrder(plant.props, [{ id: 'v', pos: plant.actor }]);
	assert.ok(at(plain, 'v') < at(plain, 'anvil'), 'by footprint alone the anvil is in front');
	const working = drawOrder(plant.props, [{ id: 'v', pos: plant.actor, over: plant.workProps }]);
	assert.ok(at(working, 'v') > at(working, 'anvil'));
});

test('draw order is complete and stable with a crowd', () => {
	const crowd = Array.from({ length: 60 }, (_, k) => ({ id: `c${k}`, pos: [20 + (k * 37) % 330, 20 + (k * 53) % 200, 0] as V3 }));
	const order = drawOrder(plant.props, crowd);
	assert.equal(order.length, plant.props.length + crowd.length);
	assert.equal(new Set(order.map((d) => d.id)).size, order.length);
	assert.deepEqual(drawOrder(plant.props, crowd).map((d) => d.id), order.map((d) => d.id));
	// Every pair with a decisive footprint test must come out in that order.
	const foot = (id: string): Footprint => {
		const d = order.find((o) => o.id === id)!;
		if (d.kind === 'prop') return d.prop.foot;
		const [x, y, z] = d.actor.pos;
		const r = d.actor.radius ?? ACTOR_RADIUS;
		return { x0: x - r, y0: y - r, x1: x + r, y1: y + r, z0: z };
	};
	for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
		assert.ok(behind(foot(order[i].id), foot(order[j].id)) <= 0 || !isSeparated(foot(order[i].id), foot(order[j].id)), `${order[i].id} drawn before ${order[j].id} but is in front`);
	}
});

/**
 * Whether two footprints are separated on some floor axis (so their order is decided, not a tie-break).
 *
 * @param {Footprint} a First footprint.
 * @param {Footprint} b Second footprint.
 * @returns {boolean} Separated.
 */
function isSeparated(a: Footprint, b: Footprint): boolean {
	return a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
}

test('base plus props flattened matches the old single-pass render', () => {
	// Only outline pixels where a prop meets the floor or wall may differ: a prop now gets its
	// own outer outline there instead of the old inner one. Measured at 0.7% (plant) and 0.9% (Siberia).
	for (const [sc, old] of [[plant, plantCorner({ flat: true })], [sib, siberia({ flat: true })]]) {
		assert.equal(sc.frame.w, old.frame.w);
		assert.equal(sc.frame.h, old.frame.h);
		let diff = 0, opaque = 0;
		for (let k = 0; k < old.frame.w * old.frame.h; k++) {
			if (old.frame.rgba[k * 4 + 3]) opaque++;
			for (let c = 0; c < 4; c++) if (Math.abs(sc.frame.rgba[k * 4 + c] - old.frame.rgba[k * 4 + c]) > 8) { diff++; break; }
		}
		assert.ok(diff / opaque < 0.015, `${((100 * diff) / opaque).toFixed(2)}% of pixels changed`);
	}
});

test('an agent just past the end of the long workbench draws in front of it', () => {
	// Their footprints overlap a little on x and a lot on y; they meet on the x side.
	for (const pos of [[30, 53, 0], [28, 50, 0], [26, 47, 0]] as V3[]) {
		const order = drawOrder(plant.props, [{ id: 'v', pos }]);
		assert.ok(at(order, 'v') > at(order, 'workbench'), `agent at ${pos.join(',')} should draw after the workbench`);
	}
});

/**
 * Points every `step` world units along a closed patrol loop.
 *
 * @param {V3[]} loop Patrol corners.
 * @param {number} step Spacing.
 * @returns {V3[]} Sample points.
 */
function alongLoop(loop: V3[], step: number): V3[] {
	const out: V3[] = [];
	for (let k = 0; k < loop.length; k++) {
		const a = loop[k], b = loop[(k + 1) % loop.length];
		const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
		for (let i = 0; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 0]);
	}
	return out;
}

test('the demo patrols never walk a comrade through a prop', () => {
	for (const [name, sc] of [['plant', plant], ['siberia', sib]] as const) {
		for (const p of alongLoop(sc.patrol, 1)) {
			for (const prop of sc.props) {
				const f = prop.foot;
				const clear = p[0] + ACTOR_RADIUS <= f.x0 || p[0] - ACTOR_RADIUS >= f.x1 || p[1] + ACTOR_RADIUS <= f.y0 || p[1] - ACTOR_RADIUS >= f.y1;
				assert.ok(clear, `${name} patrol at ${p.map(Math.round).join(',')} walks through ${prop.id}`);
			}
		}
	}
});

test('along the patrols, draw order agrees with true pixel depth', () => {
	// Render the comrade at points along each loop and, wherever his pixels overlap a prop's,
	// check that whichever is really nearer the camera is also the one drawn later.
	for (const [name, sc] of [['plant', plant], ['siberia', sib]] as const) {
		let overlap = 0, wrong = 0;
		for (const pos of alongLoop(sc.patrol, 8)) {
			const spr = renderAvatar(ALEXEI, 'idle', 'S', 0);
			const [fx, fy] = feetOnScreen(sc, pos);
			const ox = fx - SPRITE.ax, oy = fy - SPRITE.ay;
			// Sprite depth is measured from the feet; shift it into world depth.
			const shift = dot(pos, sc.base.view.F);
			const order = drawOrder(sc.props, [{ id: 'v', pos }]);
			for (const prop of sc.props) {
				const ps = prop.sprite;
				const actorLater = at(order, 'v') > at(order, prop.id);
				for (let j = 0; j < spr.h; j++) for (let i = 0; i < spr.w; i++) {
					if (spr.group[j * spr.w + i] < 0) continue;
					const px = ox + i - prop.x, py = oy + j - prop.y;
					if (px < 0 || py < 0 || px >= ps.w || py >= ps.h || ps.group[py * ps.w + px] < 0) continue;
					overlap++;
					const actorNearer = spr.depth[j * spr.w + i] + shift < ps.depth[py * ps.w + px];
					if (actorNearer !== actorLater) wrong++;
				}
			}
		}
		assert.ok(overlap > 50, `${name}: the patrol should pass behind or in front of props to be a useful check`);
		assert.ok(wrong / overlap < 0.01, `${name}: ${wrong} of ${overlap} overlapping pixels drawn in the wrong order`);
	}
});
