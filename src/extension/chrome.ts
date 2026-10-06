/**
 * The extension's own pages and worker reach Chrome through here. Only the calls the plant makes
 * are typed, so there is no @types/chrome dependency; registry.ts takes the ChromeApis subset so
 * its logic can run under test.
 */
import type { ChromeApis, ContentScript } from './registry';

/** The global `chrome`, as much of it as the plant uses. */
interface Chrome {
	storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void>; remove(key: string): Promise<void> } };
	permissions: ChromeApis['permissions'] & { onRemoved: ChromeEvent<[]> };
	scripting: {
		getRegisteredContentScripts(filter: { ids: string[] }): Promise<ContentScript[]>;
		registerContentScripts(scripts: ContentScript[]): Promise<void>;
		unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
	};
	tabs: { create(props: { url: string }): Promise<unknown> };
	runtime: {
		openOptionsPage(): Promise<void>;
		onInstalled: ChromeEvent<[{ reason: string }]>;
		onStartup: ChromeEvent<[]>;
	};
	action: { onClicked: ChromeEvent<[]> };
}

/** A chrome.* event. */
interface ChromeEvent<A extends unknown[]> {
	addListener(fn: (...args: A) => void): void;
}

declare const chrome: Chrome;

/**
 * The real Chrome.
 *
 * @returns {Chrome} chrome.
 */
export function realChrome(): Chrome {
	return chrome;
}

/**
 * The real Chrome in the shape registry.ts takes.
 *
 * @returns {ChromeApis} Chrome's storage, permissions and scripting.
 */
export function chromeApis(): ChromeApis {
	return { storage: chrome.storage.local, permissions: chrome.permissions, scripting: chrome.scripting };
}
