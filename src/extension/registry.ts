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
		getAll(): Promise<{ origins?: string[] }>;
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
 * Remove the plant's content script, if it is registered. Chrome saying it is already gone
 * counts as done.
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
 * Register the plant's content script for an origin, replacing any registration for another.
 *
 * @param {ChromeApis} c Chrome.
 * @param {string} origin A tidied origin.
 */
async function register(c: ChromeApis, origin: string): Promise<void> {
	const want = contentMatches(origin);
	const [have] = await c.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
	if (have && have.matches?.length === want.length && want.every((m) => have.matches?.includes(m))) return;
	if (have) await unregister(c);
	await c.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: want, js: ['cockpit.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
}

/** A single-host pattern, the only kind the plant asks for. "On all sites" and the like are not. */
const ONE_HOST = /^https?:\/\/[^*/]+\/\*$/;

/**
 * Give back every single-host permission except the one for `keep`. That covers the old
 * address on a change, and anything left over when a tab closed halfway through connecting.
 * Wider grants someone chose in Chrome's own settings are left alone. Chrome refuses for a
 * permission the manifest requires; that is not ours to give back, so it is not an error here.
 *
 * @param {ChromeApis} c Chrome.
 * @param {string | null} keep The origin whose permission stays, or null for none.
 */
async function giveBackOthers(c: ChromeApis, keep: string | null): Promise<void> {
	const kept = keep ? permissionOrigins(keep)[0] : null;
	const { origins = [] } = await c.permissions.getAll();
	const extra = origins.filter((o) => ONE_HOST.test(o) && o !== kept);
	for (const o of extra) await c.permissions.remove({ origins: [o] }).catch(() => false);
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
 * it, then give back every other site's permission. If registering fails, the old address keeps
 * its registration and its grant, and the new grant is given back.
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
			// Registering may have removed the old address's script on the way; put it back.
			if (old) await register(c, old).catch(() => undefined);
			await giveBackOthers(c, old);
			throw err;
		}
		await c.storage.set({ [ORIGIN_KEY]: origin });
		await giveBackOthers(c, origin);
	});
}

/**
 * Forget the address: unregister the plant, clear the saved origin and give back every site's
 * permission.
 *
 * @param {ChromeApis} c Chrome.
 * @returns {Promise<void>} Resolves once disconnected.
 */
export function disconnect(c: ChromeApis): Promise<void> {
	return c.lock(async () => {
		await unregister(c);
		await c.storage.remove(ORIGIN_KEY);
		await giveBackOthers(c, null);
	});
}

/**
 * Make Chrome match the saved address: registered while the address is saved and permitted,
 * unregistered otherwise. An address whose permission was taken away in Chrome's settings is
 * kept, so the options page can say what happened and granting it again brings the plant back.
 * It gives nothing back: a page may be between Chrome's prompt and its connect.
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

/**
 * What answered a knock. `moved`: the address sends visitors on to `to`, on the same site.
 * `redirect`: it sends them somewhere this extension may not look; `guess` is a likely new
 * address for Paperclip that answered when tried.
 */
export type Answer =
	| { kind: 'paperclip' | 'signin' | 'other' | 'silent' }
	| { kind: 'moved'; to: string }
	| { kind: 'redirect'; guess?: string };

/**
 * Whether two host names are the same site give or take a leading "www.".
 *
 * @param {string} a Host name.
 * @param {string} b Host name.
 * @returns {boolean} True when they match.
 */
const sameSite = (a: string, b: string): boolean => a.replace(/^www\./, '') === b.replace(/^www\./, '');

/**
 * Where Paperclip may have moved to from an origin: https for an http address, and the same
 * address with or without "www.".
 *
 * @param {string} origin A tidied origin.
 * @returns {string[]} Origins to try, most likely first.
 */
export function likelyMoves(origin: string): string[] {
	const u = new URL(origin);
	const port = u.port ? `:${u.port}` : '';
	const out: string[] = [];
	if (u.protocol === 'http:') out.push(`https://${u.hostname}`, `https://${u.hostname}${port}`);
	if (!/^[\d.]+$/.test(u.hostname) && u.hostname.includes('.')) {
		const other = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
		out.push(`${u.protocol}//${other}${port}`);
	}
	return [...new Set(out)].filter((o) => o !== origin);
}

/**
 * One request with its own time limit.
 *
 * @param {typeof fetch} fetchImpl fetch.
 * @param {string} url Where.
 * @param {RequestInit} init Options.
 * @param {number} ms Time limit.
 * @param {(r: Response) => Promise<T>} read What to read from the reply within the limit.
 * @returns {Promise<{ r: Response, v: T } | null>} The reply and what was read, or null on any failure.
 */
async function timed<T>(fetchImpl: typeof fetch, url: string, init: RequestInit, ms: number, read: (r: Response) => Promise<T>): Promise<{ r: Response; v: T } | null> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), ms);
	try {
		const r = await fetchImpl(url, { ...init, signal: ctl.signal });
		return { r, v: await read(r) };
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Knock on the plant's door: what answers at <origin>/api/plant-67? The knock carries no cookies.
 *
 * - Paperclip answers its JSON 404 ({"error": ...}).
 * - A 401 or 403 is a sign-in in front of Paperclip.
 * - A redirect is followed once. Chrome lets this extension read where it lands only within the
 *   granted scheme and host. Landing on the same site at another origin (another port) means
 *   the address moved; landing on the same origin (a /login page) is a sign-in. If the landing
 *   cannot be read (http to https, a "www.", a sign-in service elsewhere), the likely new homes
 *   are tried, without reading them: one that answers is offered as a guess.
 * - Anything else is some other server, and silence (nothing listening, a bad name, a timeout)
 *   is nobody.
 *
 * @param {typeof fetch} fetchImpl fetch.
 * @param {string} origin A tidied origin.
 * @param {number} [ms] Time limit for each request.
 * @returns {Promise<Answer>} Who answered.
 */
export async function knock(fetchImpl: typeof fetch, origin: string, ms = 5000): Promise<Answer> {
	const base: RequestInit = { credentials: 'omit', cache: 'no-store' };
	const first = await timed(fetchImpl, plantUrl(origin), { ...base, redirect: 'manual' }, ms, async (r) =>
		r.status === 404 && /json/i.test(r.headers.get('content-type') ?? '') ? ((await r.json().catch(() => null)) as unknown) : null);
	if (!first) return { kind: 'silent' };
	const { r, v: body } = first;
	if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) {
		const followed = await timed(fetchImpl, plantUrl(origin), { ...base, redirect: 'follow' }, ms, async () => null);
		if (followed?.r.url) {
			const to = new URL(followed.r.url);
			return to.origin !== origin && sameSite(to.hostname, new URL(origin).hostname) ? { kind: 'moved', to: to.origin } : { kind: 'signin' };
		}
		for (const guess of likelyMoves(origin)) {
			if (await timed(fetchImpl, plantUrl(guess), { ...base, mode: 'no-cors' }, ms, async () => null)) return { kind: 'redirect', guess };
		}
		return { kind: 'redirect' };
	}
	if (r.status === 401 || r.status === 403) return { kind: 'signin' };
	if (r.status !== 404 || !body || typeof body !== 'object' || typeof (body as { error?: unknown }).error !== 'string') return { kind: 'other' };
	return { kind: 'paperclip' };
}
