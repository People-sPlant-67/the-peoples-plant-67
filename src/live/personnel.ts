/**
 * The Personnel File: one comrade's record (who they report to, budget, last heartbeat, recent
 * shifts) and the four board stamps that act on them in Paperclip: pause, resume, wake and
 * clear error.
 *
 * Paperclip's agent record also carries adapter and runtime configuration, which can hold
 * secrets, so only the named fields below are ever copied out of a response. Run records carry
 * process output for the same reason; only status, times and the error line are kept.
 *
 * Before any stamp acts, the agent is read again and the rules are checked against what
 * Paperclip says now, not what the plant last drew.
 */
import { failureWords } from './directives';
import { type Failure, type FetchLike, UUID, get, request } from './http';
import { isOwnSeat } from './personas';

export { isOwnSeat } from './personas';
import type { AgentStatus } from './types';

/** How many recent shifts the file lists. */
export const SHIFTS = 5;

/** Longest error line kept from a run. */
export const SHIFT_ERROR_MAX = 200;

/** One recent run of the comrade. All text is untrusted. */
export interface Shift {
	status: string;
	/** When it started, or when it was queued if it has not started. ISO, or null. */
	startedAt: string | null;
	finishedAt: string | null;
	/** Paperclip's error line, cut to SHIFT_ERROR_MAX, or null. */
	error: string | null;
}

/** The record the Personnel File shows. */
export interface PersonnelFile {
	budgetMonthlyCents: number | null;
	spentMonthlyCents: number | null;
	pausedAt: string | null;
	lastHeartbeatAt: string | null;
	reportsTo: string | null;
	/** Newest first, at most SHIFTS. Null when the runs could not be read. */
	shifts: Shift[] | null;
}

/** A board stamp. */
export type BoardAction = 'pause' | 'resume' | 'wake' | 'clear';

/** Every board stamp, in the order the file shows them. */
export const BOARD_ACTIONS: readonly BoardAction[] = ['pause', 'resume', 'wake', 'clear'];

/** Why every stamp is off for the owner's own manual seat. */
export const OWN_SEAT = 'This seat is yours: you run it by hand, so the plant never stamps it.';

/** The fields the stamp rules read. */
export interface Stampable {
	id: string;
	name: string;
	status: AgentStatus;
}

/**
 * Which stamps a comrade's status allows. Null means allowed; a sentence says why not.
 *
 * @param a The comrade as Paperclip last described them.
 * @returns Per stamp, null or the reason it is off.
 */
export function stampRules(a: Stampable): Record<BoardAction, string | null> {
	const all = (why: string): Record<BoardAction, string | null> => ({ pause: why, resume: why, wake: why, clear: why });
	if (isOwnSeat(a)) return all(OWN_SEAT);
	switch (a.status) {
		case 'idle': return { pause: null, resume: 'Only a paused comrade can be resumed.', wake: null, clear: 'There is no error to clear.' };
		// Pausing a working comrade is allowed: stopping a runaway is when the stamp matters most.
		case 'running': return { pause: null, resume: 'Only a paused comrade can be resumed.', wake: 'They are already at work.', clear: 'There is no error to clear.' };
		case 'paused': return { pause: 'They are already paused.', resume: null, wake: 'Resume them first, because Paperclip ignores a wake-up while they are paused.', clear: 'There is no error to clear.' };
		case 'error': return { pause: null, resume: 'Only a paused comrade can be resumed.', wake: 'Clear the error first.', clear: null };
		case 'pending_approval': return all('They are waiting for the board to approve the hire.');
		case 'waiting': return all('They are waiting for your OK in the terminal.');
		case 'terminated': return all('They have been terminated.');
		default: return all('The plant does not know this status, so use the dashboard instead.');
	}
}

/**
 * A number, or null.
 *
 * @param v Raw value.
 * @returns Finite number or null.
 */
