/**
 * Keeping Chrome in step with the one Paperclip address the plant is connected to: the host
 * permission, the content script registered on <origin>/api/plant-67, and the saved address.
 * The options page calls connect/disconnect; the background worker calls sync whenever Chrome
 * starts, the extension updates, or someone removes the permission in Chrome's settings.
 *
 * Chrome's APIs are passed in (the ChromeApis subset below), so this runs under test with a fake.
 * The only thing stored is the address. No tokens, no passwords.
 */
import { contentMatches, permissionOrigins, plantUrl } from './connect';

/** The content script's registration id. */
export const SCRIPT_ID = 'plant-67';
/** The storage key for the connected origin. */
export const ORIGIN_KEY = 'plant67.origin';

/** A registered content script, as much of it as the plant uses. */
export interface ContentScript {
	id: string;
	matches?: string[];
	js?: string[];
	runAt?: 'document_idle' | 'document_start' | 'document_end';
	persistAcrossSessions?: boolean;
}

/** The parts of chrome.* the plant uses. */
export interface ChromeApis {
	storage: {
		get(key: string): Promise<Record<string, unknown>>;
		set(items: Record<string, unknown>): Promise<void>;
		remove(key: string): Promise<void>;
	};
	permissions: {
		contains(p: { origins: string[] }): Promise<boolean>;
		request(p: { origins: string[] }): Promise<boolean>;
		remove(p: { origins: string[] }): Promise<boolean>;
	};
	scripting: {
		getRegisteredContentScripts(filter: { ids: string[] }): Promise<ContentScript[]>;
		registerContentScripts(scripts: ContentScript[]): Promise<void>;
		unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
	};
}

/**
 * The connected origin, if any.
 *
 * @param {ChromeApis} c Chrome.
 * @returns {Promise<string | null>} The origin, or null.
 */
export async function savedOrigin(c: ChromeApis): Promise<string | null> {
	const v = (await c.storage.get(ORIGIN_KEY))[ORIGIN_KEY];
	return typeof v === 'string' && v ? v : null;
}

/**
 * Remove the plant's content script, if it is registered.
 *
 * @param {ChromeApis} c Chrome.
 */
async function unregister(c: ChromeApis): Promise<void> {
	if ((await c.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length) await c.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
}

/**
 * Register the plant's content script for an origin, replacing any registration for another.
 *
 * @param {ChromeApis} c Chrome.
 * @param {string} origin A tidied origin.
 */
async function register(c: ChromeApis, origin: string): Promise<void> {
	const want = contentMatches(origin);
	const [have] = await c.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
	if (have && have.matches?.length === want.length && want.every((m) => have.matches?.includes(m))) return;
	if (have) await c.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
	await c.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: want, js: ['cockpit.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
}

/**
 * Ask Chrome for the permission. This must be the first thing a click handler awaits: Chrome
 * only shows the prompt while the click still counts as the user's own gesture.
 *
 * @param {ChromeApis} c Chrome.
 * @param {string} origin A tidied origin.
 * @returns {Promise<boolean>} Whether Chrome granted it.
 */
export function requestAccess(c: ChromeApis, origin: string): Promise<boolean> {
	return c.permissions.request({ origins: permissionOrigins(origin) });
}

/**
 * Finish connecting once the permission is granted: drop the old address's permission, save the
 * new one and register the plant on it.
 *
 * @param {ChromeApis} c Chrome.
 * @param {string} origin A tidied origin Chrome has just granted.
 */
export async function connect(c: ChromeApis, origin: string): Promise<void> {
	const old = await savedOrigin(c);
	// Save first: if registering fails, sync can still finish the job on the next start.
	await c.storage.set({ [ORIGIN_KEY]: origin });
	await register(c, origin);
	if (old && !sameHost(old, origin)) await c.permissions.remove({ origins: permissionOrigins(old) }).catch(() => false);
}

/**
 * Whether two origins share a scheme and host name. A pattern without a port covers every port,
 * so giving back the old host's permission would also take away the new one's.
 *
 * @param {string} a Origin.
 * @param {string} b Origin.
 * @returns {boolean} True when they share scheme and host name.
 */
function sameHost(a: string, b: string): boolean {
	const x = new URL(a), y = new URL(b);
	return x.protocol === y.protocol && x.hostname === y.hostname;
}

/**
 * Forget the address: unregister the plant, give the permission back, clear the saved origin.
 *
 * @param {ChromeApis} c Chrome.
 */
export async function disconnect(c: ChromeApis): Promise<void> {
	const origin = await savedOrigin(c);
	await unregister(c);
	await c.storage.remove(ORIGIN_KEY);
	if (origin) await c.permissions.remove({ origins: permissionOrigins(origin) }).catch(() => false);
}

/**
 * Make Chrome match the saved address. Registered if the address is saved and still permitted;
 * otherwise nothing is registered, and an address whose permission was taken away is forgotten.
 *
 * @param {ChromeApis} c Chrome.
 * @returns {Promise<string | null>} The origin the plant is registered on, or null.
 */
export async function sync(c: ChromeApis): Promise<string | null> {
	const origin = await savedOrigin(c);
	if (origin && (await c.permissions.contains({ origins: permissionOrigins(origin) }))) {
		await register(c, origin);
		return origin;
	}
	await unregister(c);
	if (origin) await c.storage.remove(ORIGIN_KEY);
	return null;
}

/**
 * Knock on the plant's door: does anything answer at <origin>/api/plant-67? Any HTTP reply
 * counts, a 404 or a sign-in redirect included, so this does not depend on any Paperclip route.
 * Only silence (nothing listening, a bad name, a timeout) is a no.
 *
 * @param {typeof fetch} fetchImpl fetch.
 * @param {string} origin A tidied origin.
 * @param {number} [ms] How long to wait.
 * @returns {Promise<boolean>} Whether something answered.
 */
export async function knock(fetchImpl: typeof fetch, origin: string, ms = 5000): Promise<boolean> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), ms);
	try {
		await fetchImpl(plantUrl(origin), { credentials: 'omit', cache: 'no-store', redirect: 'manual', signal: ctl.signal });
		return true;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}
