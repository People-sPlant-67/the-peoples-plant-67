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
	empty: 'Type the address you open Paperclip at first.',
	scheme: 'Only web addresses work here. They start with https:// or http://.',
	shape: 'That is not a web address. Try paperclip.example.com or localhost:3100.',
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** A DNS label: letters, digits and inner hyphens. */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Whether a host name is on this computer or the local network, where Paperclip usually runs
 * without a certificate. Those default to http; everything else defaults to https.
 *
 * @param {string} name Lower-case host name, no port.
 * @returns {boolean} True for local names and bare IPv4 addresses.
 */
export function isLocalName(name: string): boolean {
	return name === 'localhost' || IPV4.test(name) || /\.(localhost|local|test|internal|lan|home\.arpa)$/.test(name);
}

/**
 * Tidy what someone typed into an origin. Accepts a bare host ("paperclip.example.com"), a host
 * and port ("localhost:3100"), or a full URL with any path, which is dropped.
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
	const hostPort = rest.split(/[/?#]/)[0].toLowerCase();
	const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(hostPort);
	if (!m) return { ok: false, error: 'shape' };
	const name = m[1].replace(/\.$/, '');
	const port = m[2];
	if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return { ok: false, error: 'shape' };
	const ip = IPV4.exec(name);
	if (ip) {
		if (ip.slice(1).some((o) => Number(o) > 255)) return { ok: false, error: 'shape' };
	} else {
		const labels = name.split('.');
		if (!labels.every((l) => LABEL.test(l))) return { ok: false, error: 'shape' };
		// A single word could be anything; only localhost is a real address on its own.
		if (labels.length < 2 && name !== 'localhost') return { ok: false, error: 'shape' };
	}
	scheme ??= isLocalName(name) ? 'http' : 'https';
	const defaultPort = scheme === 'http' ? '80' : '443';
	const portPart = port !== undefined && String(Number(port)) !== defaultPort ? `:${Number(port)}` : '';
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
 * The host permission to ask Chrome for. Chrome grants hosts, not paths, so this is the whole
 * origin; the content script itself only runs on the plant's path.
 *
 * @param {string} origin A tidied origin.
 * @returns {string[]} Permission origins.
 */
export function permissionOrigins(origin: string): string[] {
	return [`${origin}/*`];
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
