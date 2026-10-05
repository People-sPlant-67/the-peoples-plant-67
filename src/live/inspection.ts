/**
 * The inspection: whether the Ministry of Operational Hygiene has been founded in Paperclip, as
 * the CEO prompt (docs/ONBOARDING.md) asks. Five checks, each read from Paperclip:
 *
 * 1. director: exactly one agent on the roster is the Director of Operational Hygiene.
 * 2. routine: a routine titled "Daily Operational Hygiene Review", given to the Director, switched on.
 * 3. ledger: an issue titled "Strike Ledger".
 * 4. threshold: the ledger says "Tribunal threshold: N" and N is the regime the owner chose.
 * 5. lessons: an issue titled "Lessons of the Tribunal".
 *
 * Read-only. The routines list is optional in the Plant Protocol: where it is missing, that check
 * says so and is left to the owner, and the Ministry still counts as founded on the other four.
 */
import { type FetchLike, UUID, get } from './http';
import { personaOf } from './personas';
import { listOf } from './poller';
import type { AgentState } from './types';

/** Exact titles the CEO prompt gives each piece. */
export const ROUTINE_TITLE = 'Daily Operational Hygiene Review';
export const LEDGER_TITLE = 'Strike Ledger';
export const LESSONS_TITLE = 'Lessons of the Tribunal';
/** The ledger's line the plant reads the threshold from. */
export const THRESHOLD_LINE = /tribunal threshold:\s*(\d{1,3})\b/i;

export type CheckId = 'director' | 'routine' | 'ledger' | 'threshold' | 'lessons';
/** The checks in the order the inspection page lists them. */
export const CHECK_ORDER: readonly CheckId[] = ['director', 'routine', 'ledger', 'threshold', 'lessons'];

/**
 * One check: found and right, not there yet, there but wrong (the note says how), not readable
 * just now (it is read again), or never readable from this Paperclip (the owner checks it by hand).
 */
export interface Check {
	state: 'ok' | 'missing' | 'wrong' | 'unknown' | 'manual';
	note: string | null;
}

export type Inspection = Record<CheckId, Check>;

/** What the checks read, fetched by inspect() or handed in by a test. */
export interface Evidence {
	agents: AgentState[];
	/** Routines as listed, null when the route does not exist (404), undefined when the read failed. */
	routines: Record<string, unknown>[] | null | undefined;
	/** Issues found by title search, undefined when the read failed. */
	ledgers: Record<string, unknown>[] | undefined;
	lessons: Record<string, unknown>[] | undefined;
	/** The ledger's description, read from the issue itself; undefined when not read. */
	ledgerText: string | null | undefined;
}

const ok = (): Check => ({ state: 'ok', note: null });
const check = (state: Check['state'], note: string | null): Check => ({ state, note });

/**
 * Same title, ignoring case and spacing at the ends.
 *
 * @param v A title from Paperclip.
 * @param want The title wanted.
 * @returns True when they match.
 */
const sameTitle = (v: unknown, want: string): boolean => typeof v === 'string' && v.trim().toLowerCase() === want.toLowerCase();

/**
 * Issues with exactly this title, leaving out cancelled ones.
 *
 * @param list Issues.
 * @param title Title.
 * @returns Matches.
 */
export function titled(list: Record<string, unknown>[], title: string): Record<string, unknown>[] {
	return list.filter((i) => sameTitle(i.title, title) && i.status !== 'cancelled');
}

/**
 * The Director of Operational Hygiene on the roster: every match, terminated agents left out.
 *
 * @param agents Roster.
 * @returns Matching agents.
 */
export function directors(agents: AgentState[]): AgentState[] {
	return agents.filter((a) => a.status !== 'terminated' && personaOf(a)?.id === 'enforcer');
}

/**
 * The threshold the ledger states, or null when it states none.
 *
 * @param text The ledger's description.
 * @returns Strikes, or null.
 */
export function thresholdIn(text: string | null | undefined): number | null {
	const m = text ? THRESHOLD_LINE.exec(text) : null;
	return m ? Number(m[1]) : null;
}

/**
 * Judge the five checks from what was read. Pure.
 *
 * @param e Evidence.
 * @param strikes The regime's threshold.
 * @returns Inspection.
 */
