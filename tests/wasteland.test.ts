/**
 * The wasteland: each side gets its own ground, the middle is clear and the edges are
 * all haze, the same picture every time, every landmark stands outside the plant and nothing tall
 * stands in front of it; and the backdrop bakes in slices, back to front, and stops when told.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeView, type Frame } from '../src/art/render';
import { HAZE, WASTE_MARGIN, hazeAt, wasteGround, wasteLandmarks, wasteWeights } from '../src/art/wasteland';
import { rgb } from '../src/art/palette';
import { type BackdropReply, type BackdropRequest, PIECE, type Piece, WORKER_SILENCE_MS, backdropPieces, bakeBackdrop, bakeInWorker, cut, startBackdrop } from '../src/cockpit/backdrop';
import { TILE } from '../src/art/render';

/**
 * A stand-in for the plant's base frame: only its size, anchor and view are read.
 *
 * @returns Frame.
 */
const base = (): Frame => ({ w: 400, h: 220, ax: 200, ay: 20, rgba: new Uint8ClampedArray(0), depth: new Float32Array(0), group: new Int16Array(0), groups: [], view: makeView() });

test('each side has its own ground: ruin behind, steppe right, yard left, apron in front; the weights sum to one', () => {
	const kinds = ['ruin', 'steppe', 'yard', 'apron'];
	for (const [dx, dy, want] of [[0, -600, 'ruin'], [900, 0, 'steppe'], [-900, 0, 'yard'], [0, 600, 'apron']] as const) {
		const w = wasteWeights(dx, dy, 3.3, 7.7);
		assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
		assert.equal(kinds[w.indexOf(Math.max(...w))], want, `${dx},${dy}`);
	}
});

test('the middle is clear, the edges are all haze, and the ground is the same every time', () => {
	const half = { w: 200, h: 110 };
	assert.equal(hazeAt(0, 0, half), 0);
	assert.equal(hazeAt(half.w + WASTE_MARGIN.x, 0, half), 1);
	const a = wasteGround(base(), 19.45 * TILE), b = wasteGround(base(), 19.45 * TILE);
	while (!a.next(400));
	while (!b.next(97));
	assert.deepEqual(a.layer.rgba, b.layer.rgba, 'slice size does not change the picture');
	const { layer } = a;
	const px = (x: number, y: number) => Array.from(layer.rgba.subarray((y * layer.w + x) * 4, (y * layer.w + x) * 4 + 3));
	assert.deepEqual(px(0, 0), rgb(HAZE), 'a corner is pure haze, the stage colour beyond');
	assert.notDeepEqual(px(Math.floor(layer.w / 2), Math.floor(layer.h / 2)), rgb(HAZE), 'by the plant it is ground');
	assert.equal(layer.x, -WASTE_MARGIN.x);
});

test('every landmark stands outside the plant and Siberia, and nothing in front is taller than a fallen slab', () => {
	const inPlant = (x: number, y: number) => (x >= 0 && x <= 24 && y >= 0 && y <= 20) || (x >= 24 && x <= 32 && y >= 0 && y <= 10);
	for (const m of wasteLandmarks()) {
		for (const p of m.prims) {
			for (const [x, y] of [[p.min[0], p.min[1]], [p.max[0], p.max[1]], [p.min[0], p.max[1]], [p.max[0], p.min[1]]]) {
				assert.ok(!inPlant(x / TILE, y / TILE), `${m.id} reaches into the plant at ${(x / TILE).toFixed(1)}, ${(y / TILE).toFixed(1)}`);
			}
			if (m.kind === 'apron') assert.ok(p.max[2] < 20, `${m.id} is too tall for the front`);
		}
	}
});

test('cutting keeps every pixel in its place, in pieces no bigger than PIECE', () => {
	const w = PIECE + 5, h = 7;
	const rgba = new Uint8ClampedArray(w * h * 4).map((_, i) => i % 251);
	const pieces = cut({ x: -10, y: -3, w, h, rgba });
	assert.deepEqual(pieces.map((p) => [p.x, p.y, p.w, p.h]), [[-10, -3, PIECE, 7], [-10 + PIECE, -3, 5, 7]]);
	const k = (3 * w + PIECE + 2) * 4;
	assert.deepEqual(Array.from(pieces[1].rgba.subarray((3 * 5 + 2) * 4, (3 * 5 + 2) * 4 + 4)), Array.from(rgba.subarray(k, k + 4)));
});

