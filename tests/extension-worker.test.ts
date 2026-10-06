/**
 * The background worker's listeners over a fake Chrome: first install, update, start-up,
 * permission taken away and given back, and the toolbar star.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChromeEvent, WorkerChrome } from '../src/extension/chrome';
import { ORIGIN_KEY, SCRIPT_ID } from '../src/extension/registry';
import { wireWorker } from '../src/extension/worker';
import { fakeChrome } from './fake-chrome';

/** A fake chrome.* event that can be fired. */
function event<A extends unknown[] = []>(): ChromeEvent<A> & { fire: (...a: A) => void; count: () => number } {
	const fns: ((...a: A) => void)[] = [];
	return { addListener: (fn) => fns.push(fn), fire: (...a) => fns.forEach((fn) => fn(...a)), count: () => fns.length };
}

/** Let queued promise work finish. */
const settle = async (): Promise<void> => {
	for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

/**
 * A wired worker over a fake Chrome.
 *
 * @param saved A saved, permitted address, if any.
 * @returns The fake, the events and what was opened.
 */
async function make(saved?: string) {
	const f = fakeChrome();
	if (saved) {
		await f.c.permissions.request({ origins: ['http://localhost/*'] });
		await f.c.storage.set({ [ORIGIN_KEY]: saved });
	}
	const opened: string[] = [];
	const ev = { installed: event<[{ reason: string }]>(), startup: event(), added: event(), removed: event(), clicked: event() };
	const c: WorkerChrome = {
		apis: f.c,
		openTab: async (url) => opened.push(url),
		openOptionsPage: async () => { opened.push('options'); },
		onInstalled: ev.installed,
		onStartup: ev.startup,
		onPermissionsAdded: ev.added,
		onPermissionsRemoved: ev.removed,
		onActionClicked: ev.clicked,
	};
	wireWorker(c);
	return { f, ev, opened };
}

test('every listener is attached at once, as a service worker needs', async () => {
	const w = await make();
	for (const e of Object.values(w.ev)) assert.equal(e.count(), 1);
});

test('first install opens the options page', async () => {
	const w = await make();
	w.ev.installed.fire({ reason: 'install' });
	await settle();
	assert.deepEqual(w.opened, ['options']);
});

test('an update re-registers the saved address and opens nothing', async () => {
	const w = await make('http://localhost:3100');
	w.ev.installed.fire({ reason: 'update' });
	await settle();
	assert.equal(w.f.scripts.get(SCRIPT_ID)!.matches![0], 'http://localhost:3100/api/plant-67');
	assert.deepEqual(w.opened, []);
});

test('start-up re-registers too', async () => {
	const w = await make('http://localhost:3100');
	w.ev.startup.fire();
	await settle();
	assert.ok(w.f.scripts.has(SCRIPT_ID));
});

test('permission taken away unregisters; given back registers again', async () => {
	const w = await make('http://localhost:3100');
	w.ev.startup.fire();
	await settle();
	w.f.granted.clear();
	w.ev.removed.fire();
	await settle();
	assert.equal(w.f.scripts.size, 0);
	w.f.granted.add('http://localhost/*');
	w.ev.added.fire();
	await settle();
	assert.ok(w.f.scripts.has(SCRIPT_ID));
});

test('the toolbar star opens the plant when connected, the options page when not', async () => {
	const on = await make('http://localhost:3100');
	on.ev.clicked.fire();
	await settle();
	assert.deepEqual(on.opened, ['http://localhost:3100/api/plant-67']);
	const off = await make();
	off.ev.clicked.fire();
	await settle();
	assert.deepEqual(off.opened, ['options']);
});

test('a Chrome failure is logged, not thrown, and the star still does something', async () => {
	const w = await make('http://localhost:3100');
	w.f.c.scripting.getRegisteredContentScripts = async () => { throw new Error('boom'); };
	const errors: unknown[] = [];
	const orig = console.error;
	console.error = (...a: unknown[]) => errors.push(a);
	try {
		w.ev.clicked.fire();
		await settle();
	} finally {
		console.error = orig;
	}
	assert.equal(errors.length, 1);
	assert.deepEqual(w.opened, ['options']);
});
