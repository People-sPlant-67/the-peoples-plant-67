/**
 * Fetch for the bridge's page. The plant's key never leaves the tab: each request is signed with
 * it, and each answer must be signed back. When the plant stops, another program can take its
 * port; it learns nothing it could sign with, the page believes nothing it says, and the owner's
 * words never reach it.
 *
 * - Each request carries a fresh nonce, the time, and its signature (see requestSignature). The
 *   answer must carry the bridge's signature for that nonce, its status and its body (see
 *   answerSignature). An answer without it ends the tab's line for good: nothing more is sent.
 * - A 401 means the plant no longer knows this tab's key (it started again, with a new one). It
 *   stays refused, with the plant's own words, and nothing more is sent.
 * - A request that fails outright (a blip, a stopped plant) ends nothing, but the next request
 *   is a check first: a signed GET /api/plant-bridge, which carries none of the owner's words.
 *   Only a signed answer to it lets the page carry on.
 * - Anything that sends (a directive, a reply) makes that check first too, every time, so the
 *   owner's words go to the plant; only the last save of the page's choices, as the page goes
 *   away, is sent at once (sendNow).
 */
import { answerSignature, requestSignature } from '../bridge/proof';
import { AUTH_HEADER, NONCE_HEADER, OLD_KEY, PROOF_HEADER, TIME_HEADER } from '../bridge/words';

/** The state of the tab's line to the bridge. */
export type Line = 'live' | 'refused' | 'gone';

export interface BridgeFetch {
	fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
	/**
	 * Send at once, without the check first, while the line is good: for the last save as the
	 * page goes away, which cannot wait for two round trips. The answer is still checked.
	 */
	sendNow: (input: string, init?: RequestInit) => Promise<Response>;
	line(): Line;
}

/**
 * A fresh nonce.
 *
 * @returns 32 hex characters.
 */
function nonce(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The path and query a server sees for a URL the page fetches.
 *
 * @param input URL as given to fetch.
 * @returns Path and query.
 */
function pathOf(input: string): string {
	const u = new URL(input, typeof location === 'undefined' ? 'http://plant.localhost' : location.origin);
	return `${u.pathname}${u.search}`;
}

/**
 * Make the page's fetch.
 *
 * @param key The plant's key, or null when the tab has none.
 * @param base The fetch to wrap.
 * @param onEnd Called once, when the line ends (the plant refused this tab, or something else answered).
 * @returns The fetch, and the state of the line.
 */
export function createBridgeFetch(key: string | null, base: typeof fetch = fetch, onEnd: () => void = () => {}): BridgeFetch {
	let line: Line = 'live';
	/** Set after a request failed outright: the next one checks the plant first. */
	let suspect = false;
	const end = (to: Line): void => { if (line === 'live') { line = to; onEnd(); } };
	const refused = (): Response => new Response(JSON.stringify({ error: OLD_KEY }), { status: 401, headers: { 'Content-Type': 'application/json' } });
	const cut = (): never => { end('gone'); throw new TypeError('Something other than the plant answered.'); };
	/**
	 * One signed request, its answer checked.
	 *
	 * @param input URL.
	 * @param init Request options.
	 * @returns The plant's answer.
	 */
	const signed = async (input: string, init?: RequestInit): Promise<Response> => {
		if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') throw new TypeError('The plant takes text bodies only.');
		const method = (init?.method ?? 'GET').toUpperCase();
		const n = nonce(), time = Date.now();
		const headers = new Headers(init?.headers);
		headers.set(NONCE_HEADER, n);
		headers.set(TIME_HEADER, String(time));
		if (key) headers.set(AUTH_HEADER, requestSignature(key, n, time, method, pathOf(input), (init?.body as string | undefined) ?? ''));
		let r: Response;
		try {
			r = await base(input, { ...init, headers });
		} catch (err) {
			suspect = true;
			throw err;
		}
		// The plant that refuses a tab's signature cannot sign with that tab's key: a 401 is never
		// signed, and whatever sent it does not get to write the page's words.
		if (r.status === 401) { end('refused'); return refused(); }
		if (!key || r.headers.get(PROOF_HEADER) !== answerSignature(key, n, r.status, await r.clone().text())) cut();
		return r;
	};
	const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
		if (line === 'gone') throw new TypeError('The plant has stopped.');
		if (line === 'refused') return refused();
		const method = (init?.method ?? 'GET').toUpperCase();
		// The check and what follows are two requests: a program could only take the port between
		// them if the plant stopped in that moment.
		if (suspect || (method !== 'GET' && method !== 'HEAD')) {
			const check = await signed('/api/plant-bridge');
			if (line !== 'live') return fetchImpl(input, init);
			if (!check.ok) cut();
			suspect = false;
		}
		return signed(input, init);
	};
	const sendNow = (input: string, init?: RequestInit): Promise<Response> => (line === 'live' && !suspect ? signed(input, init) : fetchImpl(input, init));
	return { fetchImpl, sendNow, line: () => line };
}
