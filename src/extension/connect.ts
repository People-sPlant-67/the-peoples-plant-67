/**
 * Where the plant lives: turning what someone types into a Paperclip origin, and the patterns
 * Chrome needs for it. Pure, so it is tested without a browser.
 *
 * The plant opens on <origin>/api/plant-67, a small JSON 404 from Paperclip that the content
 * script replaces (see src/cockpit/extension-entry.ts).
 */

/** The path the plant takes over on the Paperclip host. */
export const PLANT_PATH = '/api/plant-67';

/** Why an address was refused. */
export type AddressError = 'empty' | 'scheme' | 'shape';

/** The result of tidying an address: an origin such as https://paperclip.example.com, or why not. */
export type Tidied = { ok: true; origin: string } | { ok: false; error: AddressError };

/** Words for each refusal, in the owner's voice. */
export const ADDRESS_ERRORS: Record<AddressError, string> = {
	empty: 'First, type the address you open Paperclip at.',
	scheme: 'Only web addresses work here. They start with https:// or http://.',
	shape: 'That is not a web address. Try paperclip.example.com or localhost:3100.',
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** A host-name label: letters, digits, underscores and inner hyphens. */
const LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;

/**
 * Whether a host is on this computer or the local network, where Paperclip usually runs without
 * a certificate. Those default to http; everything else, public IP addresses included, to https.
 *
 * @param {string} name A canonical host name, no port.
 * @returns {boolean} True for local names, single-word names and private or loopback IPv4.
 */
export function isLocalName(name: string): boolean {
	const ip = IPV4.exec(name);
	if (ip) {
		const [a, b] = [Number(ip[1]), Number(ip[2])];
		return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
	}
	return !name.includes('.') || /(^|\.)(localhost|local|test|internal|lan|home\.arpa)$/.test(name);
}

/**
 * Tidy what someone typed into an origin. Accepts a bare host ("paperclip.example.com"), a host
 * and port ("localhost:3100"), or a full URL with any path, which is dropped. The host goes
 * through the browser's own URL parser, so it comes out the way Chrome will see it: lower case,
 * international names in punycode, odd IP forms such as 0x7f.1 written out.
 *
 * @param {string} raw What was typed.
 * @returns {Tidied} The origin, or why it was refused.
 */
export function tidyAddress(raw: string): Tidied {
	const s = raw.trim();
	if (!s) return { ok: false, error: 'empty' };
	let scheme: string | null = null;
	let rest = s;
	const full = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
	if (full) {
		scheme = full[1].toLowerCase();
		if (scheme !== 'http' && scheme !== 'https') return { ok: false, error: 'scheme' };
		rest = s.slice(full[0].length);
	} else {
		// "localhost:3100" is a host and port; "javascript:..." or "mailto:..." is a scheme.
		const bare = /^([a-z][a-z0-9+-]*):(?!\d+(?:[/?#]|$))/i.exec(s);
		if (bare && bare[1].toLowerCase() !== 'localhost') return { ok: false, error: /^https?$/i.test(bare[1]) ? 'shape' : 'scheme' };
	}
	const hostPort = rest.split(/[/?#]/)[0];
	// No sign-in details in the address, and no IPv6: neither belongs in a permission prompt.
	const m = /^([^:@[\]]+)(?::(\d{1,5}))?$/.exec(hostPort);
	if (!m) return { ok: false, error: 'shape' };
	const port = m[2] === undefined ? null : Number(m[2]);
	if (port !== null && (port < 1 || port > 65535)) return { ok: false, error: 'shape' };
	let name: string;
	try {
		name = new URL(`http://${m[1]}`).hostname.replace(/\.$/, '');
	} catch {
		return { ok: false, error: 'shape' };
	}
	if (!IPV4.test(name)) {
		const labels = name.split('.');
		if (!labels.every((l) => LABEL.test(l))) return { ok: false, error: 'shape' };
		// A single word on its own could be a typo for anything. With a port or a scheme it is a
		// machine on the network (a Docker or LAN name), and localhost is always one.
		if (labels.length < 2 && name !== 'localhost' && port === null && !scheme) return { ok: false, error: 'shape' };
	}
	// A typed port 80 or 443 says the scheme; otherwise local names get http and the rest https.
	scheme ??= port === 80 ? 'http' : port === 443 ? 'https' : isLocalName(name) ? 'http' : 'https';
	const portPart = port !== null && port !== (scheme === 'http' ? 80 : 443) ? `:${port}` : '';
	return { ok: true, origin: `${scheme}://${name}${portPart}` };
}

/**
 * The page the plant opens on.
 *
 * @param {string} origin A tidied origin.
 * @returns {string} The plant's URL.
 */
export function plantUrl(origin: string): string {
	return origin + PLANT_PATH;
}

/**
 * The host permission to ask Chrome for: the scheme and host, every port. Chrome grants whole
 * hosts and ignores paths, and its prompt names the host alone. Leaving the port out means a
 * port change reuses the same grant, and giving the grant back removes the one pattern the
 * plant asked for. The content script itself only runs on the plant's path on the exact origin.
 *
 * @param {string} origin A tidied origin.
 * @returns {string[]} Permission patterns.
 */
export function permissionOrigins(origin: string): string[] {
	const u = new URL(origin);
	return [`${u.protocol}//${u.hostname}/*`];
}

/**
 * Where the content script runs: the plant's path, with or without a query string (the dev
 * switches such as ?wizard=live ride on it).
 *
 * @param {string} origin A tidied origin.
 * @returns {string[]} Match patterns.
 */
export function contentMatches(origin: string): string[] {
	return [plantUrl(origin), `${plantUrl(origin)}?*`];
}
