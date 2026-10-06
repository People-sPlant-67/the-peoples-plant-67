/**
 * The extension's background worker. It keeps the plant registered on the saved Paperclip
 * address (Chrome can drop dynamic content scripts on an update), forgets the address when
 * someone takes the permission away in Chrome's settings, opens the options page on first
 * install, and makes the toolbar star open the plant.
 */
import { plantUrl } from './connect';
import { chromeApis, realChrome } from './chrome';
import { sync } from './registry';

const chrome = realChrome();
const apis = chromeApis();

/**
 * Re-check Chrome's state, logging rather than throwing: a worker error has nowhere to go.
 *
 * @returns {Promise<string | null>} The connected origin, or null.
 */
async function check(): Promise<string | null> {
	try {
		return await sync(apis);
	} catch (err) {
		console.error('[plant] Could not check the Paperclip connection.', err);
		return null;
	}
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
	void check().then((origin) => {
		if (reason === 'install' && !origin) void chrome.runtime.openOptionsPage();
	});
});
chrome.runtime.onStartup.addListener(() => void check());
chrome.permissions.onRemoved.addListener(() => void check());
chrome.action.onClicked.addListener(() => {
	void check().then((origin) => (origin ? chrome.tabs.create({ url: plantUrl(origin) }) : chrome.runtime.openOptionsPage()));
});
