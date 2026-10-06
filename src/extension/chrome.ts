/**
 * The extension's own pages and worker reach Chrome through here. Only the calls the plant makes
 * are typed, so there is no @types/chrome dependency. registry.ts takes the ChromeApis subset and
 * worker.ts the WorkerChrome subset, so their logic runs under test with a fake.
 */
import type { ChromeApis } from './registry';

/** A chrome.* event. */
export interface ChromeEvent<A extends unknown[] = []> {
	addListener(fn: (...args: A) => void): void;
}

/** What the background worker uses. */
export interface WorkerChrome {
	apis: ChromeApis;
	openTab(url: string): Promise<unknown>;
	openOptionsPage(): Promise<void>;
	onInstalled: ChromeEvent<[{ reason: string }]>;
	onStartup: ChromeEvent;
	onPermissionsAdded: ChromeEvent;
	onPermissionsRemoved: ChromeEvent;
	onActionClicked: ChromeEvent;
}

/** The global `chrome`, as much of it as the plant uses. */
interface Chrome {
	storage: { local: ChromeApis['storage'] };
	permissions: ChromeApis['permissions'] & { onAdded: ChromeEvent; onRemoved: ChromeEvent };
	scripting: ChromeApis['scripting'];
	tabs: { create(props: { url: string }): Promise<unknown> };
	runtime: { openOptionsPage(): Promise<void>; onInstalled: ChromeEvent<[{ reason: string }]>; onStartup: ChromeEvent };
	action: { onClicked: ChromeEvent };
}

declare const chrome: Chrome;

/**
 * The real Chrome in the shape registry.ts takes.
 *
 * @returns {ChromeApis} Chrome's storage, permissions and scripting, and the extension-wide lock.
 */
export function chromeApis(): ChromeApis {
	return {
		storage: chrome.storage.local,
		permissions: chrome.permissions,
		scripting: chrome.scripting,
		// A Web Lock is shared by every page and worker of this extension (one origin), so the
		// options page and the background worker never interleave their changes.
		lock: <T>(fn: () => Promise<T>): Promise<T> => navigator.locks.request('plant67-registry', fn) as Promise<T>,
	};
}

/**
 * The real Chrome in the shape worker.ts takes.
 *
 * @returns {WorkerChrome} Chrome for the background worker.
 */
export function workerChrome(): WorkerChrome {
	return {
		apis: chromeApis(),
		openTab: (url) => chrome.tabs.create({ url }),
		openOptionsPage: () => chrome.runtime.openOptionsPage(),
		onInstalled: chrome.runtime.onInstalled,
		onStartup: chrome.runtime.onStartup,
		onPermissionsAdded: chrome.permissions.onAdded,
		onPermissionsRemoved: chrome.permissions.onRemoved,
		onActionClicked: chrome.action.onClicked,
	};
}

/**
 * Open a tab from an extension page.
 *
 * @param {string} url Where.
 */
export function openTab(url: string): void {
	void chrome.tabs.create({ url });
}
