/**
 * Form 67-C, the options page, in happy-dom over a fake Chrome: the first visit, a bad address,
 * a refusal, connecting and what the knock finds, a stale knock, changing (and cancelling) the
 * address, a permission taken back in Chrome, and disconnecting.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { fakeChrome } from './fake-chrome';

const win = new Window({ url: 'chrome-extension://abc/options.html' });
Object.assign(globalThis, { document: win.document, HTMLElement: win.HTMLElement });

const { mountOptions } = await import('../src/extension/options');
const { ORIGIN_KEY, SCRIPT_ID } = await import('../src/extension/registry');
const { permissionOrigins } = await import('../src/extension/connect');

/** Let queued promise work finish. */
const settle = async (): Promise<void> => {
	for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const PAPERCLIP_404 = (): Response => new Response('{"error":"API route not found"}', { status: 404, headers: { 'content-type': 'application/json' } });

/**
 * Mount the page over a fake Chrome.
 *
 * @param o What the fake does: the prompt's answer, what answers the knock, a saved address
 *   (permitted unless `revoked`).
 * @returns The page and its world.
 */
async function make(o: { grant?: boolean | Error; answers?: false | (() => Promise<Response>); saved?: string; revoked?: boolean } = {}) {
	const f = fakeChrome({ grant: o.grant });
	if (o.saved) {
		if (!o.revoked) await f.c.permissions.request({ origins: permissionOrigins(o.saved) });
		await f.c.storage.set({ [ORIGIN_KEY]: o.saved });
		f.calls.length = 0;
	}
	const knocks: string[] = [];
	const fetchImpl = (async (u: string | URL | Request) => {
		knocks.push(String(u));
		if (o.answers === false) throw new TypeError('Failed to fetch');
		return o.answers ? o.answers() : PAPERCLIP_404();
	}) as typeof fetch;
	const opened: string[] = [];
	const root = document.createElement('main');
	document.body.replaceChildren(root);
	await mountOptions(root, { apis: f.c, fetchImpl, openTab: (u) => opened.push(u) });
	const q = <T extends Element>(sel: string): T | null => root.querySelector(sel) as T | null;
	const input = (): HTMLInputElement => q<HTMLInputElement>('#p67o-addr')!;
	const type = (v: string): void => {
		input().value = v;
		input().dispatchEvent(new win.Event('input') as unknown as Event);
	};
	const submitNow = (): void => {
		q<HTMLFormElement>('form')!.dispatchEvent(new win.Event('submit', { cancelable: true }) as unknown as Event);
	};
	const submit = async (): Promise<void> => {
		submitNow();
		await settle();
	};
	const button = (label: string): HTMLButtonElement => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
	const msg = (): string => q('#p67o-msg')!.textContent ?? '';
	const heading = (): string => q('h1')!.textContent ?? '';
	return { f, root, q, input, type, submit, submitNow, button, msg, heading, knocks, opened };
}

test('first visit: the form, with a hint that follows the typing', async () => {
	const p = await make();
	assert.equal(p.heading(), 'Where does your Paperclip live?');
	assert.equal(p.q('#p67o-hint')!.textContent, 'Running Paperclip on this computer? Type localhost:3100.');
	p.type('localhost:3100');
	assert.equal(p.q('#p67o-hint')!.textContent, 'The plant will open at http://localhost:3100/api/plant-67.');
	p.type('paperclip.example.com/dashboard');
	assert.equal(p.q('#p67o-hint')!.textContent, 'The plant will open at https://paperclip.example.com/api/plant-67.');
	assert.match(p.root.textContent!, /No passwords\. No keys\./);
	assert.equal(p.msg(), '');
	assert.equal(p.q('#p67o-msg')!.getAttribute('role'), 'status');
});

test('a bad address is refused before Chrome is asked, and the box is marked', async () => {
	const p = await make();
	p.type('my paperclip');
	await p.submit();
	assert.match(p.msg(), /That is not a web address/);
	assert.equal(p.input().value, 'my paperclip');
	assert.equal(p.input().getAttribute('aria-invalid'), 'true');
	assert.match(p.input().getAttribute('aria-describedby')!, /p67o-msg/);
	assert.deepEqual(p.f.calls, []);
	p.type('ftp://x.example.com');
	await p.submit();
	assert.match(p.msg(), /start with https:\/\/ or http:\/\//);
	p.type('   ');
	await p.submit();
	assert.match(p.msg(), /^First, type the address you open Paperclip at\.$/);
});

test('Chrome is asked straight away in the submit, before anything is awaited', async () => {
	const p = await make();
	p.type('localhost:3100');
	p.submitNow();
	// No settling: the request must already have gone, while the click still counts as a gesture.
	assert.deepEqual(p.f.calls, ['request http://localhost/*']);
	await settle();
});

test('Chrome saying no keeps the form and saves nothing', async () => {
	const p = await make({ grant: false });
	p.type('localhost:3100');
	await p.submit();
	assert.match(p.msg(), /Chrome did not give permission/);
	assert.equal(p.input().value, 'localhost:3100');
	assert.equal(p.f.store.size, 0);
	assert.equal(p.f.scripts.size, 0);
});

test('a Chrome error is shown, as plain text', async () => {
	const p = await make({ grant: new Error('<img src=x onerror=alert(1)>') });
	p.type('localhost:3100');
	await p.submit();
	assert.match(p.msg(), /Chrome could not finish connecting \(<img src=x onerror=alert\(1\)>\)\. Try again\./);
	assert.equal(p.root.querySelector('img'), null);
});

test('connect: registered, and Paperclip answered', async () => {
	const p = await make();
	p.type('localhost:3100');
	await p.submit();
	assert.equal(p.f.scripts.get(SCRIPT_ID)!.matches![0], 'http://localhost:3100/api/plant-67');
	assert.equal(p.heading(), 'The plant is connected.');
	assert.equal(p.q('.p67o-v')!.textContent, 'http://localhost:3100');
	assert.equal(p.q('.p67o-stamp')!.textContent, 'CONNECTED');
	assert.equal(p.msg(), 'Paperclip answered at http://localhost:3100. Press Open the plant.');
	assert.deepEqual(p.knocks, ['http://localhost:3100/api/plant-67']);
	assert.match(p.root.textContent!, /pin the plant from the Extensions button \(the puzzle piece\)/);
	p.button('Open the plant').click();
	assert.deepEqual(p.opened, ['http://localhost:3100/api/plant-67']);
});

test('what the knock finds is said plainly', async () => {
	const cases: [false | (() => Promise<Response>), string, RegExp][] = [
		[false, 'NO ANSWER', /^Nothing answered at http:\/\/localhost:3100\. Start Paperclip, or press Change address and check the address and port\.$/],
		[async () => new Response('', { status: 403 }), 'CONNECTED', /^A sign-in page answered at http:\/\/localhost:3100\. Press Open the plant and sign in\. Then press Open the plant again\.$/],
		[async () => new Response('<html></html>', { status: 404, headers: { 'content-type': 'text/html' } }), 'CHECK ADDRESS', /does not look like Paperclip\. Press Change address and check the address and port\.$/],
	];
	for (const [answers, stamp, text] of cases) {
		const p = await make({ answers });
		p.type('localhost:3100');
		await p.submit();
		assert.equal(p.f.store.get(ORIGIN_KEY), 'http://localhost:3100', 'saved whatever answers');
		assert.equal(p.q('.p67o-stamp')!.textContent, stamp);
		assert.match(p.msg(), text);
	}
});

test('a saved address opens on the connected view', async () => {
	const p = await make({ saved: 'https://paperclip.example.com' });
	assert.equal(p.heading(), 'The plant is connected.');
	assert.equal(p.q('.p67o-v')!.textContent, 'https://paperclip.example.com');
	assert.ok(p.f.scripts.has(SCRIPT_ID), 're-registered on the way in');
});

test('change address: prefilled without the https, says the plant stays connected, and Cancel goes back', async () => {
	const p = await make({ saved: 'https://paperclip.example.com' });
	p.button('Change address').click();
	assert.equal(p.input().value, 'paperclip.example.com');
	assert.match(p.root.textContent!, /stays connected to https:\/\/paperclip\.example\.com until a new address is allowed/);
	p.button('Cancel').click();
	await settle();
	assert.equal(p.heading(), 'The plant is connected.');
	assert.equal(await p.f.c.storage.get(ORIGIN_KEY).then((x) => x[ORIGIN_KEY]), 'https://paperclip.example.com');
});

test('change address to a new host: connected there, old grant given back', async () => {
	const p = await make({ saved: 'https://paperclip.example.com' });
	p.button('Change address').click();
	p.type('localhost:3100');
	await p.submit();
	assert.equal(p.q('.p67o-v')!.textContent, 'http://localhost:3100');
	assert.deepEqual([...p.f.granted], ['http://localhost/*']);
});

test('a permission taken back in Chrome is explained, with the address ready to allow again', async () => {
	const p = await make({ saved: 'http://localhost:3100', revoked: true });
	assert.equal(p.heading(), 'Where does your Paperclip live?');
	assert.equal(p.input().value, 'http://localhost:3100');
	assert.equal(p.msg(), 'Chrome no longer lets the plant draw on http://localhost:3100. Press Connect to allow it again, or forget this address.');
	assert.match(p.input().getAttribute('aria-describedby')!, /p67o-msg/, 'a screen reader reads the warning with the box');
	assert.equal(p.input().getAttribute('aria-invalid'), null);
	assert.equal(p.f.scripts.size, 0);
	await p.submit();
	assert.equal(p.heading(), 'The plant is connected.');
});

test('disconnect forgets the address and gives the permission back', async () => {
	const p = await make({ saved: 'http://localhost:3100' });
	p.button('Disconnect').click();
	await settle();
	assert.equal(p.msg(), 'Disconnected. The plant no longer opens on that site.');
	assert.equal(p.f.store.size, 0);
	assert.equal(p.f.scripts.size, 0);
	assert.equal(p.f.granted.size, 0);
});

test('a slow knock does not write into the page someone moved on to', async () => {
	let answer!: (r: Response) => void;
	const p = await make({ answers: () => new Promise<Response>((r) => { answer = r; }) });
	p.type('localhost:3100');
	await p.submit();
	assert.equal(p.q('.p67o-stamp')!.textContent, 'CHECKING');
	p.button('Change address').click();
	answer(PAPERCLIP_404());
	await settle();
	assert.equal(p.heading(), 'Change the Paperclip address');
	assert.equal(p.msg(), '');
});

test('every colour on the page is one the cockpit already uses', () => {
	const css = readFileSync('extension/options.css', 'utf8');
	const cockpit = readFileSync('src/cockpit/style.ts', 'utf8').toLowerCase();
	const hexes = (t: string): Set<string> => new Set((t.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((c) => c.toLowerCase()));
	const palette = hexes(cockpit);
	const colours = [...hexes(css)];
	assert.ok(colours.length > 10);
	for (const c of colours) assert.ok(palette.has(c), `${c} is not in the cockpit's palette`);
});

/**
 * A fetch where the knocked address redirects and the redirect cannot be read (as for http to
 * https in Chrome), and only `alive` answers a no-cors try.
 *
 * @param alive Origins that answer.
 * @returns fetch.
 */
const unreadableRedirect = (alive: string[]): typeof fetch => (async (u: string | URL | Request, i?: RequestInit) => {
	if (i?.redirect === 'manual') return { type: 'opaqueredirect', status: 0, url: '', headers: new Headers() };
	if (i?.mode === 'no-cors' && alive.includes(new URL(String(u)).origin)) return { type: 'opaque', status: 0, url: '', headers: new Headers() };
	throw new TypeError('Failed to fetch');
}) as unknown as typeof fetch;

/**
 * Mount over a given fetch, connect an address, and return the page.
 *
 * @param fetchImpl fetch.
 * @param address What to type.
 * @returns The root.
 */
async function connectWith(fetchImpl: typeof fetch, address: string): Promise<HTMLElement> {
	const f = fakeChrome();
	const root = document.createElement('main');
	document.body.replaceChildren(root);
	await mountOptions(root, { apis: f.c, fetchImpl, openTab: () => undefined });
	(root.querySelector('#p67o-addr') as HTMLInputElement).value = address;
	root.querySelector('form')!.dispatchEvent(new win.Event('submit', { cancelable: true }) as unknown as Event);
	await settle();
	return root;
}

test('an address that redirects to a likely new home says so', async () => {
	const root = await connectWith(unreadableRedirect(['https://paperclip.local']), 'paperclip.local');
	assert.equal(root.querySelector('.p67o-stamp')!.textContent, 'MOVED?');
	assert.equal(root.querySelector('#p67o-msg')!.textContent, 'That address sends visitors somewhere else. Paperclip may live at https://paperclip.local. Open https://paperclip.local in a new tab. If Paperclip opens there, press Change address and type https://paperclip.local.');
});

test('an address that redirects somewhere unknown is most likely a sign-in', async () => {
	const root = await connectWith(unreadableRedirect([]), 'paperclip.example.com');
	assert.equal(root.querySelector('.p67o-stamp')!.textContent, 'CONNECTED');
	assert.equal(root.querySelector('#p67o-msg')!.textContent, 'That address sends visitors somewhere else, most likely a sign-in page. Press Open the plant and sign in. Then press Open the plant again. If the plant still does not open, press Change address and check the address.');
});

test('a tab left open catches up when it is looked at again', async () => {
	const p = await make({ saved: 'http://localhost:3100' });
	assert.equal(p.heading(), 'The plant is connected.');
	// Someone takes the permission back in Chrome's settings while this tab sits in the background.
	p.f.granted.clear();
	document.dispatchEvent(new win.Event('visibilitychange') as unknown as Event);
	await settle();
	assert.equal(p.heading(), 'Where does your Paperclip live?');
	assert.match(p.msg(), /Chrome no longer lets the plant draw on http:\/\/localhost:3100/);
});

test('a tab looked at again with nothing changed is left alone', async () => {
	const p = await make({ saved: 'http://localhost:3100' });
	const before = p.knocks.length;
	document.dispatchEvent(new win.Event('visibilitychange') as unknown as Event);
	await settle();
	assert.equal(p.heading(), 'The plant is connected.');
	assert.equal(p.knocks.length, before, 'no redraw, so no second knock');
});

test('no answer at an https address suggests typing http', async () => {
	const p = await make({ answers: false });
	p.type('paperclip.example.com');
	await p.submit();
	assert.match(p.msg(), /If you open Paperclip with http:\/\/, type http:\/\/ in front of the address\.$/);
});

test('while Chrome asks, Cancel cannot pull the form out from under the prompt', async () => {
	const p = await make({ saved: 'https://paperclip.example.com' });
	p.button('Change address').click();
	p.type('localhost:3100');
	p.submitNow();
	assert.equal(p.button('Cancel').disabled, true);
	await settle();
});

test('denied is not an invalid address', async () => {
	const p = await make({ grant: false });
	p.type('localhost:3100');
	await p.submit();
	assert.equal(p.input().getAttribute('aria-invalid'), null);
});

test('forget this address, from the revoked state', async () => {
	const p = await make({ saved: 'http://localhost:3100', revoked: true });
	p.button('Forget this address').click();
	await settle();
	assert.equal(p.msg(), 'Forgotten. The plant no longer opens on that site.');
	assert.equal(p.f.store.size, 0);
});

test('the address box carries the instructions for a screen reader', async () => {
	const p = await make();
	assert.equal(p.input().getAttribute('aria-describedby'), 'p67o-lede p67o-hint');
	assert.match(p.q('#p67o-lede')!.textContent!, /read and change your data/);
});

test('looking at the tab again while the form is up leaves what was typed alone', async () => {
	const p = await make({ saved: 'http://localhost:3100' });
	p.button('Change address').click();
	p.type('paperclip.exa');
	document.dispatchEvent(new win.Event('visibilitychange') as unknown as Event);
	await settle();
	assert.equal(p.heading(), 'Change the Paperclip address');
	assert.equal(p.input().value, 'paperclip.exa');
});

test('a refresh that lands after someone moved on does not redraw over them', async () => {
	const p = await make({ saved: 'http://localhost:3100' });
	p.f.granted.clear();
	document.dispatchEvent(new win.Event('visibilitychange') as unknown as Event);
	// Before the check comes back, they press Change address and start typing.
	p.button('Change address').click();
	p.type('paperclip.exa');
	await settle();
	assert.equal(p.input().value, 'paperclip.exa');
});

test('Cancel checks Chrome again before saying connected', async () => {
	const p = await make({ saved: 'http://localhost:3100' });
	p.button('Change address').click();
	p.f.granted.clear();
	p.button('Cancel').click();
	await settle();
	assert.equal(p.heading(), 'Where does your Paperclip live?');
	assert.match(p.msg(), /Chrome no longer lets the plant draw on http:\/\/localhost:3100/);
});
