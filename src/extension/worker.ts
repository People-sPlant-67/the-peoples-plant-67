/**
 * What the background worker does. It keeps the plant registered on the saved Paperclip address
 * (Chrome can drop dynamic content scripts on an update), unregisters it when someone takes the
 * permission away in Chrome's settings and registers it again when they give it back, opens the
 * options page on first install, and makes the toolbar star open the plant.
 *
 * Chrome is passed in, so this runs under test; background.ts wires it to the real one.
 */
import type { WorkerChrome } from './chrome';
import { plantUrl } from './connect';
import { sync } from './registry';

/**
 * Attach the worker's listeners. A service worker must do this synchronously at start-up, or
 * Chrome may not wake it for the events.
 *
 * @param {WorkerChrome} c Chrome.
 */
export function wireWorker(c: WorkerChrome): void {
	/**
	 * Re-check Chrome's state, logging rather than throwing: a worker error has nowhere to go.
	 *
	 * @returns {Promise<string | null>} The connected origin, or null.
	 */
	const check = async (): Promise<string | null> => {
		try {
			return await sync(c.apis);
		} catch (err) {
			console.error('[plant] Could not check the Paperclip connection.', err);
			return null;
		}
	};
	c.onInstalled.addListener(({ reason }) => {
		void check().then((origin) => (reason === 'install' && !origin ? c.openOptionsPage() : undefined));
	});
	c.onStartup.addListener(() => void check());
	c.onPermissionsAdded.addListener(() => void check());
	c.onPermissionsRemoved.addListener(() => void check());
	c.onActionClicked.addListener(() => {
		void check().then((origin) => (origin ? c.openTab(plantUrl(origin)) : c.openOptionsPage()));
	});
}