function num(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * A string, cut to a length, or null.
 *
 * @param v Raw value.
 * @param max Longest kept.
 * @returns String or null.
 */
function str(v: unknown, max = 64): string | null {
	return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * Pick the shown fields out of a run record, and nothing else.
 *
 * @param r Raw run.
 * @returns Shift, or null when it is not a run.
 */
export function toShift(r: unknown): Shift | null {
	if (!r || typeof r !== 'object') return null;
	const o = r as Record<string, unknown>;
	const status = str(o.status);
	if (!status) return null;
	return {
		status,
		startedAt: str(o.startedAt) ?? str(o.createdAt),
		finishedAt: str(o.finishedAt),
		error: str(o.error, SHIFT_ERROR_MAX),
	};
}

/**
 * Read a comrade's Personnel File. The runs are read separately, so a failure there still
 * shows the record.
 *
 * @param f Fetch.
 * @param companyId Company UUID.
 * @param agentId Agent UUID.
 * @returns The file, or the failure reading the agent.
 */
export async function readPersonnel(f: FetchLike, companyId: string, agentId: string): Promise<{ ok: true; file: PersonnelFile } | Failure> {
	if (!UUID.test(companyId) || !UUID.test(agentId)) return { ok: false, session: 'unreachable', status: 0, detail: 'The plant refused an id that is not a UUID.' };
	const [a, runs] = await Promise.all([
		get(f, `/api/agents/${agentId}`),
		// Filtered and capped: the unfiltered list is every run the company ever made.
		get(f, `/api/companies/${companyId}/heartbeat-runs?agentId=${agentId}&limit=${SHIFTS}`),
	]);
	if (!a.ok) return a;
	const o = (a.body && typeof a.body === 'object' ? a.body : {}) as Record<string, unknown>;
	const reportsTo = str(o.reportsTo);
	return {
		ok: true,
		file: {
			budgetMonthlyCents: num(o.budgetMonthlyCents),
			spentMonthlyCents: num(o.spentMonthlyCents),
			pausedAt: str(o.pausedAt),
			lastHeartbeatAt: str(o.lastHeartbeatAt),
			reportsTo: reportsTo && UUID.test(reportsTo) ? reportsTo : null,
			shifts: runs.ok && Array.isArray(runs.body)
				? runs.body.map(toShift).filter((s): s is Shift => s !== null).slice(0, SHIFTS)
				: null,
		},
	};
}

/** What a stamp did: a sentence either way. */
export type ActResult = { ok: true; words: string } | { ok: false; words: string };

/** Paperclip path per stamp. */
const PATHS: Record<BoardAction, string> = { pause: 'pause', resume: 'resume', wake: 'wakeup', clear: 'clear-error' };

/** Sentence per stamp that worked. */
const DONE: Record<Exclude<BoardAction, 'wake'>, string> = {
	pause: 'Paused. Any shift in progress was stopped.',
	resume: 'Resumed. They will take work again.',
	clear: 'Error cleared. They are idle and will take work again.',
};

/**
 * A fresh key for each wake-up. The plant never retries a request, so this does not guard
 * against doubles; it gives Paperclip a distinct id for each hold of the stamp.
 *
 * @returns Random key.
 */
function freshKey(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `plant67-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Apply a board stamp. The agent is read first and the rules checked against its current
 * status; if the stamp no longer applies, nothing is sent.
 *
 * @param f Fetch.
 * @param agentId Agent UUID.
 * @param action The stamp.
 * @returns What happened, as a sentence.
 */
export async function boardAct(f: FetchLike, agentId: string, action: BoardAction): Promise<ActResult> {
	if (!UUID.test(agentId)) return { ok: false, words: 'Nothing was sent, because the plant refused an id that is not a UUID.' };
	const now = await get(f, `/api/agents/${agentId}`);
	if (!now.ok) return { ok: false, words: failureWords(now, 'Nothing was sent', 'Paperclip') };
	const o = (now.body && typeof now.body === 'object' ? now.body : {}) as Record<string, unknown>;
	const fresh: Stampable = { id: agentId, name: str(o.name, 200) ?? '', status: str(o.status) ?? 'unknown' };
	const why = stampRules(fresh)[action];
	if (why) return { ok: false, words: `Nothing was sent, because Paperclip has them as "${fresh.status}" now. ${why}` };
	const body = action === 'wake'
		? { source: 'on_demand', triggerDetail: 'manual', reason: "Woken by the board from The People's Plant.", idempotencyKey: freshKey() }
		: undefined;
	const r = await request(f, 'POST', `/api/agents/${agentId}/${PATHS[action]}`, body);
	if (!r.ok) return { ok: false, words: failureWords(r, 'Nothing changed', 'Paperclip') };
	if (action !== 'wake') return { ok: true, words: DONE[action] };
	const b = (r.body && typeof r.body === 'object' ? r.body : {}) as Record<string, unknown>;
	if (b.status === 'skipped') {
		const said = str(b.message, 300);
		return { ok: false, words: `Paperclip skipped the wake-up.${said ? ` It said: "${said.replace(/[."]+$/, '')}".` : ''}` };
	}
	return { ok: true, words: 'Woken. Paperclip has queued a new shift for them.' };
}
