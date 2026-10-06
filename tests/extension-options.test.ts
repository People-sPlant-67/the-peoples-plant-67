/**
 * Form 67-C, the options page, in happy-dom over a fake Chrome: the first visit, a bad address,
 * a refusal, connecting with and without an answer, a stale knock, changing and disconnecting.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { fakeChrome } from './fake-chrome';

const win = new Window({ url: 'chrome-extension://abc/options.html' });
Object.assign(globalThis, { document: win.document, HTMLElement: win.HTMLElement });

const { mountOptions } = await import('../src/extension/options');
const { ORIGIN_KEY, SCRIPT_ID } = await import('../src/extension/registry');

/** Let queued promise work finish. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Mount the page over a fake Chrome.
 *
 * @param o What the fake does: the prompt's answer, whether Paperclip answers, a saved address.
 * @returns The page and its world.
 */
async function make(o: { grant?: boolean | Error; answers?: boolean | (() => Promise<Response>); saved?: string } = {}) {
	const f = fakeChrome({ grant: o.grant });
	if (o.saved) {
		await f.c.permissions.request({ origins: [`${o.saved}/*`] });
		await f.c.storage.set({ [ORIGIN_KEY]: o.saved });
		f.calls.length = 0;
	}
	const knocks: string[] = [];
	const fetchImpl = (async (u: string | URL | Request) => {
		knocks.push(String(u));
		if (typeof o.answers === 'function') return o.answers();
		if (o.answers === false) throw new TypeError('Failed to fetch');
		return new Response('{}', { status: 404 });
	}) as typeof fetch;
	const opened: string[] = [];
	const root = document.createElement('main');
	document.body.replaceChildren(root);
	await mountOptions(root, { apis: f.c, fetchImpl, openTab: (u) => opened.push(u) });
	const q = <T extends Element>(sel: string): T | null => root.querySelector(sel) as T | null;
	const text = (): string => root.textContent ?? '';
	const type = (v: string): void => {
		const i = q<HTMLInputElement>('#p67o-addr')!;
		i.value = v;
		i.dispatchEvent(new win.Event('input') as unknown as Event);
	};
	const submit = async (): Promise<void> => {
		q<HTMLFormElement>('form')!.dispatchEvent(new win.Event('submit', { cancelable: true }) as unknown as Event);
		await settle();
		await settle();
	};
	const button = (label: string): HTMLButtonElement => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
	return { f, root, q, text, type, submit, button, knocks, opened };
}

test('first visit: the form, with a hint that follows the typing', async () => {
	const p = await make();
	assert.match(p.q('h1')!.textContent!, /Where does your Paperclip live\?/);
	assert.match(p.q('#p67o-hint')!.textContent!, /Type localhost:3100\./);
	p.type('localhost:3100');
	assert.equal(p.q('#p67o-hint')!.textContent, 'The plant will open at http://localhost:3100/api/plant-67');
	p.type('paperclip.example.com/dashboard');
	assert.equal(p.q('#p67o-hint')!.textContent, 'The plant will open at https://paperclip.example.com/api/plant-67');
	assert.match(p.text(), /No passwords\. No keys\./);
});

