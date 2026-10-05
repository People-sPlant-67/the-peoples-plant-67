/**
 * The inspection: whether the Ministry of Operational Hygiene has been founded in Paperclip, as
 * the CEO prompt (docs/ONBOARDING.md) asks. Five checks, each read from Paperclip:
 *
 * 1. director: exactly one agent on the roster is the Director (the court's own rule, directorsOf).
 * 2. routine: a routine titled "Daily Operational Hygiene Review", given to the Director, switched on.
 * 3. ledger: an issue titled "Strike Ledger".
 * 4. threshold: the ledger's first line says "Tribunal threshold: N" and N is the regime the owner chose.
 * 5. lessons: an issue titled "Lessons of the Tribunal".
 *
 * The ledger and the Lessons are found by a title search once, then re-read by id: a search can
 * page them out as other issues come to mention them. A read that fails says 'unknown', and an
 * 'unknown' never takes a founded Ministry down (see verdict).
 *
 * Read-only. The routines list is optional in the Plant Protocol: where it is missing, that check
 * says so and is left to the owner, and the Ministry still counts as founded on the other four.
 */
import { type FetchLike, UUID, get } from './http';
import { directorsOf } from './personas';
import { listOf } from './poller';
import type { AgentState } from './types';

/** Exact titles the CEO prompt gives each piece. */
export const DIRECTOR_TITLE = 'Director of Operational Hygiene';
export const ROUTINE_TITLE = 'Daily Operational Hygiene Review';
export const LEDGER_TITLE = 'Strike Ledger';
export const LESSONS_TITLE = 'Lessons of the Tribunal';
/** The ledger's first line, which the plant reads the threshold from. */
const THRESHOLD_LINE = /^\s*tribunal threshold:\s*(\d{1,3})\b/i;

export type CheckId = 'director' | 'routine' | 'ledger' | 'threshold' | 'lessons';
/** The checks in the order the inspection page lists them. */
export const CHECK_ORDER: readonly CheckId[] = ['lessons', 'director', 'ledger', 'threshold', 'routine'];

/**
 * One check: found and right, not there yet, there but wrong (the note says how), not readable
 * just now (it is read again), or never readable from this Paperclip (the owner checks it by hand).
 */
export interface Check {
	state: 'ok' | 'missing' | 'wrong' | 'unknown' | 'manual';
	note: string | null;
}

export type Inspection = Record<CheckId, Check>;

/** The ledger's and the Lessons' issue ids, once found, so the next inspection reads them directly. */
export interface Known {
	ledger: string | null;
	lessons: string | null;
}

/** An issue found, null when there is none, undefined when it could not be read. */
type Found = Record<string, unknown> | null | undefined;

/** What the checks read, fetched by inspect() or handed in by a test. */
export interface Evidence {
	agents: AgentState[];
	/** Routines as listed, null when the route does not exist (404), undefined when the read failed. */
	routines: Record<string, unknown>[] | null | undefined;
	/** The ledger issue, with its description. */
	ledger: Found;
	lessons: Found;
}

const ok = (): Check => ({ state: 'ok', note: null });
const check = (state: Check['state'], note: string | null): Check => ({ state, note });
/** The sentence for a read that failed; the inspection looks again on its own. */
const AGAIN = 'The plant could not read this from Paperclip just now. It will look again.';

/**
 * Same title, ignoring case and spacing at the ends.
 *
 * @param v A title from Paperclip.
 * @param want The title wanted.
 * @returns True when they match.
 */
const sameTitle = (v: unknown, want: string): boolean => typeof v === 'string' && v.trim().toLowerCase() === want.toLowerCase();

/**
 * Whether an issue is the piece wanted: its title, and not cancelled.
 *
 * @param i Issue.
 * @param title Title.
 * @returns True when it is.
 */
const isPiece = (i: Record<string, unknown>, title: string): boolean => sameTitle(i.title, title) && i.status !== 'cancelled';

/**
 * The threshold the ledger states on its first line, or null when it states none there.
 *
 * @param text The ledger's description.
 * @returns Strikes, or null.
 */