export function judge(e: Evidence, strikes: number): Inspection {
	const ds = directors(e.agents);
	const director = ds.length === 1 ? ok()
		: ds.length === 0 ? check('missing', 'No agent is titled "Director of Operational Hygiene" yet.')
			: check('wrong', `More than one agent looks like the Director (${ds.map((a) => a.name).join(', ')}). Rename the others in Paperclip.`);
	const dir = ds.length === 1 ? ds[0] : null;

	let routine: Check;
	if (e.routines === null) routine = check('manual', 'This Paperclip does not list routines to the plant. Check it by hand in the dashboard.');
	else if (e.routines === undefined) routine = check('unknown', 'The plant could not read the routines just now. It will look again.');
	else {
		const found = e.routines.filter((r) => sameTitle(r.title, ROUTINE_TITLE) && r.status !== 'archived');
		const best = found.find((r) => dir && r.assigneeAgentId === dir.id && r.status === 'active') ?? found.find((r) => dir && r.assigneeAgentId === dir.id) ?? found[0];
		if (!best) routine = check('missing', `No routine titled "${ROUTINE_TITLE}" yet.`);
		else if (dir && best.assigneeAgentId !== dir.id) routine = check('wrong', 'The routine exists but is given to someone other than the Director.');
		else if (best.status !== 'active') routine = check('wrong', 'The routine exists but is switched off.');
		else if (!dir) routine = check('missing', 'The routine exists. It waits for the Director.');
		else routine = ok();
	}

	const ledger = e.ledgers === undefined ? check('unknown', 'The plant could not search the issues just now. It will look again.')
		: titled(e.ledgers, LEDGER_TITLE).length ? ok() : check('missing', `No issue titled "${LEDGER_TITLE}" yet.`);

	let threshold: Check;
	if (ledger.state !== 'ok') threshold = check('missing', 'Waits for the Strike Ledger.');
	else if (e.ledgerText === undefined) threshold = check('unknown', 'The plant could not read the ledger just now. It will look again.');
	else {
		const n = thresholdIn(e.ledgerText);
		if (n === null) threshold = check('missing', `The ledger has no line reading "Tribunal threshold: ${strikes} live strike${strikes === 1 ? '' : 's'}".`);
		else if (n !== strikes) threshold = check('wrong', `The ledger says ${n}, but your regime says ${strikes}. Fix the ledger's first line, or change the regime.`);
		else threshold = ok();
	}

	const lessons = e.lessons === undefined ? check('unknown', 'The plant could not search the issues just now. It will look again.')
		: titled(e.lessons, LESSONS_TITLE).length ? ok() : check('missing', `No issue titled "${LESSONS_TITLE}" yet.`);

	return { director, routine, ledger, threshold, lessons };
}

/**
 * Whether the Ministry counts as founded: every check passed, except a routines list this
 * Paperclip does not offer, which the owner checks by hand.
 *
 * @param i Inspection.
 * @returns True when founded.
 */
export function founded(i: Inspection): boolean {
	return CHECK_ORDER.every((k) => i[k].state === 'ok' || i[k].state === 'manual');
}

/**
 * Read the evidence from Paperclip and judge it.
 *
 * @param fetchImpl Fetch.
 * @param companyId Company.
 * @param agents The roster from the last snapshot.
 * @param strikes The regime's threshold.
 * @returns Inspection.
 */
export async function inspect(fetchImpl: FetchLike, companyId: string, agents: AgentState[], strikes: number): Promise<Inspection> {
	if (!UUID.test(companyId)) throw new Error('The company id is not one Paperclip gives out.');
	const base = `/api/companies/${companyId}`;
	const search = (title: string): string => `${base}/issues?q=${encodeURIComponent(title)}&limit=50`;
	const [routines, ledgers, lessons] = await Promise.all([get(fetchImpl, `${base}/routines`), get(fetchImpl, search(LEDGER_TITLE)), get(fetchImpl, search(LESSONS_TITLE))]);
	const e: Evidence = {
		agents,
		routines: routines.ok ? listOf(routines.body) : routines.status === 404 ? null : undefined,
		ledgers: ledgers.ok ? listOf(ledgers.body) : undefined,
		lessons: lessons.ok ? listOf(lessons.body) : undefined,
		ledgerText: undefined,
	};
	// The description is read from the issue itself: a list may leave long fields out.
	const dir = directors(agents);
	const found = e.ledgers ? titled(e.ledgers, LEDGER_TITLE) : [];
	const pick = found.find((i) => dir.length === 1 && i.assigneeAgentId === dir[0].id) ?? found[0];
	if (pick && typeof pick.id === 'string' && UUID.test(pick.id)) {
		const one = await get(fetchImpl, `/api/issues/${pick.id}`);
		if (one.ok && one.body && typeof one.body === 'object') {
			const d = (one.body as Record<string, unknown>).description;
			e.ledgerText = typeof d === 'string' ? d : null;
		}
	}
	return judge(e, strikes);
}