test('a bad address is refused before Chrome is asked', async () => {
	const p = await make();
	p.type('my paperclip');
	await p.submit();
	assert.match(p.q('.p67o-err')!.textContent!, /That is not a web address/);
	assert.equal(p.q('.p67o-err')!.getAttribute('role'), 'alert');
	assert.equal(p.q<HTMLInputElement>('#p67o-addr')!.value, 'my paperclip');
	assert.deepEqual(p.f.calls, []);
	p.type('ftp://x.example.com');
	await p.submit();
	assert.match(p.q('.p67o-err')!.textContent!, /start with https:\/\/ or http:\/\//);
	p.type('   ');
	await p.submit();
	assert.match(p.q('.p67o-err')!.textContent!, /Type the address/);
});

test('Chrome saying no keeps the form and saves nothing', async () => {
	const p = await make({ grant: false });
	p.type('localhost:3100');
	await p.submit();
	assert.match(p.q('.p67o-err')!.textContent!, /Chrome did not give permission/);
	assert.equal(p.q<HTMLInputElement>('#p67o-addr')!.value, 'localhost:3100');
	assert.equal(p.f.store.size, 0);
	assert.equal(p.f.scripts.size, 0);
});

test('a Chrome error is shown, not swallowed', async () => {
	const p = await make({ grant: new Error('Permission is unknown') });
	p.type('localhost:3100');
	await p.submit();
	assert.match(p.q('.p67o-err')!.textContent!, /Chrome could not finish connecting \(Permission is unknown\)/);
});

test('connect: asked for that one site, registered, and Paperclip answered', async () => {
	const p = await make();
	p.type('localhost:3100');
	await p.submit();
	assert.equal(p.f.calls[0], 'request http://localhost:3100/*');
	assert.equal(p.f.scripts.get(SCRIPT_ID)!.matches![0], 'http://localhost:3100/api/plant-67');
	assert.match(p.q('h1')!.textContent!, /The plant is connected\./);
	assert.equal(p.q('.p67o-v')!.textContent, 'http://localhost:3100');
	assert.equal(p.q('.p67o-stamp')!.textContent, 'CONNECTED');
	assert.equal(p.q('.p67o-ok')!.textContent, 'Paperclip answered at http://localhost:3100.');
	assert.deepEqual(p.knocks, ['http://localhost:3100/api/plant-67']);
	p.button('Open the plant').click();
	assert.deepEqual(p.opened, ['http://localhost:3100/api/plant-67']);
});

test('connected but silent: saved anyway, with a warning stamp', async () => {
	const p = await make({ answers: false });
	p.type('localhost:3100');
	await p.submit();
	assert.equal(p.f.store.get(ORIGIN_KEY), 'http://localhost:3100');
	assert.equal(p.q('.p67o-stamp')!.textContent, 'NO ANSWER');
	assert.match(p.q('.p67o-warn')!.textContent!, /Nothing answered at http:\/\/localhost:3100 just now\. Start Paperclip/);
});

test('a saved address opens on the connected view', async () => {
	const p = await make({ saved: 'https://paperclip.example.com' });
	assert.match(p.q('h1')!.textContent!, /The plant is connected\./);
	assert.equal(p.q('.p67o-v')!.textContent, 'https://paperclip.example.com');
	// The page re-registered it on the way in.
	assert.ok(p.f.scripts.has(SCRIPT_ID));
});

test('change address prefills the form without the https', async () => {
	const p = await make({ saved: 'https://paperclip.example.com' });
	p.button('Change address').click();
	assert.equal(p.q<HTMLInputElement>('#p67o-addr')!.value, 'paperclip.example.com');
	assert.match(p.q('#p67o-hint')!.textContent!, /https:\/\/paperclip\.example\.com\/api\/plant-67/);
});

test('disconnect forgets the address and gives the permission back', async () => {
	const p = await make({ saved: 'http://localhost:3100' });
	p.button('Disconnect').click();
	await settle();
	await settle();
	assert.match(p.q('.p67o-ok')!.textContent!, /Disconnected\./);
	assert.equal(p.f.store.size, 0);
	assert.equal(p.f.scripts.size, 0);
	assert.equal(p.f.granted.size, 0);
});

test('a slow knock does not redraw a page that was left', async () => {
	let answer!: (r: Response) => void;
	const p = await make({ answers: () => new Promise<Response>((r) => { answer = r; }) });
	p.type('localhost:3100');
	await p.submit();
	assert.match(p.text(), /Checking that Paperclip answers/);
	p.button('Change address').click();
	answer(new Response('{}', { status: 404 }));
	await settle();
	assert.match(p.q('h1')!.textContent!, /Where does your Paperclip live\?/);
	assert.equal(p.q('.p67o-ok'), null);
});

test('text from the address goes in as text', async () => {
	const p = await make({ grant: new Error('<img src=x onerror=alert(1)>') });
	p.type('localhost:3100');
	await p.submit();
	assert.equal(p.root.querySelector('img'), null);
});
