/**
 * The options page and the background worker on one slow fake Chrome, as in real Chrome:
 * granting a permission wakes the worker while the page is still connecting. Whatever order
 * their calls interleave in, the plant must end registered on the address that was saved.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import type { WorkerChrome } from '../src/extension/chrome';
import { event, fakeChrome } from './fake-chrome';

const win = new Window({ url: 'chrome-extension://abc/options.html' });
Object.assign(globalThis, { document: win.document, HTMLElement: win.HTMLElement });

const { mountOptions } = await import('../src/extension/options');
const { ORIGIN_KEY, SCRIPT_ID } = await import('../src/extension/registry');
const { wireWorker } = await import('../src/extension/worker');
const { contentMatches, permissionOrigins } = await import('../src/extension/connect');

/** Let every queued turn finish. */
const settle = async (): Promise<void> => {
	for (let i = 0; i < 200; i++) await new Promise((r) => setTimeout(r, 0));
};

/**
 * The page and the worker sharing one slow fake Chrome.
 *
 * @param eventTurns How long a permission event takes to reach the worker.
 * @returns The fake and helpers to drive the page.
 */
async function make(eventTurns: number) {
	const f = fakeChrome({ slow: true, eventTurns });
	const c: WorkerChrome = {
		apis: f.c,
		openTab: async () => undefined,
		openOptionsPage: async () => undefined,
		onInstalled: event<[{ reason: string }]>(),
		onStartup: event(),
		onPermissionsAdded: f.onAdded,
		onPermissionsRemoved: f.onRemoved,
		onActionClicked: event(),
	};
	wireWorker(c);
	const fetchImpl = (async () => new Response('{"error":"API route not found"}', { status: 404, headers: { 'content-type': 'application/json' } })) as typeof fetch;
	const root = document.createElement('main');
	document.body.replaceChildren(root);
	await mountOptions(root, { apis: f.c, fetchImpl, openTab: () => undefined });
	const connectTo = async (address: string): Promise<void> => {
		const input = root.querySelector('#p67o-addr') as HTMLInputElement;
		input.value = address;
		(root.querySelector('form') as HTMLFormElement).dispatchEvent(new win.Event('submit', { cancelable: true }) as unknown as Event);
		await settle();
	};
	const change = (): void => (Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Change address') as HTMLButtonElement).click();
	/** The whole state must agree on one address. */
	const assertConnectedTo = (origin: string): void => {
		assert.equal(f.store.get(ORIGIN_KEY), origin, 'saved');
		assert.deepEqual(f.scripts.get(SCRIPT_ID)?.matches, contentMatches(origin), 'registered on the saved address');
		assert.deepEqual([...f.granted], permissionOrigins(origin), 'holding only its grant');
		assert.equal(root.querySelector('.p67o-v')?.textContent, origin, 'the page says so');
	};
	return { f, connectTo, change, assertConnectedTo };
}

/** Every point at which the worker could wake during a connect. */
const DELAYS = Array.from({ length: 12 }, (_, i) => i + 1);

test('first connect: the worker waking mid-connect does not undo it', async () => {
	for (const d of DELAYS) {
		const t = await make(d);
		await t.connectTo('localhost:3100');
		t.assertConnectedTo('http://localhost:3100');
	}
});

// The first-connect sweep is the one that catches a missing lock. This one checks the end state
// after a host change at a few timings; the worker's own wake-ups would heal it without the lock.
test('a new host: the worker waking on both grant changes leaves the plant on the new one', async () => {
	for (const d of [1, 3, 6]) {
		const t = await make(d);
		await t.connectTo('localhost:3100');
		t.change();
		await t.connectTo('paperclip.example.com');
		t.assertConnectedTo('https://paperclip.example.com');
	}
});

test('back and forth between hosts, then disconnect: nothing left behind', async () => {
	const t = await make(3);
	await t.connectTo('localhost:3100');
	t.change();
	await t.connectTo('paperclip.example.com');
	t.change();
	await t.connectTo('localhost:3200');
	t.assertConnectedTo('http://localhost:3200');
	(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Disconnect') as HTMLButtonElement).click();
	await settle();
	assert.equal(t.f.store.size, 0);
	assert.equal(t.f.scripts.size, 0);
	assert.equal(t.f.granted.size, 0);
});
