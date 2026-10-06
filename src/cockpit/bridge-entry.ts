/**
 * Bridge host for the cockpit: the page the npx bridge serves (src/bridge/server.ts). Every
 * request goes to the bridge on the same origin, which answers the Plant Protocol from the
 * files the harness hooks write. Built by vite.bridge.config.ts into dist-bridge/web/.
 *
 * The key: the link the npx command opens carries it after the #, which the browser never
 * sends anywhere. The page moves it into this address's own storage (other ports on 127.0.0.1
 * cannot read it), takes it off the address bar, and sends it in a header with every request.
 * Without a key, the page says how to get one and draws nothing.
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
/** Where this address keeps its key. */
const KEY_STORE = 'plant67.key';

/**
 * The key from the link (kept, then taken off the address bar), or the one kept from before.
 *
 * @returns Key, or null.
 */
function takeKey(): string | null {
	const offered = /^#key=([0-9a-f]{64})$/.exec(location.hash)?.[1] ?? null;
	if (offered) {
		try { localStorage.setItem(KEY_STORE, offered); } catch { /* Kept for this visit only. */ }
		history.replaceState(null, '', location.pathname);
		return offered;
	}
	try { return localStorage.getItem(KEY_STORE); } catch { return null; }
}

/**
 * Say how to open the plant, when this page has no key.
 *
 * @param start The command that starts this plant, if the bridge said.
 */
function locked(start: string | null): void {
	document.title = "The People's Plant #67";
	// Drawn before the cockpit's own styles exist, so its look is set here.
	document.body.style.cssText = 'margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16181d;font:16px/1.5 system-ui,sans-serif';
	const box = el('main', 'p67-locked');
	box.style.cssText = 'max-width:34rem;margin:1rem;padding:1.25rem 1.5rem;background:#efe3c4;color:#2a2420;border:3px solid #b02a22';
	box.append(
		el('h1', '', "★ The People's Plant #67"),
		el('p', '', 'The plant opens from the link in the terminal where you started it. That link carries its key, so nobody else on this computer can reach your agents.'),
		el('p', '', start ? 'Lost the link? Run this again. It opens the plant for you:' : 'Lost the link? Run the command that started the plant again. It opens the plant for you.'),
		...(start ? [Object.assign(el('code', 'p67-cmd', start), { style: 'display:block;padding:.5rem;background:rgba(0,0,0,.08);font:13px/1.5 ui-monospace,Menlo,monospace;overflow-wrap:anywhere;user-select:all' })] : []),
	);
	document.body.replaceChildren(box);
}

/**
 * The command that starts this plant, from the bridge (no key needed to ask).
 *
 * @returns Command, or null.
 */
async function startCommand(): Promise<string | null> {
	try {
		const o = await (await fetch('/api/plant-bridge')).json() as { start?: unknown };
		return typeof o.start === 'string' && o.start.length < 600 ? o.start : null;
	} catch {
		return null;
	}
}

const key = takeKey();
const start = await startCommand();
if (!key) {
	locked(start);
} else {
	const fetchImpl = (input: string, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		headers.set(KEY_HEADER, key);
		return fetch(input, { ...init, headers });
	};
	const host = hostOf('bridge');
	const cockpit = await boot({
		root: document.body,
		// The exact command for this plant's folder and port, so "start it again" starts this one.
		host: { ...host, restart: start ? `The plant's terminal has stopped. Start it again with: ${start}` : host.restart },
		fetchImpl,
		makeWorker: moduleWorker,
		sourceNote: 'Your agents, through the bridge on this computer. A directive waits here until you next send that agent a prompt in its terminal.',
		wiring: await readWiring(fetchImpl),
		// The bridge has no issue pages: threads are read inside the plant.
		issueHref: () => null,
		startPoller: (onSnapshot, companyId) => {
			// The keyed fetch: the poller's own default would send no key.
			const poller = createPoller({ fetchImpl, intervalMs: INTERVAL_MS, backoffMs: BACKOFF_MS, onSnapshot, companyId });
			poller.start();
			return poller;
		},
	});
	(window as unknown as { plant67: typeof cockpit }).plant67 = cockpit;
}
