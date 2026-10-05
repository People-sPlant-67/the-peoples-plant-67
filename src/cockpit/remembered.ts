/**
 * The roster as the plant last saw it, kept in the browser per company. The ceremonies use it to
 * replay who left and who joined while the owner was away, and Pravda to name comrades who have
 * since gone. The storage is shared with the Paperclip page, so only well-formed entries are
 * believed.
 */
import { UUID } from '../live/http';
import type { AgentState } from '../live/types';

/** localStorage key. */
export const ROSTER_KEY = 'plant67.roster';

/** One remembered roster entry. */
export interface Kept { id: string; name: string; title: string | null; role: string | null }

/**
 * The remembered roster.
 *
 * @returns Company id and its well-formed entries, or null when nothing is remembered.
 */
export function readRoster(): { companyId: string; agents: Kept[] } | null {
	let v: unknown;
	try { v = JSON.parse(localStorage.getItem(ROSTER_KEY) ?? 'null'); } catch { return null; }
	if (!v || typeof v !== 'object') return null;
	const o = v as Record<string, unknown>;
	if (typeof o.companyId !== 'string' || !Array.isArray(o.agents)) return null;
	const agents = o.agents
		.filter((k): k is Record<string, unknown> => !!k && typeof k === 'object')
		.filter((k) => typeof k.id === 'string' && UUID.test(k.id) && typeof k.name === 'string')
		.map((k): Kept => ({ id: k.id as string, name: (k.name as string).slice(0, 120), title: typeof k.title === 'string' ? k.title : null, role: typeof k.role === 'string' ? k.role : null }));
	return { companyId: o.companyId, agents };
}

/**
 * Remember a roster.
 *
 * @param companyId Company id.
 * @param agents The roster.
 */
export function saveRoster(companyId: string | null, agents: AgentState[]): void {
	try {
		localStorage.setItem(ROSTER_KEY, JSON.stringify({ companyId, agents: agents.map((a): Kept => ({ id: a.id, name: a.name, title: a.title, role: a.role })) }));
	} catch { /* It just won't replay on the next visit. */ }
}
