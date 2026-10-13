/**
 * The plant reads the bridge's wiring again when its tab comes back into view, so a harness
 * wired in a terminal meanwhile stops being asked for without a reload.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Wiring, watchWiring } from '../src/cockpit/wiring';

const none: Wiring = { start: 's', claude: 'c', codex: 'x', warnings: [], wired: [] };
const both: Wiring = { ...none, wired: ['claude', 'codex'] };
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * A page that can be hidden and shown again.
 *
 * @returns The page and a way to show it.
 */
function fakePage() {
	const t = new EventTarget();
	const page = { visibilityState: 'visible', addEventListener: (type: 'visibilitychange', l: () => void) => t.addEventListener(type, l) };
	return {
		page,
		set(v: 'visible' | 'hidden') { page.visibilityState = v; t.dispatchEvent(new Event('visibilitychange')); },
	};
}

test('wiring: read again on coming back into view, told only when it changed', async () => {
	const p = fakePage();
	let answer: Wiring | null = none;
	let reads = 0;
	const seen: Wiring[] = [];
	watchWiring({ initial: none, read: async () => { reads++; return answer; }, onChange: (w) => seen.push(w), page: p.page, win: new EventTarget() });
	p.set('hidden');
	await flush();
	assert.equal(reads, 0, 'not read while hidden');
	p.set('visible');
	await flush();
	assert.equal(reads, 1);
	assert.equal(seen.length, 0, 'the same wiring says nothing');
	answer = both;
	p.set('hidden'); p.set('visible');
	await flush();
	assert.deepEqual(seen, [both], 'new wiring is passed on');
	answer = null;
	p.set('hidden'); p.set('visible');
	await flush();
	assert.equal(seen.length, 1, 'a failed read keeps what the plant says');
});

test('wiring: one read at a time, and a read that throws is survived', async () => {
	const p = fakePage();
	let reads = 0;
	let release: (w: Wiring) => void = () => {};
	const seen: Wiring[] = [];
	watchWiring({ initial: none, read: () => { reads++; return new Promise<Wiring>((r) => { release = r; }); }, onChange: (w) => seen.push(w), page: p.page, win: new EventTarget() });
	p.set('visible'); p.set('visible'); p.set('visible');
	assert.equal(reads, 1, 'a read in flight is not doubled');
	release(both);
	await flush();
	assert.deepEqual(seen, [both]);
	const q = fakePage();
	let n = 0;
	watchWiring({ initial: none, read: async () => { n++; throw new Error('gone'); }, onChange: () => assert.fail('nothing to say'), page: q.page, win: new EventTarget() });
	q.set('visible');
	await flush();
	q.set('visible');
	await flush();
	assert.equal(n, 2, 'a failed read does not stop the next');
});

test('wiring: read again when the window gets the focus back, as a browser beside the terminal does', async () => {
	const p = fakePage();
	const win = new EventTarget();
	let reads = 0;
	const seen: Wiring[] = [];
	watchWiring({ initial: none, read: async () => { reads++; return both; }, onChange: (w) => seen.push(w), page: p.page, win: win });
	win.dispatchEvent(new Event('focus'));
	await flush();
	assert.equal(reads, 1, 'the focus alone is enough');
	assert.deepEqual(seen, [both]);
	p.page.visibilityState = 'hidden';
	win.dispatchEvent(new Event('focus'));
	await flush();
	assert.equal(reads, 1, 'not while the tab is hidden');
});
