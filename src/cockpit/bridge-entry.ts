/**
 * Bridge host for the cockpit: the page the npx bridge serves (src/bridge/server.ts). Every
 * request goes to the bridge on the same origin, which answers the Plant Protocol from the
 * files the harness hooks write. Built by vite.bridge.config.ts into dist-bridge/web/.
 *
 * The bridge's pages forbid eval in their Content-Security-Policy, so Pixi's eval-free shader
 * glue is swapped in first, as in the extension.
 */
import 'pixi.js/unsafe-eval';
import { createPoller } from '../live/poller';
import { moduleWorker } from '../preview/module-worker';
import { boot } from './app';
import { EMPTY_PLANT } from './wizard';

/** The bridge is on this computer: it can be asked often. */
const INTERVAL_MS = 3_000;

const cockpit = await boot({
	root: document.body,
	host: 'bridge',
	fetchImpl: (input, init) => fetch(input, init),
	makeWorker: moduleWorker,
	sourceNote: 'Your agents, through the bridge on this computer. A directive waits here until you next send that agent a prompt in its terminal.',
	emptyNote: EMPTY_PLANT,
	// The bridge has no issue pages: threads are read inside the plant.
	issueHref: () => null,
	startPoller: (onSnapshot, companyId) => {
		const poller = createPoller({ intervalMs: INTERVAL_MS, onSnapshot, companyId });
		poller.start();
		return poller;
	},
});
(window as unknown as { plant67: typeof cockpit }).plant67 = cockpit;
