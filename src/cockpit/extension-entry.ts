/**
 * Extension host for the cockpit: the content script on <host>/api/plant-67. That URL is a
 * small JSON 404 from Paperclip, so the page is idle and ours to replace. From here every
 * fetch is a same-origin GET carrying the browser's own sign-in to Paperclip.
 *
 * Built by vite.extension.config.ts into one classic script (IIFE) with PixiJS inside, because
 * a content script cannot load ES modules.
 *
 * Render workers: Chrome will not start a worker from a chrome-extension:// URL on a page of
 * another origin. Vite's `?worker&inline` bundles sprite-worker.ts into this file as a string
 * and starts each worker from a Blob URL, which counts as the page's own origin. If the page's
 * Content-Security-Policy forbids blob: workers too, the sprite client notices the load
 * failure and renders on the main thread instead: slower to fill in, but it still works.
 */
// Pixi compiles some shader glue with new Function(), which an extension's content script may
// not do. This import swaps in eval-free versions and must come before any renderer starts.
import 'pixi.js/unsafe-eval';
import { createPoller } from '../live/poller';
import SpriteWorker from '../preview/sprite-worker?worker&inline';
import { boot } from './app';

/**
 * Replace Paperclip's 404 page with an empty document and start the cockpit.
 */
async function main(): Promise<void> {
	document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'));
	document.title = "People's Plant #67";
	const body = document.body;
	body.style.margin = '0';
	body.style.background = '#16181d';
	await boot({
		root: body,
		fetchImpl: (input, init) => fetch(input, init),
		makeWorker: () => new SpriteWorker(),
		startPoller: (onSnapshot) => {
			const poller = createPoller({ onSnapshot });
			poller.start();
			return poller;
		},
	});
}

main().catch((err) => console.error('[plant] The cockpit failed to start.', err));
