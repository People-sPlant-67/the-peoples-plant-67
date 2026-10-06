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
 * Whether the plant's content script is registered on exactly these patterns.
 *
 * @param {ContentScript | undefined} have The registration, if any.
 * @param {string[]} want Match patterns.
 * @returns {boolean} True when it matches.
 */
const registeredOn = (have: ContentScript | undefined, want: string[]): boolean =>
	!!have && have.matches?.length === want.length && want.every((m) => have.matches?.includes(m));

/**
 * Register the plant's content script for an origin, replacing any registration for another.
 * The options page and the background worker can both get here at once; if the other one
 * registered first, its registration is the same one, so that is a success.
 *
 * @param {ChromeApis} c Chrome.
 * @param {string} origin A tidied origin.
 */
async function register(c: ChromeApis, origin: string): Promise<void> {
	const want = contentMatches(origin);
	const [have] = await c.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
	if (registeredOn(have, want)) return;
	if (have) await c.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
	try {
		await c.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: want, js: ['cockpit.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
	} catch (err) {
		const [now] = await c.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
		if (!registeredOn(now, want)) throw err;
	}
}

/**
 * Whether two origins need the same host permission (same scheme and host, any port).
 *
 * @param {string} a Origin.
 * @param {string} b Origin.
 * @returns {boolean} True when one grant covers both.
 */
const samePermission = (a: string, b: string): boolean => permissionOrigins(a)[0] === permissionOrigins(b)[0];

/**
 * Give a host permission back. Chrome refuses for a permission the manifest requires; that is
 * not ours to give back, so it is not an error here.
 *
 * @param {ChromeApis} c Chrome.
 * @param {string} origin A tidied origin.
 */
async function giveBack(c: ChromeApis, origin: string): Promise<void> {
	await c.permissions.remove({ origins: permissionOrigins(origin) }).catch(() => false);
}

/**
 * Ask Chrome for the permission. This must be the first thing a click handler calls: Chrome
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
 * Finish connecting once the permission is granted: register the plant on the new address, save
 * it, then give back the old address's permission. If registering fails, nothing else changes:
 * the old address stays saved and the new permission is given back.
 *
 * @param {ChromeApis} c Chrome.
 * @param {string} origin A tidied origin Chrome has just granted.
 */
export async function connect(c: ChromeApis, origin: string): Promise<void> {
	const old = await savedOrigin(c);
	try {
		await register(c, origin);
	} catch (err) {
		if (!old || !samePermission(old, origin)) await giveBack(c, origin);
		throw err;
	}
	await c.storage.set({ [ORIGIN_KEY]: origin });
	if (old && !samePermission(old, origin)) await giveBack(c, old);
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
	if (origin) await giveBack(c, origin);
}

/**
 * Make Chrome match the saved address: registered while the address is saved and permitted,
 * unregistered otherwise. An address whose permission was taken away in Chrome's settings is
 * kept, so the options page can say what happened and granting it again brings the plant back.
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
	return null;
}

/** What answered a knock. */
export type Answer = 'paperclip' | 'signin' | 'other' | 'silent';

/**
 * Knock on the plant's door: what answers at <origin>/api/plant-67? Paperclip answers its JSON
 * 404 ({"error": ...}). A sign-in in front of it (Cloudflare Access and the like) answers with a
 * redirect or a 401/403, since the knock carries no cookies. Anything else is some other server,
 * and silence (nothing listening, a bad name, a timeout) is nobody.
 *
 * @param {typeof fetch} fetchImpl fetch.
 * @param {string} origin A tidied origin.
 * @param {number} [ms] How long to wait.
 * @returns {Promise<Answer>} Who answered.
 */
export async function knock(fetchImpl: typeof fetch, origin: string, ms = 5000): Promise<Answer> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), ms);
	try {
		const r = await fetchImpl(plantUrl(origin), { credentials: 'omit', cache: 'no-store', redirect: 'manual', signal: ctl.signal });
		if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400) || r.status === 401 || r.status === 403) return 'signin';
		if (r.status !== 404 || !/json/i.test(r.headers.get('content-type') ?? '')) return 'other';
		const body: unknown = await r.json().catch(() => null);
		return body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? 'paperclip' : 'other';
	} catch {
		return 'silent';
	} finally {
		clearTimeout(timer);
	}
}
