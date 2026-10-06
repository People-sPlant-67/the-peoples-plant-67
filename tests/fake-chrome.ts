/**
 * A fake Chrome for the extension tests: permission, storage and scripting state held in memory,
 * with every request, removal and (un)registration logged in `calls`.
 */
import type { ChromeApis, ContentScript } from '../src/extension/registry';

/**
 * Make a fake Chrome.
 *
 * @param {object} opts Behaviour.
 * @param {boolean | Error} [opts.grant] What the permission prompt answers: false refuses, an Error throws.
 * @returns The fake and its state.
 */
export function fakeChrome(opts: { grant?: boolean | Error } = {}) {
	const store = new Map<string, unknown>();
	const granted = new Set<string>();
	const scripts = new Map<string, ContentScript>();
	const calls: string[] = [];
	const c: ChromeApis = {
		storage: {
			get: async (k) => (store.has(k) ? { [k]: store.get(k) } : {}),
			set: async (items) => { for (const [k, v] of Object.entries(items)) store.set(k, v); },
			remove: async (k) => { store.delete(k); },
		},
		permissions: {
			contains: async ({ origins }) => origins.every((o) => granted.has(o)),
			request: async ({ origins }) => {
				calls.push(`request ${origins}`);
				if (opts.grant instanceof Error) throw opts.grant;
				if (opts.grant === false) return false;
				origins.forEach((o) => granted.add(o));
				return true;
			},
			remove: async ({ origins }) => { calls.push(`remove ${origins}`); origins.forEach((o) => granted.delete(o)); return true; },
		},
		scripting: {
			getRegisteredContentScripts: async ({ ids }) => ids.flatMap((id) => (scripts.has(id) ? [structuredClone(scripts.get(id)!)] : [])),
			registerContentScripts: async (list) => {
				for (const s of list) {
					if (scripts.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
					scripts.set(s.id, s);
				}
				calls.push('register');
			},
			unregisterContentScripts: async ({ ids }) => { ids.forEach((id) => scripts.delete(id)); calls.push('unregister'); },
		},
	};
	return { c, store, granted, scripts, calls };
}

