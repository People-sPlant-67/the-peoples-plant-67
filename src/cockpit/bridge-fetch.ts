/**
 * Fetch for the bridge's page: every request carries the plant's key, and every answer must
 * prove it came from the bridge holding that key. When the plant stops, another program can
 * take its port; the page then trusts nothing it says and sends it nothing that matters.
 *
 * - Each request carries a fresh challenge, and the answer must carry the proof (see proofOf).
 *   An answer without it ends the tab's line for good: nothing more is sent.
 * - A 401 means the plant no longer knows this tab's key (it started again). It stays refused,
 *   so the page keeps saying the tab is out of date, and nothing more is sent.
 * - A request that fails outright (a network blip, a stopped plant) ends nothing: the next one
 *   is tried as usual, and its answer is checked like any other.
 * - Anything that sends (a directive, a reply) first asks the keyless /api/plant-bridge for a
 *   proof. Only the plant gets the owner's words.
 */
import { proofOf } from '../bridge/proof';
import { KEY_HEADER, NONCE_HEADER, PROOF_HEADER } from '../bridge/words';

/** The state of the tab's line to the bridge. */
export type Line = 'live' | 'refused' | 'gone';

export interface BridgeFetch {
	fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
	line(): Line;
}

/**
 * A fresh challenge.
 *
 * @returns 32 hex characters.
 */
function challenge(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Make the page's fetch.
 *
 * @param key The plant's key, or null when the tab has none.
 * @param base The fetch to wrap.
 * @returns The fetch, and the state of the line.
 */
export function createBridgeFetch(key: string | null, base: typeof fetch = fetch): BridgeFetch {
	let line: Line = 'live';
	let refusal = '';
	const proven = (r: Response, nonce: string): boolean => !!key && r.headers.get(PROOF_HEADER) === proofOf(key, nonce);
	const cut = (): never => { line = 'gone'; throw new TypeError('Something other than the plant answered.'); };
	const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
		if (line === 'gone') throw new TypeError('The plant has stopped.');
		if (line === 'refused') return new Response(refusal, { status: 401, headers: { 'Content-Type': 'application/json' } });
		const method = (init?.method ?? 'GET').toUpperCase();
		if (method !== 'GET' && method !== 'HEAD') {
			const n = challenge();
			const check = await base('/api/plant-bridge', { headers: { [NONCE_HEADER]: n } });
			if (!proven(check, n)) cut();
		}
		const n = challenge();
		const headers = new Headers(init?.headers);
		if (key) headers.set(KEY_HEADER, key);
		headers.set(NONCE_HEADER, n);
		const r = await base(input, { ...init, headers });
		if (r.status === 401) {
			line = 'refused';
			refusal = await r.clone().text();
			return r;
		}
		if (!proven(r, n)) cut();
		return r;
	};
	return { fetchImpl, line: () => line };
}
