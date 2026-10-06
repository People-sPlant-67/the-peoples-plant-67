/**
 * Starts the options page (extension/options.html) on the real Chrome.
 */
import { chromeApis, realChrome } from './chrome';
import { mountOptions } from './options';

const root = document.getElementById('plant-options');
if (root) {
	void mountOptions(root, {
		apis: chromeApis(),
		fetchImpl: (input, init) => fetch(input, init),
		openTab: (url) => void realChrome().tabs.create({ url }),
	});
}
