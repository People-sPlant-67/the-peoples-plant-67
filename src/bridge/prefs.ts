/**
 * The plant page's own choices (the founding form, the layout, the sound), kept in prefs.json in
 * the plant's folder. The plant's address is new at every start and the browser keeps storage per
 * address, so the page keeps them here instead (see src/cockpit/bridge-prefs.ts).
 *
 * The page sends only what changed, and the bridge merges it into what is on disk: two tabs of
 * one start never undo each other's different choices, and a tab that could not read the
 * choices never wipes them.
 */
import { join } from 'node:path';
import { lstatSync, readFileSync } from 'node:fs';
import { writeAtomic } from './files';

/** Most bytes the kept choices may take (a browser refuses larger keepalive requests). */
export const PREFS_MAX = 60 * 1024;

/** A change the page sends: values to set, and names to remove. */
export interface PrefsChange { set?: Record<string, string>; remove?: string[] }

/** Said when prefs.json is there but cannot be read: nothing is written over it. */
export const UNREADABLE = 'The plant could not read prefs.json in its folder, so it keeps no new choices. Fix that file or delete it, then choose again.';

/**
 * The kept choices.
 *
 * @param dir The plant's folder.
 * @returns Name to value (empty when none are kept yet), or null when the file is there but
 *   cannot be read: then it must not be written over.
 */
export function readPrefs(dir: string): Record<string, string> | null {
	const path = join(dir, 'prefs.json');
	try {
		if (!lstatSync(path).isFile()) return null;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'ENOENT' ? {} : null;
	}
	try {
		const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
		if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
		return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
	} catch {
		return null;
	}
}

/**
 * Whether a body is a change the bridge takes.
 *
 * @param b Parsed body.
 * @returns True for { set?: {name: text}, remove?: [name] } and nothing else.
 */
export function isPrefsChange(b: unknown): b is PrefsChange {
	if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
	const { set, remove, ...rest } = b as Record<string, unknown>;
	if (Object.keys(rest).length) return false;
	if (set !== undefined && (!set || typeof set !== 'object' || Array.isArray(set) || !Object.values(set).every((v) => typeof v === 'string'))) return false;
	return remove === undefined || (Array.isArray(remove) && remove.every((k) => typeof k === 'string'));
}

/**
 * Merge a change into the kept choices.
 *
 * @param dir The plant's folder.
 * @param change What changed.
 * @returns Every kept choice after the change, or null when they would be too big to keep.
 * @throws When the file cannot be read (UNREADABLE) or written.
 */
export function mergePrefs(dir: string, change: PrefsChange): Record<string, string> | null {
	const all = readPrefs(dir);
	if (!all) throw new Error(UNREADABLE);
	for (const k of change.remove ?? []) delete all[k];
	Object.assign(all, change.set ?? {});
	const text = JSON.stringify(all);
	if (Buffer.byteLength(text) > PREFS_MAX) return null;
	writeAtomic(join(dir, 'prefs.json'), text);
	return all;
}
