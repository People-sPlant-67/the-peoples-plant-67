/**
 * A fake Chrome for the extension tests: permission, storage and scripting state held in memory,
 * with every request, removal and (un)registration logged in `calls`.
 *
 * Permissions follow Chrome's coverage rule for the patterns the plant uses
 * (`scheme://host[:port]/*`): a grant covers a pattern when the scheme and host match (or are
 * `*`) and the grant has no port or the same port. Asking for a covered pattern is granted
 * without adding anything, as Chrome does. Removal takes exact patterns only, and a pattern the
 * manifest requires cannot be removed. Unregistering an unknown script id throws, as in Chrome.
 * A change to the grants fires `permissions.onAdded` or `onRemoved` on the next turn, as Chrome
 * wakes the background worker. `lock` is a real mutex. With `slow`, every Chrome call takes a
 * turn of the event loop, so work in the options page and the worker can interleave.
 */
import type { ChromeEvent } from '../src/extension/chrome';
import type { ChromeApis, ContentScript } from '../src/extension/registry';

/** A fake chrome.* event that can be fired. */
export function event<A extends unknown[] = []>(): ChromeEvent<A> & { fire: (...a: A) => void; count: () => number } {
	const fns: ((...a: A) => void)[] = [];
	return { addListener: (fn) => fns.push(fn), fire: (...a) => fns.forEach((fn) => fn(...a)), count: () => fns.length };
}

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
 * @param {boolean} [opts.slow] Make every Chrome call take a turn of the event loop.
 * @param {number} [opts.eventTurns] How many turns a permission event takes to arrive (default 1).
 * @returns The fake, its state, its call log, its permission events and a switch to make the
 *   next registration fail.
 */
export function fakeChrome(opts: { grant?: boolean | Error; required?: string[]; slow?: boolean; eventTurns?: number } = {}) {
	const store = new Map<string, unknown>();
	const granted = new Set<string>(opts.required ?? []);
	const required = new Set(opts.required ?? []);
	const scripts = new Map<string, ContentScript>();
	const calls: string[] = [];
	const isCovered = (p: string): boolean => [...granted].some((g) => covers(g, p));
	let failRegister: Error | null = null;
	const onAdded = event();
	const onRemoved = event();
	const later = (fn: () => void, n = opts.eventTurns ?? 1): void => void setTimeout(() => (n > 1 ? later(fn, n - 1) : fn()), 0);
	const turn = (): Promise<void> => (opts.slow ? new Promise((r) => setTimeout(r, 0)) : Promise.resolve());
	let tail: Promise<unknown> = Promise.resolve();
	const c: ChromeApis = {
		storage: {
			get: async (k) => { await turn(); return store.has(k) ? { [k]: store.get(k) } : {}; },
			set: async (items) => { await turn(); for (const [k, v] of Object.entries(items)) store.set(k, v); },
			remove: async (k) => { await turn(); store.delete(k); },
		},
		permissions: {
			contains: async ({ origins }) => { await turn(); return origins.every(isCovered); },
			request: async ({ origins }) => {
				calls.push(`request ${origins}`);
				if (opts.grant instanceof Error) throw opts.grant;
				if (opts.grant === false) return false;
				const fresh = origins.filter((o) => !isCovered(o));
				fresh.forEach((o) => granted.add(o));
				if (fresh.length) later(() => onAdded.fire());
				return true;
			},
			remove: async ({ origins }) => {
				calls.push(`remove ${origins}`);
				if (origins.some((o) => required.has(o))) throw new Error('You cannot remove required permissions.');
				let any = false;
				origins.forEach((o) => { any = granted.delete(o) || any; });
				if (any) later(() => onRemoved.fire());
				return any;
			},
		},
		scripting: {
			getRegisteredContentScripts: async ({ ids }) => { await turn(); return ids.flatMap((id) => (scripts.has(id) ? [structuredClone(scripts.get(id)!)] : [])); },
			registerContentScripts: async (list) => {
				await turn();
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
				await turn();
				for (const id of ids) if (!scripts.has(id)) throw new Error(`Nonexistent script ID '${id}'`);
				ids.forEach((id) => scripts.delete(id));
				calls.push('unregister');
			},
		},
		lock: <T>(fn: () => Promise<T>): Promise<T> => {
			const run = tail.then(fn, fn);
			tail = run.catch(() => undefined);
			return run;
		},
	};
	return {
		c, store, granted, scripts, calls, onAdded, onRemoved,
		/** Make the next registration throw this error. */
		failNextRegister: (e: Error): void => { failRegister = e; },
	};
}
