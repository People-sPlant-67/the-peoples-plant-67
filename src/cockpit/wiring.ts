/**
 * How to wire Claude Code and Codex to the bridge, as the plant says it: on screen while the
 * plant has drawn nobody, and on the bridge's Connect page. The bridge knows its own folder, so
 * it hands over the exact commands (with --dir when the plant runs elsewhere), and anything
 * wrong with the wiring it found, such as a hook whose Node has gone.
 */
import type { FetchLike } from '../live/http';
import { get } from '../live/http';
import { el } from './dom';

const NPX = 'npx github:People-sPlant-67/the-peoples-plant-67';

/** The commands for each harness, and sentences about anything wrong. */
export interface Wiring {
	claude: string;
	codex: string;
	warnings: string[];
}

/** For a plant in the default folder, when the bridge has not said. */
export const DEFAULT_WIRING: Wiring = { claude: `${NPX} hooks claude`, codex: `${NPX} hooks codex`, warnings: [] };

/**
 * Ask the bridge how to wire it. Any failure falls back to the default commands.
 *
 * @param f Fetch.
 * @returns Wiring.
 */
export async function readWiring(f: FetchLike): Promise<Wiring> {
	const g = await get(f, '/api/plant-bridge/wiring');
	if (!g.ok || !g.body || typeof g.body !== 'object') return DEFAULT_WIRING;
	const o = g.body as Record<string, unknown>;
	const str = (v: unknown, or: string): string => (typeof v === 'string' && v.length < 600 ? v : or);
	return {
		claude: str(o.claude, DEFAULT_WIRING.claude),
		codex: str(o.codex, DEFAULT_WIRING.codex),
		warnings: Array.isArray(o.warnings) ? o.warnings.filter((w): w is string => typeof w === 'string' && w.length < 600).slice(0, 4) : [],
	};
}

/**
 * The note for a plant with nobody on it: the one step that fixes it, commands set apart so
 * they copy whole.
 *
 * @param w Wiring.
 * @param cls Class for the paragraph.
 * @returns Paragraph.
 */
export function wiringNote(w: Wiring, cls: string): HTMLElement {
	const p = el('p', cls);
	p.append(
		document.createTextNode('No agents yet. In a second terminal, run '), el('code', 'p67-cmd', w.claude),
		document.createTextNode('. For Codex, run '), el('code', 'p67-cmd', w.codex),
		document.createTextNode(', then type /hooks in Codex and trust the plant\'s hooks. Then start a new session in a project folder.'),
	);
	return p;
}