test('the backdrop bakes in slices: ground first, then the landmarks; it says when it is done, and stops when told', () => {
	const queue: (() => void)[] = [];
	let t = 0;
	const placed: Piece[] = [];
	let finished = 0;
	const b = bakeBackdrop({ base: base(), trackY: 19.45 * TILE, place: (p) => placed.push(p), done: () => finished++, schedule: (fn) => queue.push(fn), now: () => (t += 1) });
	assert.equal(placed.length, 0, 'nothing happens until the first slice runs');
	let slices = 0;
	while (queue.length) { queue.shift()!(); slices++; }
	const groundPieces = Math.ceil((400 + 2 * WASTE_MARGIN.x) / PIECE) * Math.ceil((220 + 2 * WASTE_MARGIN.y) / PIECE);
	assert.equal(placed.length, groundPieces + wasteLandmarks().length);
	assert.ok(slices > placed.length, 'the ground took several slices of its own');
	assert.equal(placed[0].x, -WASTE_MARGIN.x, 'the ground goes in first');
	assert.ok(b.done && finished === 1 && b.ms !== null);
	const again: (() => void)[] = [];
	const c = bakeBackdrop({ base: base(), trackY: 0, place: () => assert.fail('placed after stop'), schedule: (fn) => again.push(fn) });
	c.stop();
	while (again.length) again.shift()!();
	assert.equal(c.done, false);
});

/**
 * A stand-in worker. By default it does what sprite-worker.ts does, a turn later; `behave` can
 * make it fail to load, report a failure, or say nothing.
 *
 * @param behave 'work', 'error', 'failed' or 'silent'.
 * @returns The worker and how often it was let go.
 */
function fakeWorker(behave: 'work' | 'error' | 'failed' | 'silent' = 'work') {
	const w = {
		terminated: 0,
		onmessage: null as ((e: { data: BackdropReply }) => void) | null,
		onerror: null as ((e: { message: string; preventDefault(): void }) => void) | null,
		terminate() { this.terminated++; },
		postMessage(msg: BackdropRequest) {
			setTimeout(() => {
				if (behave === 'error') this.onerror?.({ message: 'Refused by the page\'s security policy.', preventDefault() {} });
				else if (behave === 'failed') this.onmessage?.({ data: { backdropFailed: 'boom' } });
				else if (behave === 'work') {
					backdropPieces(msg.backdrop.base, msg.backdrop.trackY, (p) => this.onmessage?.({ data: { backdropPiece: { x: p.x, y: p.y, w: p.w, h: p.h, rgba: p.rgba.buffer as ArrayBuffer } } }));
					this.onmessage?.({ data: { backdropDone: true } });
				}
			}, 0);
		},
	};
	return w;
}

/**
 * How many pieces a whole bake of the stand-in base places.
 *
 * @returns Ground pieces plus landmarks.
 */
const allPieces = () => Math.ceil((400 + 2 * WASTE_MARGIN.x) / PIECE) * Math.ceil((220 + 2 * WASTE_MARGIN.y) / PIECE) + wasteLandmarks().length;

test('in a worker of its own: the pieces come back as transferred buffers, in order, and the worker is let go', async () => {
	const worker = fakeWorker();
	const placed: Piece[] = [];
	let finished!: () => void;
	const over = new Promise<void>((r) => { finished = r; });
	const b = bakeInWorker(worker as never, { base: base(), trackY: 19.45 * TILE, place: (p) => placed.push(p), done: () => finished() });
	assert.equal(b.done, false);
	assert.equal(b.how, 'worker');
	await over;
	assert.ok(b.done && worker.terminated === 1);
	assert.ok(placed[0].rgba instanceof Uint8ClampedArray && placed[0].rgba.length === placed[0].w * placed[0].h * 4);
	assert.equal(placed.length, allPieces());
});

for (const behave of ['error', 'failed'] as const) {
	test(`a worker that ${behave === 'error' ? 'cannot load (the page\'s security policy)' : 'reports a failure'} hands the bake to the page, which finishes it`, async () => {
		const worker = fakeWorker(behave);
		const queue: (() => void)[] = [];
		const placed: Piece[] = [];
		let finished = 0;
		let cleared = 0;
		const warn = console.warn;
		console.warn = () => {};
		try {
			const b = startBackdrop(() => worker as never, { base: base(), trackY: 19.45 * TILE, place: (p) => placed.push(p), done: () => finished++, clear: () => { cleared++; placed.length = 0; }, schedule: (fn) => queue.push(fn) });
			assert.equal(b.how, 'worker');
			await new Promise((r) => setTimeout(r, 5));
			assert.equal(worker.terminated, 1, 'let go');
			assert.equal(b.how, 'page');
			assert.equal(cleared, 1, 'what the worker placed is taken away before the page starts over');
			while (queue.length) queue.shift()!();
			assert.ok(b.done && finished === 1);
			assert.equal(placed.length, allPieces());
		} finally {
			console.warn = warn;
		}
	});
}

test('a worker that falls silent is given up on, and so is one that cannot even be made', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const worker = fakeWorker('silent');
	let why = '';
	bakeInWorker(worker as never, { base: base(), trackY: 0, place: () => {} }, (w) => { why = w; });
	t.mock.timers.tick(WORKER_SILENCE_MS - 1);
	assert.equal(why, '');
	t.mock.timers.tick(2);
	assert.match(why, /fell silent/);
	assert.equal(worker.terminated, 1);
	t.mock.timers.reset();
	const b = startBackdrop(() => { throw new Error('No workers here.'); }, { base: base(), trackY: 0, place: () => {}, schedule: () => {} });
	assert.equal(b.how, 'page');
});