export function thresholdIn(text: string | null | undefined): number | null {
	const first = text?.split('\n').find((l) => l.trim()) ?? '';
	const m = THRESHOLD_LINE.exec(first);
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
	const ds = directorsOf(e.agents);
	const director = ds.length === 1 ? ok()
		: ds.length === 0 ? check('missing', `No agent's name or title says "Operational Hygiene" or "Enforcer" yet.`)
			: check('wrong', `More than one agent looks like the Director (${ds.map((a) => a.name).join(', ')}). Rename the others in Paperclip.`);
	const dir = ds.length === 1 ? ds[0] : null;

	let routine: Check;
	if (e.routines === null) routine = check('manual', 'This Paperclip does not list routines to the plant. Check it by hand in the dashboard.');
	else if (e.routines === undefined) routine = check('unknown', AGAIN);
	else {
		const found = e.routines.filter((r) => sameTitle(r.title, ROUTINE_TITLE) && r.status !== 'archived');
		const best = found.find((r) => dir && r.assigneeAgentId === dir.id && r.status === 'active') ?? found.find((r) => dir && r.assigneeAgentId === dir.id) ?? found[0];
		if (!best) routine = check('missing', `No routine titled "${ROUTINE_TITLE}" yet.`);
		else if (dir && best.assigneeAgentId !== dir.id) routine = check('wrong', 'The routine exists but is given to someone other than the Director.');
		else if (best.status !== 'active') routine = check('wrong', 'The routine exists but is switched off.');
		else if (!dir) routine = check('missing', 'The routine exists. It waits for the Director.');
		else routine = ok();
	}

	const piece = (f: Found, title: string): Check => (f === undefined ? check('unknown', AGAIN) : f ? ok() : check('missing', `No issue titled "${title}" yet.`));
	const ledger = piece(e.ledger, LEDGER_TITLE);

	let threshold: Check;
	if (e.ledger === undefined) threshold = check('unknown', AGAIN);
	else if (!e.ledger) threshold = check('missing', 'Waits for the Strike Ledger.');
	else {
		const d = e.ledger.description;
		const n = thresholdIn(typeof d === 'string' ? d : null);
		if (n === null) threshold = check('missing', `The ledger's first line does not read "Tribunal threshold: ${strikes} live strike${strikes === 1 ? '' : 's'}" yet.`);
		else if (n !== strikes) threshold = check('wrong', `The ledger says ${n}, but your regime says ${strikes}. Fix the ledger's first line, or change the regime.`);
		else threshold = ok();
	}

	return { director, routine, ledger, threshold, lessons: piece(e.lessons, LESSONS_TITLE) };
}

/**
 * Whether the Ministry counts as founded. Every check passed (or, for a routines list this
 * Paperclip does not offer, is the owner's to check): founded. Anything missing or wrong: not.
 * Otherwise some read failed, and the last verdict stands, so a passing blip never swaps the
 * plaque for the poster.
 *
 * @param i Inspection.
 * @param before The last verdict.
 * @returns True when founded.
 */
export function verdict(i: Inspection, before: boolean): boolean {
	const states = CHECK_ORDER.map((k) => i[k].state);
	if (states.some((s) => s === 'missing' || s === 'wrong')) return false;
	if (states.some((s) => s === 'unknown')) return before;
	return true;
}

/**
 * Read the evidence from Paperclip and judge it.
 *
 * @param fetchImpl Fetch.
 * @param companyId Company.
 * @param agents The roster from the last snapshot.
 * @param strikes The regime's threshold.
 * @param known The ledger's and Lessons' ids from the last inspection.
 * @returns The inspection, and the ids to remember for the next one.
 * @throws Error when the company id is not a UUID (nothing is requested).
 */
export async function inspect(fetchImpl: FetchLike, companyId: string, agents: AgentState[], strikes: number, known: Known = { ledger: null, lessons: null }): Promise<{ inspection: Inspection; known: Known }> {
	if (!UUID.test(companyId)) throw new Error('The company id is not one Paperclip gives out.');
	const base = `/api/companies/${companyId}`;
	const ds = directorsOf(agents);
	const dir = ds.length === 1 ? ds[0].id : null;

	/**
	 * One issue by id: the issue, null when it has gone (404), undefined when the read failed.
	 *
	 * @param id Issue id.
	 * @returns Found.
	 */
	const byId = async (id: string): Promise<Found> => {
		const g = await get(fetchImpl, `/api/issues/${id}`);
		if (!g.ok) return g.status === 404 ? null : undefined;
		const f = g.body && typeof g.body === 'object' ? g.body as Record<string, unknown> : null;
		// The issues route is not scoped to a company: another company's issue is not this one's piece.
		return f && typeof f.companyId === 'string' && f.companyId !== companyId ? null : f;
	};

	/**
	 * Find a piece: by the remembered id while it still is that piece, else by a title search,
	 * preferring one given to the Director. The issue is always read by id, for its description.
	 *
	 * @param id Remembered id.
	 * @param title Title.
	 * @returns Found.
	 */
	const find = async (id: string | null, title: string): Promise<Found> => {
		if (id && UUID.test(id)) {
			const f = await byId(id);
			if (f === undefined) return undefined;
			if (f && isPiece(f, title)) return f;
		}
		const g = await get(fetchImpl, `${base}/issues?q=${encodeURIComponent(title)}&limit=50`);
		if (!g.ok) return undefined;
		const all = listOf(g.body).filter((i) => isPiece(i, title));
		const pick = all.find((i) => dir && i.assigneeAgentId === dir) ?? all[0];
		if (!pick) return null;
		return typeof pick.id === 'string' && UUID.test(pick.id) ? byId(pick.id) : null;
	};

	const [routines, ledger, lessons] = await Promise.all([get(fetchImpl, `${base}/routines`), find(known.ledger, LEDGER_TITLE), find(known.lessons, LESSONS_TITLE)]);
	const e: Evidence = {
		agents,
		routines: routines.ok ? listOf(routines.body) : routines.status === 404 ? null : undefined,
		ledger, lessons,
	};
	/**
	 * The id to remember: the one found, or the old one while the read failed.
	 *
	 * @param f Found.
	 * @param was Remembered id.
	 * @returns Id or null.
	 */
	const keep = (f: Found, was: string | null): string | null => (f === undefined ? was : f && typeof f.id === 'string' ? f.id : null);
	return { inspection: judge(e, strikes), known: { ledger: keep(ledger, known.ledger), lessons: keep(lessons, known.lessons) } };
}
