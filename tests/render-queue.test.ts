/**
 * Scheduling rules of the sprite render queue: priority order, de-duplication and
 * cancellation. Runs in Node with a fake executor, so no Web Worker is involved.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancelledError, RenderQueue, isCancelled } from '../src/preview/render-queue';
import { renderSprite, spriteKey } from '../src/art/sprite-job';
import { headTopIn, renderAvatar } from '../src/art/avatar';
import { ALEXEI } from '../src/art/outfits';

/**
 * Executor whose jobs finish only when the test says so, recording the order they started.
 *
 * @returns {{exec: Function, started: string[], finish: Function, fail: Function, calls: Function}} Fake executor and controls.
 */
function fake() {
	const started: string[] = [];
	const open = new Map<string, { resolve: (v: string) => void; reject: (e: unknown) => void }>();
	const exec = (req: string) => new Promise<string>((resolve, reject) => { started.push(req); open.set(req, { resolve, reject }); });
	return {
		exec,
		started,
		/** Complete a started job with a result derived from its request. */
		finish: async (req: string) => { open.get(req)!.resolve(`done:${req}`); open.delete(req); await settle(); },
		fail: async (req: string, msg: string) => { open.get(req)!.reject(new Error(msg)); open.delete(req); await settle(); },
		calls: (req: string) => started.filter((s) => s === req).length,
	};
}

/**
 * Let queued microtasks (job starts and completions) run.
 *
 * @returns {Promise<void>} Resolves after pending microtasks and one macrotask.
 */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Queue a job whose key and request are the same string.
 *
 * @param {RenderQueue} q Queue.
 * @param {string} k Key and request.
 * @param {number} p Priority.
 * @param {string} g Group.
 * @returns {Promise<string>} Result.
 */
const ask = (q: RenderQueue<string, string>, k: string, p: number, g = 'a') => q.request(k, g, k, p);

test('queued jobs run by priority, newest first at level 0 and oldest first elsewhere', async () => {
	const f = fake();
	const q = new RenderQueue(f.exec, 1);
	ask(q, 'blocker', 3);
	await settle();
	ask(q, 'pre1', 3); ask(q, 'sheet1', 2); ask(q, 'anim1', 1); ask(q, 'anim2', 1);
	ask(q, 'vis-old', 0); ask(q, 'vis-new', 0); ask(q, 'pre2', 3);
	assert.equal(q.queued, 7);
	for (const k of ['blocker', 'vis-new', 'vis-old', 'anim1', 'anim2', 'sheet1', 'pre1']) await f.finish(k);
	assert.deepEqual(f.started, ['blocker', 'vis-new', 'vis-old', 'anim1', 'anim2', 'sheet1', 'pre1', 'pre2']);
});

test('concurrency caps jobs in flight, and a finished job frees its slot', async () => {
	const f = fake();
	const q = new RenderQueue(f.exec, 2);
	for (const k of ['a', 'b', 'c', 'd']) ask(q, k, 1);
	await settle();
	assert.deepEqual(f.started, ['a', 'b']);
	assert.equal(q.running, 2);
	await f.finish('b');
	assert.deepEqual(f.started, ['a', 'b', 'c']);
	assert.equal(q.running, 2);
	assert.equal(q.queued, 1);
});

test('a duplicate request shares one job and one result', async () => {
	const f = fake();
	const q = new RenderQueue(f.exec, 1);
	const p1 = ask(q, 'x', 2);
	const p2 = ask(q, 'x', 2);
	assert.equal(p1, p2);
	await settle();
	const p3 = ask(q, 'x', 0); // joins the running job
	assert.equal(p3, p1);
	await f.finish('x');
	assert.equal(await p1, 'done:x');
	assert.equal(f.calls('x'), 1);
	// Once settled the key is free again: the caller's own cache is what stops re-renders.
	ask(q, 'x', 1);
	await settle();
	assert.equal(f.calls('x'), 2);
});

test('a more urgent duplicate moves a queued job up, and never down', async () => {
	const f = fake();
	const q = new RenderQueue(f.exec, 1);
	ask(q, 'blocker', 0);
	await settle();
	ask(q, 'early', 2); ask(q, 'late', 3); ask(q, 'urgent', 1);
	ask(q, 'late', 0); // promoted to the visible level
	ask(q, 'urgent', 3); // a less urgent repeat changes nothing
	for (const k of ['blocker', 'late', 'urgent']) await f.finish(k);
	assert.deepEqual(f.started, ['blocker', 'late', 'urgent', 'early']);
});

test('demote pushes urgent queued work down without reordering it', async () => {
	const f = fake();
	const q = new RenderQueue(f.exec, 1);
	ask(q, 'blocker', 0);
	await settle();
	ask(q, 'old-anim1', 1); ask(q, 'old-anim2', 1); ask(q, 'bg', 3);
	q.demote(3);
	ask(q, 'new-anim1', 1);
	for (const k of ['blocker', 'new-anim1', 'old-anim1']) await f.finish(k);
	assert.deepEqual(f.started, ['blocker', 'new-anim1', 'old-anim1', 'old-anim2']);
});

test('cancel drops queued jobs in a group, discards a running result and leaves other groups alone', async () => {
	const f = fake();
	const q = new RenderQueue(f.exec, 1);
	const running = ask(q, 'old-0', 0, 'old');
	await settle();
	const queued = ask(q, 'old-1', 1, 'old');
	const other = ask(q, 'new-0', 1, 'new');
	assert.equal(q.cancel('old'), 2);
	await assert.rejects(running, CancelledError);
	await assert.rejects(queued, (e) => isCancelled(e));
	// The running job still holds its worker until it lands; the next job waits for it.
	await settle();
	assert.deepEqual(f.started, ['old-0']);
	// Asking again for a cancelled key starts a fresh job rather than joining the dead one.
	const again = ask(q, 'old-0', 2, 'old');
	assert.notEqual(again, running);
	await f.finish('old-0');
	assert.deepEqual(f.started, ['old-0', 'new-0']);
	await f.finish('new-0');
	assert.equal(await other, 'done:new-0');
	await f.finish('old-0');
	assert.equal(await again, 'done:old-0');
	assert.equal(f.calls('old-1'), 0);
});

test('an executor failure rejects that job only, including a synchronous throw', async () => {
	const f = fake();
	const q = new RenderQueue(f.exec, 1);
	const bad = ask(q, 'bad', 0);
	const good = ask(q, 'good', 1);
	await settle();
	await f.fail('bad', 'boom');
	await assert.rejects(bad, /boom/);
	await f.finish('good');
	assert.equal(await good, 'done:good');

	const q2 = new RenderQueue<string, string>(() => { throw new Error('sync boom'); }, 1);
	await assert.rejects(q2.request('k', 'g', 'k', 0), /sync boom/);
	assert.equal(q2.running, 0);
});

test('the worker job renders the same pixels and head-top point as the direct renderer', () => {
	const px = renderSprite({ outfit: ALEXEI, anim: 'work', dir: 'SE', frame: 2 });
	const fr = renderAvatar(ALEXEI, 'work', 'SE', 2);
	assert.deepEqual(px.top, headTopIn(fr));
	assert.equal(px.w, fr.w);
	assert.deepEqual(px.rgba, fr.rgba);
	assert.equal(spriteKey(ALEXEI.id, 'work', 'SE', 2), 'alexei|work|SE|2');
	// The outfit crosses postMessage, so it must survive a structured clone unchanged.
	assert.deepEqual(structuredClone(ALEXEI), ALEXEI);
});
