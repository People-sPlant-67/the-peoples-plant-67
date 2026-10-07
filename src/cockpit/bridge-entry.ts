/**
 * Bridge host for the cockpit: the page the npx bridge serves (src/bridge/server.ts). Every
 * request goes to the bridge on the same origin, which answers the Plant Protocol from the
 * files the harness hooks write. Built by vite.bridge.config.ts into dist-bridge/web/.
 *
 * The key: the link the npx command opens carries it after the #, which the browser never
 * sends anywhere. The page moves it into this tab's own storage, takes it off the address bar,
 * and sends it in a header with every request. Without a key the plant knows, the page says how
 * to get one and draws nothing.
 *
 * The bridge's pages forbid eval in their Content-Security-Policy, so Pixi's eval-free shader
 * glue is swapped in first, as in the extension.
 */
import 'pixi.js/unsafe-eval';
import { KEY_HEADER } from '../bridge/words';
import { createPoller } from '../live/poller';
import { moduleWorker } from '../preview/module-worker';
import { boot } from './app';
import { el } from './dom';
import { hostOf } from './host';
import { readWiring } from './wiring';

/** The bridge is on this computer: it can be asked often. */
const INTERVAL_MS = 3_000;
/** After failures, ask again this often: a restarted bridge is found within seconds. */
const BACKOFF_MS = 5_000;
/** Where this tab keeps its key. */
const KEY_STORE = 'plant67.key';

/**
 * The tab's own storage, or null where touching it throws.
 *
 * @returns Storage or null.
 */
function store(): Storage | null {
	try { return sessionStorage; } catch { return null; }
}

/**
 * The key from the link (kept, then taken off the address bar), or the one this tab kept before.
 * Kept per tab, not for the address: a key only lives until the plant stops, and a tab is the
 * only place that needs it.
 *
 * @returns Key, or null.
 */
function takeKey(): string | null {
	const offered = /^#key=([0-9a-f]{64})$/.exec(location.hash)?.[1] ?? null;
	if (offered) {
		try { store()?.setItem(KEY_STORE, offered); } catch { /* Kept for this visit only. */ }
		history.replaceState(null, '', location.pathname);
		return offered;
	}
	try { return store()?.getItem(KEY_STORE) ?? null; } catch { return null; }
}

/** Say how to open the plant, when this tab has no key the plant knows. */
function locked(): void {
	try { store()?.removeItem(KEY_STORE); } catch { /* Nothing kept. */ }
	document.title = "The People's Plant #67";
	// Drawn before the cockpit's own styles exist, so its look is set here.
	document.body.style.cssText = 'margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16181d;font:16px/1.5 system-ui,sans-serif';
	const box = el('main', 'p67-locked');
	box.style.cssText = 'max-width:34rem;margin:1rem;padding:1.25rem 1.5rem;background:#efe3c4;color:#2a2420;border:3px solid #b02a22';
	box.append(
		el('h1', '', "★ The People's Plant #67"),
		el('p', '', 'The plant opens from the link in the terminal where you started it. That link carries its key, so nobody else on this computer can reach your agents. The key changes each time the plant starts.'),
		el('p', '', 'Lost the link? Run the command that started the plant again. It prints a new link, and opens it unless you started it with --no-open.'),
	);
	document.body.replaceChildren(box);
}

// A new link pasted into this tab changes only the part after the #, which never reloads a page.
window.addEventListener('hashchange', () => { if (/^#key=[0-9a-f]{64}$/.test(location.hash)) { takeKey(); location.reload(); } });

const key = takeKey();
/**
 * Set once the bridge has gone or refused this tab's key. The key is new at every start, so such
 * a tab can never be let in again, and it sends nothing more: whatever answers on this port next
 * could be another program. The page still shows how to start the plant again.
 */
let dead: { refused: string } | 'gone' | null = null;
const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
	// Refused stays refused, so the page keeps saying this tab is out of date.
	if (dead === 'gone') throw new TypeError('The plant has stopped.');
	if (dead) return new Response(dead.refused, { status: 401, headers: { 'Content-Type': 'application/json' } });
	const headers = new Headers(init?.headers);
	if (key) headers.set(KEY_HEADER, key);
	try {
		const r = await fetch(input, { ...init, headers });
		if (r.status === 401) dead = { refused: await r.clone().text() };
		return r;
	} catch (err) {
		// A request the page gave up on (it took too long) says nothing about the bridge.
		if ((err as Error).name !== 'AbortError') dead = 'gone';
		throw err;
	}
};
// A key from before the plant last started is refused: say how to get the new one, at once.
const known = key ? await fetchImpl('/api/plant-bridge/wiring').then((r) => r.status !== 401, () => true) : false;
if (!known) {
	locked();
} else {
	const wiring = await readWiring(fetchImpl);
	const cockpit = await boot({
		root: document.body,
		// The exact command for this plant's folder and port, so "start it again" starts this one.
		host: hostOf('bridge', wiring?.start ?? null),
		fetchImpl,
		makeWorker: moduleWorker,
		sourceNote: 'Your agents, through the bridge on this computer. A directive waits here until you next send that agent a prompt in its terminal.',
		wiring,
		// The bridge has no issue pages: threads are read inside the plant.
		issueHref: () => null,
		startPoller: (onSnapshot, companyId) => {
			const poller = createPoller({ fetchImpl, intervalMs: INTERVAL_MS, backoffMs: BACKOFF_MS, onSnapshot, companyId });
			poller.start();
			return poller;
		},
	});
	(window as unknown as { plant67: typeof cockpit }).plant67 = cockpit;
}
