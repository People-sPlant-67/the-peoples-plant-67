/**
 * Render worker for pages Vite serves (the previewer and the cockpit's dev page): Vite bundles
 * sprite-worker.ts and serves it from the page's own origin. Kept out of sprite-client.ts so
 * the extension bundle, which starts its workers from a Blob URL instead, never includes it.
 */

/**
 * Start one render worker as an ES module worker.
 *
 * @returns {Worker} A new render worker.
 */
export function moduleWorker(): Worker {
	return new Worker(new URL('./sprite-worker.ts', import.meta.url), { type: 'module' });
}
