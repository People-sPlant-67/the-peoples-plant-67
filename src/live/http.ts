/**
 * Same-origin requests to Paperclip, shared by the poller (GETs) and the chat (POSTs). Each
 * request rides on the browser's own sign-in to Paperclip (and to any access gateway in front of it), never follows a
 * redirect, and turns any failure into the session state it implies.
 */
import type { Session } from './types';

/** The slice of a fetch Response the plant reads. Lets tests and the mock skip real Responses. */
export interface ResponseLike {
	type: string;
	status: number;
	ok: boolean;
	text(): Promise<string>;
}

/** Minimal fetch signature. The real `fetch` satisfies it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<ResponseLike>;

/** Outcome of one request: parsed JSON, or the session state its failure implies. */
export type Got =
	| { ok: true; body: unknown }
	| { ok: false; session: Exclude<Session, 'ok'>; status: number; detail: string | null };

/** A failed call: the session state it implies, plus Paperclip's own reason if it gave one. */
export type Failure = Extract<Got, { ok: false }>;

/**
 * Carry a failed request over as a Failure, without the rest of the Got.
 *
 * @param g Failed request.
 * @returns Failure.
 */
export function fail(g: Failure): Failure {
	return { ok: false, session: g.session, status: g.status, detail: g.detail };
}

/** Longest the plant waits for Paperclip before treating a request as unanswered. */
export const TIMEOUT_MS = 20_000;

/** Only a UUID goes into a request path, so a crafted id cannot steer a credentialed request elsewhere. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pull a short human reason out of an error body such as {"error": "Issue not found"}.
 *
 * @param text Raw body text.
 * @returns The reason, at most 300 characters, or null.
 */
function reasonOf(text: string): string | null {
	try {
		const b = JSON.parse(text) as Record<string, unknown>;
		const e = b && typeof b === 'object' ? (b.error ?? b.message) : null;
		return typeof e === 'string' && e.trim() ? e.trim().slice(0, 300) : null;
	} catch {
		return null;
	}
}

/**
 * Make one same-origin request. Redirects are not followed: with an access gateway in front
 * (Cloudflare Access, say), a redirect means the sign-in lapsed, and following it would return the login page as data.
 *
 * @param fetchImpl Fetch to use.
 * @param method GET or POST.
 * @param path Path starting with /api/.
 * @param body Body for a POST: sent as JSON, or as it is when it is FormData (a file upload,
 *   whose multipart boundary the browser sets).
 * @returns Parsed body, or the session state the failure implies.
 */
export async function request(fetchImpl: FetchLike, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Got> {
	const init: RequestInit = { method, credentials: 'same-origin', redirect: 'manual', headers: { accept: 'application/json' } };
	if (method === 'POST' && typeof FormData !== 'undefined' && body instanceof FormData) init.body = body;
	else if (method === 'POST') {
		init.headers = { accept: 'application/json', 'content-type': 'application/json' };
		init.body = JSON.stringify(body ?? {});
	}
	let r: ResponseLike;
	const abort = typeof AbortController === 'undefined' ? null : new AbortController();
	if (abort) init.signal = abort.signal;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// A hung request must not leave a window waiting forever: give up after TIMEOUT_MS, counting
	// the body too (a server can send headers and then stall).
	const timeout = new Promise<never>((_, no) => { timer = setTimeout(() => { abort?.abort(); no(new Error('timeout')); }, TIMEOUT_MS); });
	timeout.catch(() => { /* Handled where it is raced; this only keeps an unraced rejection quiet. */ });
	let text = '';
	try {
		try {
			r = await Promise.race([fetchImpl(path, init), timeout]);
		} catch {
			return { ok: false, session: 'unreachable', status: 0, detail: null };
		}
		// Browsers report a manual redirect as an opaque response; Node's fetch hands back the raw 3xx.
		if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return { ok: false, session: 'access-lapsed', status: r.status, detail: null };
		try { text = await Promise.race([r.text(), timeout]); } catch { /* An unreadable or stalled body is handled below as unreadable. */ }
	} finally {
		clearTimeout(timer);
	}
	if (r.status === 401 || r.status === 403) return { ok: false, session: 'signed-out', status: r.status, detail: reasonOf(text) };
	if (!r.ok) return { ok: false, session: 'unreachable', status: r.status, detail: reasonOf(text) };
	try {
		return { ok: true, body: JSON.parse(text) };
	} catch {
		return { ok: false, session: 'unreachable', status: r.status, detail: null };
	}
}

/**
 * GET a same-origin path.
 *
 * @param fetchImpl Fetch to use.
 * @param path Path starting with /api/.
 * @returns Parsed body or failure.
 */
export function get(fetchImpl: FetchLike, path: string): Promise<Got> {
	return request(fetchImpl, 'GET', path);
}
