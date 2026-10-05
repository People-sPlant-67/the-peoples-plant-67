import type { Approvals } from './approvals';

/**
 * Contract for live Paperclip data. The poller produces Snapshots; placement turns an
 * AgentState into where that comrade should stand. Field names follow Paperclip's
 * API (see docs/PLANT-PROTOCOL.md).
 */

/** Paperclip agent status. Seen so far: idle, paused, error. `running` is expected mid-run. */
export type AgentStatus = 'running' | 'idle' | 'paused' | 'error' | (string & {});

/** One agent, trimmed to what the plant draws. All text is untrusted and must be shown with textContent. */
export interface AgentState {
	id: string;
	name: string;
	title: string | null;
	role: string | null;
	status: AgentStatus;
	pauseReason: string | null;
	errorReason: string | null;
	/** ISO timestamp of the last heartbeat, or null if it has never run. */
	lastHeartbeatAt: string | null;
	reportsTo: string | null;
	urlKey: string | null;
}

/** Counts from the sidebar badges endpoint. */
export interface Badges {
	inbox: number;
	approvals: number;
	failedRuns: number;
	joinRequests: number;
}

/**
 * Health of the connection, so the cockpit can show "PAPERS, PLEASE" instead of stale data.
 * 'no-company' means Paperclip answered and the sign-in works, but it can see no company with
 * a usable id, so there is nothing to draw. 'company-gone' means the company chosen at setup is
 * no longer listed: the plant says so rather than drawing a different one.
 */
export type Session = 'ok' | 'access-lapsed' | 'signed-out' | 'unreachable' | 'no-company' | 'company-gone';

export interface Snapshot {
	/** Epoch ms when the snapshot was taken. */
	at: number;
	session: Session;
	/** Human sentence explaining a non-ok session, for the overlay. */
	message: string | null;
	/** Company the plant reads (a UUID), or null before discovery. */
	companyId: string | null;
	companyName: string | null;
	agents: AgentState[];
	badges: Badges | null;
	/** True when the badges endpoint failed this time, so `badges` are the last good counts. */
	badgesStale: boolean;
	/** Pending tribunals and hires, or null before approvals were first read. */
	approvals: Approvals | null;
}
