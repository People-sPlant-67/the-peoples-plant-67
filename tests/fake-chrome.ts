/**
 * A fake Chrome for the extension tests: permission, storage and scripting state held in memory,
 * with every request, removal and (un)registration logged in `calls`.
 *
 * Permissions follow Chrome's coverage rule for the patterns the plant uses
 * (`scheme://host[:port]/*`): a grant covers a pattern when the scheme and host match (or are
 * `*`) and the grant has no port or the same port. Asking for a covered pattern is granted
 * without adding anything, as Chrome does. Removal takes exact patterns only, and a pattern the
 * manifest requires cannot be removed. Unregistering an unknown script id throws, as in Chrome.
 */
import type { ChromeApis, ContentScript } from '../src/extension/registry';

/**
 * Split a host pattern.
 *
 * @param {string} p Pattern such as http://localhost:3100/*.
 * @returns {{ scheme: string, host: string, port: string | undefined }} Its parts.
 */
function parts(p: string): { scheme: string; host: string; port: string | undefined } {
	const m = /^(\*|https?):\/\/([^/:]+)(?::(\d+))?\/\*$/.exec(p);
	if (!m) throw new Error(`Invalid host pattern: ${p}`);
	return { scheme: m[1], host: m[2], port: m[3] };
}

/**
 * Whether a granted pattern covers a requested one.
 *
 * @param {string} grant Granted pattern.
 * @param {string} want Requested pattern.
 * @returns {boolean} True when covered.
 */
export function covers(grant: string, want: string): boolean {
	const g = parts(grant), w = parts(want);
	return (g.scheme === '*' || g.scheme === w.scheme) && (g.host === '*' || g.host === w.host) && (g.port === undefined || g.port === w.port);
}

/**
 * Make a fake Chrome.
 *
 * @param {object} opts Behaviour.
 * @param {boolean | Error} [opts.grant] What the permission prompt answers: false refuses, an Error throws.
 * @param {string[]} [opts.required] Patterns the manifest grants and that cannot be removed.
 * @returns The fake, its state, its call log and a switch to make the next registration fail.
 */
export function fakeChrome(opts: { grant?: boolean | Error; required?: string[] } = {}) {
	const store = new Map<string, unknown>();
	const granted = new Set<string>(opts.required ?? []);
	const required = new Set(opts.required ?? []);
	const scripts = new Map<string, ContentScript>();
	const calls: string[] = [];
	const isCovered = (p: string): boolean => [...granted].some((g) => covers(g, p));
	let failRegister: Error | null = null;
	const c: ChromeApis = {
		storage: {
			get: async (k) => (store.has(k) ? { [k]: store.get(k) } : {}),
			set: async (items) => { for (const [k, v] of Object.entries(items)) store.set(k, v); },
			remove: async (k) => { store.delete(k); },
		},
		permissions: {
			contains: async ({ origins }) => origins.every(isCovered),
			request: async ({ origins }) => {
				calls.push(`request ${origins}`);
				if (opts.grant instanceof Error) throw opts.grant;
				if (opts.grant === false) return false;
				origins.filter((o) => !isCovered(o)).forEach((o) => granted.add(o));
				return true;
			},
			remove: async ({ origins }) => {
				calls.push(`remove ${origins}`);
				if (origins.some((o) => required.has(o))) throw new Error('You cannot remove required permissions.');
				let any = false;
				origins.forEach((o) => { any = granted.delete(o) || any; });
				return any;
			},
		},
		scripting: {
			getRegisteredContentScripts: async ({ ids }) => ids.flatMap((id) => (scripts.has(id) ? [structuredClone(scripts.get(id)!)] : [])),
			registerContentScripts: async (list) => {
				if (failRegister) {
					const e = failRegister;
					failRegister = null;
					throw e;
				}
				for (const s of list) {
					if (scripts.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
					scripts.set(s.id, s);
				}
				calls.push('register');
			},
			unregisterContentScripts: async ({ ids }) => {
				for (const id of ids) if (!scripts.has(id)) throw new Error(`Nonexistent script ID '${id}'`);
				ids.forEach((id) => scripts.delete(id));
				calls.push('unregister');
			},
		},
	};
	return {
		c, store, granted, scripts, calls,
		/** Make the next registration throw this error. */
		failNextRegister: (e: Error): void => { failRegister = e; },
	};
}
