/**
 * Keeping Chrome in step with the one Paperclip address the plant is connected to: the host
 * permission, the content script registered on <origin>/api/plant-67, and the saved address.
 * The options page calls connect and disconnect, and sync when it opens. The background worker
 * calls sync when Chrome starts, when the extension installs or updates, when the permission is
 * taken away or given back in Chrome's settings, and when the toolbar star is clicked.
 *
 * The options page and the worker run at the same time (granting a permission wakes the worker
 * while the page is still connecting), so connect, disconnect and sync each run whole under one
 * lock both can see. Chrome's APIs and the lock are passed in (ChromeApis), so this runs under
 * test with a fake. The only thing stored is the address. No tokens, no passwords.
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

/** The parts of chrome.* the plant uses, and a lock shared by the options page and the worker. */
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
	/** Run `fn` alone: no other connect, disconnect or sync, in any extension page, runs meanwhile. */
	lock<T>(fn: () => Promise<T>): Promise<T>;
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
 * Remove the plant's content script, if it is registered. Already gone counts as done.
 *
 * @param {ChromeApis} c Chrome.
 */
async function unregister(c: ChromeApis): Promise<void> {
	if (!(await c.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length) return;
	try {
		await c.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
	} catch (err) {
		if ((await c.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length) throw err;
	}
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
 * Callers hold the lock; if something outside it registered the same thing first, that is
 * still a success.
 *
 * @param {ChromeApis} c Chrome.
 * @param {string} origin A tidied origin.
 */
async function register(c: ChromeApis, origin: string): Promise<void> {
	const want = contentMatches(origin);
	const [have] = await c.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
	if (registeredOn(have, want)) return;
	if (have) await unregister(c);
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
 * only shows the prompt while the click still counts as the user's own gesture. It takes no
 * lock for the same reason.
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
 * @returns {Promise<void>} Resolves once connected.
 */
export function connect(c: ChromeApis, origin: string): Promise<void> {
	return c.lock(async () => {
		const old = await savedOrigin(c);
		try {
			await register(c, origin);
		} catch (err) {
			if (!old || !samePermission(old, origin)) await giveBack(c, origin);
			throw err;
		}
		await c.storage.set({ [ORIGIN_KEY]: origin });
		if (old && !samePermission(old, origin)) await giveBack(c, old);
	});
}

/**
 * Forget the address: unregister the plant, give the permission back, clear the saved origin.
 *
 * @param {ChromeApis} c Chrome.
 * @returns {Promise<void>} Resolves once disconnected.
 */
export function disconnect(c: ChromeApis): Promise<void> {
	return c.lock(async () => {
		const origin = await savedOrigin(c);
		await unregister(c);
		await c.storage.remove(ORIGIN_KEY);
		if (origin) await giveBack(c, origin);
	});
}

/**
 * Make Chrome match the saved address: registered while the address is saved and permitted,
 * unregistered otherwise. An address whose permission was taken away in Chrome's settings is
 * kept, so the options page can say what happened and granting it again brings the plant back.
 *
 * @param {ChromeApis} c Chrome.
 * @returns {Promise<string | null>} The origin the plant is registered on, or null.
 */
export function sync(c: ChromeApis): Promise<string | null> {
	return c.lock(async () => {
		const origin = await savedOrigin(c);
		if (origin && (await c.permissions.contains({ origins: permissionOrigins(origin) }))) {
			await register(c, origin);
			return origin;
		}
		await unregister(c);
		return null;
	});
}

/** What answered a knock; `moved` carries the origin the address sends visitors on to. */
export type Answer = { kind: 'paperclip' | 'signin' | 'other' | 'silent' } | { kind: 'moved'; to: string };

/**
 * Whether two host names are the same site give or take a leading "www.".
 *
 * @param {string} a Host name.
 * @param {string} b Host name.
 * @returns {boolean} True when they match.
 */
const sameSite = (a: string, b: string): boolean => a.replace(/^www\./, '') === b.replace(/^www\./, '');

/**
 * Knock on the plant's door: what answers at <origin>/api/plant-67? Paperclip answers its JSON
 * 404 ({"error": ...}). A redirect is followed once to see where it goes. To the same site at a
 * different address (http to https, or a "www."), the address has moved. Anywhere else, or
 * somewhere this extension may not read, it is a sign-in in front of Paperclip (Cloudflare
 * Access and the like), as is a 401 or 403, since the knock carries no cookies. Any other reply
 * is some other server, and silence (nothing listening, a bad name, a timeout) is nobody.
 *
 * @param {typeof fetch} fetchImpl fetch.
 * @param {string} origin A tidied origin.
 * @param {number} [ms] How long to wait in all.
 * @returns {Promise<Answer>} Who answered.
 */
export async function knock(fetchImpl: typeof fetch, origin: string, ms = 5000): Promise<Answer> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), ms);
	const init: RequestInit = { credentials: 'omit', cache: 'no-store', redirect: 'manual', signal: ctl.signal };
	try {
		const r = await fetchImpl(plantUrl(origin), init).catch(() => null);
		if (!r) return { kind: 'silent' };
		if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) {
			const followed = await fetchImpl(plantUrl(origin), { ...init, redirect: 'follow' }).catch(() => null);
			if (followed?.url) {
				const to = new URL(followed.url);
				if (to.origin !== origin && sameSite(to.hostname, new URL(origin).hostname)) return { kind: 'moved', to: to.origin };
			}
			return { kind: 'signin' };
		}
		if (r.status === 401 || r.status === 403) return { kind: 'signin' };
		if (r.status !== 404 || !/json/i.test(r.headers.get('content-type') ?? '')) return { kind: 'other' };
		const body: unknown = await r.json().catch(() => null);
		return { kind: body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? 'paperclip' : 'other' };
	} finally {
		clearTimeout(timer);
	}
}
