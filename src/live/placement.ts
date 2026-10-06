/**
 * Where each comrade stands and what they are doing, derived from an AgentState alone.
 * Pure functions: no fetches, no clock of their own.
 */
import type { ZoneId } from '../world/types';
import type { OtherApproval } from './approvals';
import { companyLead, homeZone, isOwnSeat } from './personas';
import type { AgentState, Snapshot } from './types';

export { homeZone } from './personas';

/** A heartbeat this recent (inclusive) counts as working even when status says idle. */
export const WORKING_WINDOW_MS = 120_000;

export type Activity = 'working' | 'idle' | 'shivering';

export interface Placement {
	zone: ZoneId | 'roam';
	activity: Activity;
}

/**
 * True when the last heartbeat is within WORKING_WINDOW_MS of now. A timestamp slightly in
 * the future (clock skew between Paperclip and this machine) counts as recent.
 *
 * @param iso ISO timestamp or null.
 * @param now Epoch ms.
 * @returns Whether the heartbeat is recent.
 */
function recentHeartbeat(iso: string | null, now: number): boolean {
	if (!iso) return false;
	const t = Date.parse(iso);
	return Number.isFinite(t) && now - t <= WORKING_WINDOW_MS;
}

/**
 * Where an agent should stand right now.
 *
 * @param agent Agent state.
 * @param now Epoch ms.
 * @returns Zone and activity.
 */
export function placement(agent: AgentState, now: number): Placement {
	// The owner's own seat keeps the owner's office, whatever its status says.
	if (isOwnSeat(agent)) return { zone: 'directorate', activity: 'idle' };
	if (agent.status === 'error' || agent.status === 'paused') return { zone: 'siberia', activity: 'shivering' };
	const home = homeZone(agent);
	// Waiting for the owner's OK (the bridge's harnesses): still at the station, mid-task.
	if (agent.status === 'running' || agent.status === 'waiting' || recentHeartbeat(agent.lastHeartbeatAt, now)) return { zone: home, activity: 'working' };
	return { zone: home === 'roam' ? 'roam' : 'canteen', activity: 'idle' };
}

/**
 * Who carries a dossier: the agent who filed it when they are on the roster, otherwise (a board
 * user, an agent who has gone) the Company Lead.
 *
 * @param o The dossier.
 * @param agents The roster.
 * @returns The carrier's id and whether they filed it themselves, or null when nobody can carry it.
 */
export function dossierHolder(o: OtherApproval, agents: AgentState[]): { id: string; filer: boolean } | null {
	if (o.requestedBy && agents.some((a) => a.id === o.requestedBy)) return { id: o.requestedBy, filer: true };
	const lead = companyLead(agents);
	return lead ? { id: lead.id, filer: false } : null;
}

/**
 * Whether this agent needs the owner: in error (only a board member can clear it), on trial (a
 * tribunal awaits the verdict), waiting at the Recruitment desk for the hire to be approved,
 * or carrying a dossier for the board.
 *
 * @param agent Agent state.
 * @param snapshot Current snapshot, for its pending approvals.
 * @returns True when the owner must act.
 */
export function needsYou(agent: AgentState, snapshot: Snapshot): boolean {
	if (agent.status === 'error' || agent.status === 'pending_approval' || agent.status === 'waiting') return true;
	const a = snapshot.approvals;
	if (!a) return false;
	if (a.tribunals.some((t) => t.agentId === agent.id) || a.hires.some((h) => h.agentId === agent.id)) return true;
	return a.others.some((o) => dossierHolder(o, snapshot.agents)?.id === agent.id);
}
