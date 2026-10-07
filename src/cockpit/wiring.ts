/**
 * How to wire Claude Code and Codex to the bridge, as the plant says it: on screen while the
 * plant has drawn nobody, and on the bridge's Connect page. The bridge knows its own folder, so
 * it hands over the exact commands (with --dir when the plant runs elsewhere), and anything
 * wrong with the wiring it found, such as a hook whose Node has gone.
 */
import type { Wiring } from '../bridge/words';
import type { FetchLike } from '../live/http';
import { get } from '../live/http';
import { el } from './dom';

export type { Wiring } from '../bridge/words';

/**
 * Ask the bridge how to wire it.
 *
 * @param f Fetch.
 * @returns Wiring, or null when the bridge did not say (the note then says where to look).
 */
export async function readWiring(f: FetchLike): Promise<Wiring | null> {
	const g = await get(f, '/api/plant-bridge/wiring');
	if (!g.ok || !g.body || typeof g.body !== 'object') return null;
	const o = g.body as Record<string, unknown>;
	const str = (v: unknown): string | null => (typeof v === 'string' && v.length < 600 ? v : null);
	const start = str(o.start), claude = str(o.claude), codex = str(o.codex);
	if (!start || !claude || !codex) return null;
	return {
		start, claude, codex,
		warnings: Array.isArray(o.warnings) ? o.warnings.filter((w): w is string => typeof w === 'string' && w.length < 600).slice(0, 4) : [],
	};
}

/**
 * The note for a plant with nobody on it: the one step that fixes it, commands set apart so
 * they copy whole.
 *
 * @param w Wiring, or null when the bridge did not say.
 * @param cls Class for the paragraph.
 * @returns Paragraph.
 */
export function wiringNote(w: Wiring | null, cls: string): HTMLElement {
	const p = el('p', cls);
	if (!w) {
		p.append(document.createTextNode('No agents yet. Wire Claude Code or Codex with the hooks commands the plant printed in its terminal, then start a new session in a project folder.'));
		return p;
	}
	// Each command on a line of its own, so a long folder path is never cut off.
	p.append(
		document.createTextNode('No agents yet. In a second terminal, wire Claude Code:'), el('code', 'p67-cmd', w.claude),
		document.createTextNode('Or wire Codex:'), el('code', 'p67-cmd', w.codex),
		document.createTextNode('Then type /hooks in Codex and trust the plant\'s hooks. Start a new session in a project folder, and it appears here.'),
	);
	return p;
}
