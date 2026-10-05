/**
 * Pravda: the catch-up front page. Paperclip's activity feed is read (the newest ACTIVITY_MAX
 * records; it has no date filter) and cut at the owner's last visit, then set as an edition: a
 * lead story, up to four briefs and a line of counts.
 *
 * The feed also records secret reads, environment leases and provider traces, so only the
 * actions in PRINTED are ever read, and from each only the named fields. Comment text and error
 * messages are left out on purpose: the paper opens by itself, perhaps during a screen share,
 * and either could hold something an agent should not have written. Everything kept is
 * untrusted and is shown with textContent only.
 *
 * Any board member can post rows to the feed, so the paper only ever reports what it says; it
 * must never decide an action from it (the tribunal uses its own, entity-scoped check).
 */
import { type Failure, type FetchLike, UUID, get } from './http';

/** How many activity records are read: Paperclip's own maximum. */
export const ACTIVITY_MAX = 500;

/** Away for less than this, and no paper is printed on opening. */
export const AWAY_MS = 30 * 60_000;

/** The only actions Pravda reads. */
export const PRINTED = new Set([
	'agent.hire_created', 'agent.approved', 'agent.created', 'agent.terminated', 'agent.paused',
	'approval.created', 'approval.approved', 'approval.rejected', 'approval.revision_requested',
	'issue.created', 'issue.updated', 'issue.comment_added',
]);

/** One activity record, trimmed to what the paper prints. */
export interface NewsEvent {
	action: string;
	/** Epoch ms. */
	at: number;
	actorType: 'user' | 'agent' | 'system';
	/** The acting agent's id, when an agent acted. */
	agentId: string | null;
	/** The thing acted on: an agent, an approval or an issue. */
	entityId: string | null;
	/** issue.updated: the new status. */
	status: string | null;
	/** Issue identifier, e.g. PLT-12. */
	identifier: string | null;
	/** approval.*: the approval type. agent.hire_created and agent.created: the comrade's name. */
	detail: string | null;
}

/**
 * A string field, trimmed and cut, or null.
 *
 * @param v Raw value.
 * @param max Longest kept.
 * @returns String or null.
 */
function str(v: unknown, max: number): string | null {
	if (typeof v !== 'string') return null;
	const t = v.replace(/\s+/g, ' ').trim();
	return t ? (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t) : null;
}

/**
 * Keep one activity record if Pravda prints its action, with only the named fields.
 *
 * @param r Raw record.
 * @returns Event, or null.
 */
export function toEvent(r: unknown): NewsEvent | null {
	if (!r || typeof r !== 'object') return null;
	const o = r as Record<string, unknown>;
	const action = typeof o.action === 'string' ? o.action : '';
	if (!PRINTED.has(action)) return null;
	const at = typeof o.createdAt === 'string' ? Date.parse(o.createdAt) : NaN;
	if (!Number.isFinite(at)) return null;
	const d = (o.details && typeof o.details === 'object' ? o.details : {}) as Record<string, unknown>;
	const actorType = o.actorType === 'agent' || o.actorType === 'user' ? o.actorType : 'system';
	const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null);
	return {
		action, at, actorType,
		agentId: actorType === 'agent' ? id(o.actorId) ?? id(o.agentId) : null,
		entityId: id(o.entityId),
		status: action === 'issue.updated' ? str(d.status, 32) : null,
		identifier: str(d.identifier, 32),
		detail: action === 'agent.hire_created' || action === 'agent.created' ? str(d.name, 80) : action.startsWith('approval.') ? str(d.type, 60) : null,
	};
}

/** The feed since a moment, and whether it reached back that far. */
export interface Feed {
	/** Newest first. */
	events: NewsEvent[];
	/** True when all ACTIVITY_MAX records were newer than the cut, so older news is missing. */
	cut: boolean;
	/** Epoch ms of the oldest record read, or null. */
	oldest: number | null;
}

/**
 * Read the activity feed and keep what happened after `since`.
 *
 * @param f Fetch.
 * @param companyId Company UUID.
 * @param since Epoch ms: the owner's last visit.
 * @returns Feed, or the failure.
 */
export async function readFeed(f: FetchLike, companyId: string, since: number): Promise<{ ok: true; feed: Feed } | Failure> {
	if (!UUID.test(companyId)) return { ok: false, session: 'unreachable', status: 0, detail: 'The plant refused an id that is not a UUID.' };
	const r = await get(f, `/api/companies/${companyId}/activity?limit=${ACTIVITY_MAX}`);
	if (!r.ok) return r;
	const rows = Array.isArray(r.body) ? r.body : [];
	const times = rows.map((x) => (x && typeof x === 'object' && typeof (x as Record<string, unknown>).createdAt === 'string' ? Date.parse((x as Record<string, string>).createdAt) : NaN)).filter(Number.isFinite);
	const oldest = times.length ? Math.min(...times) : null;
	return {
		ok: true,
		feed: {
			// Sorted here, once, rather than trusting the server's order everywhere else.
			events: rows.map(toEvent).filter((e): e is NewsEvent => e !== null && e.at > since).sort((a, b) => b.at - a.at),
			cut: rows.length >= ACTIVITY_MAX && oldest !== null && oldest > since,
			oldest,
		},
	};
}

/** A story on the front page. */
export interface Story {
	head: string;
	body: string;
}

/** A printed edition. */
export interface Edition {
	lead: Story;
	briefs: Story[];
	/** Counts as sentences, or '' when there are none. */
	inBrief: string;
}

/** What the paper knows beyond the feed: the plant as it stands now. */
export interface PressContext {
	/** A comrade's name: the roster, then the roster remembered from the last visit. */
	nameOf(id: string): string | null;
	/** A comrade's status on the roster now, or null when they are not on it. */
	statusOf(id: string): string | null;
	/** Issues the owner sent from the plant. */
	sent: Set<string>;
	/** Names of comrades in error right now. */
	inError: string[];
	/** Dossiers, tribunals and hires waiting for the owner right now. */
	dossiers: number;
	tribunals: number;
	hires: number;
}

/**
 * "1 task" or "3 tasks".
 *
 * @param n Count.
 * @param one Singular.
 * @param many Plural.
 * @returns Words.
 */
function count(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/**
 * A list in words: "A", "A and B", "A, B and C".
 *
 * @param xs Items.
 * @returns Words.
 */
function list(xs: string[]): string {
	return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * The first few of a list, then "and N more".
 *
 * @param xs Items.
 * @param max Most named.
 * @returns Words.
 */
function some(xs: string[], max: number): string {
	return xs.length <= max ? list(xs) : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;
}

/**
 * Keep one event per entity: Paperclip can log the same change twice.
 *
 * @param xs Events.
 * @returns Events, first of each entity kept.
 */
function unique(xs: NewsEvent[]): NewsEvent[] {
	const seen = new Set<string>();
	return xs.filter((e) => !e.entityId || (!seen.has(e.entityId) && !!seen.add(e.entityId)));
}

/** Plain words for approval types, lower case for use mid-sentence. */
const APPROVAL_WORDS: Record<string, [string, string]> = {
	hire_agent: ['a hire', 'hires'],
	request_board_approval: ['a request for the board', 'requests for the board'],
	approve_ceo_strategy: ["the Company Lead's strategy", "strategies from the Company Lead"],
	budget_override_required: ['a budget override', 'budget overrides'],
};

/** One desk of the paper: a story from the news and the plant as it stands, or nothing. */
type Desk = (ev: NewsEvent[], ctx: PressContext) => Story | null;

/** The desks, most serious first: the first with a story writes the lead. */
const DESKS: Desk[] = [
	// Waiting on the owner now: the paper covers the plant, so it must say so.
	(_ev, ctx) => {
		if (!ctx.tribunals && !ctx.hires) return null;
		const parts = [
			ctx.tribunals ? `${ctx.tribunals === 1 ? 'A tribunal awaits' : `${ctx.tribunals} tribunals await`} your verdict.` : '',
			ctx.hires ? `${ctx.hires === 1 ? 'A new comrade waits' : `${ctx.hires} new comrades wait`} at the Recruitment Office for your stamp.` : '',
		].filter(Boolean);
		return { head: ctx.tribunals ? 'The court awaits the Chairman' : 'The Recruitment Office awaits the Chairman', body: `${parts.join(' ')} Put the paper down to see to it.` };
	},
	(ev, ctx) => {
		const gone = unique(ev.filter((e) => e.action === 'agent.terminated'));
		if (!gone.length) return null;
		const names = gone.map((e) => (e.entityId ? ctx.nameOf(e.entityId) : null));
		const named = names.filter((n): n is string => !!n);
		return {
			head: gone.length === 1 ? `${named[0] ?? 'A comrade'} removed from the plant` : `${gone.length} comrades removed from the plant`,
			body: `${named.length ? `The board terminated ${list(named)}${named.length < gone.length ? ` and ${count(gone.length - named.length, 'other')}` : ''}.` : `The board terminated ${count(gone.length, 'comrade')}.`} The group photograph has been corrected.`,
		};
	},
	(_ev, ctx) => {
		const e = ctx.inError;
		if (!e.length) return null;
		return {
			head: e.length === 1 ? `${e[0]} stopped with an error` : `${e.length} comrades stopped with errors`,
			body: `${e.length === 1 ? 'They wait' : `${list(e)} wait`} in Siberia. The reason is on their name card, and the Personnel File can clear it.`,
		};
	},
	(ev, ctx) => {
		const done = unique(ev.filter((e) => e.action === 'issue.updated' && e.status === 'done'));
		if (!done.length) return null;
		const by = new Map<string, number>();
		for (const e of done) if (e.agentId) by.set(e.agentId, (by.get(e.agentId) ?? 0) + 1);
		const [topId, topN] = [...by.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
		const top = topId ? ctx.nameOf(topId) : null;
		const ids = done.map((e) => e.identifier).filter((x): x is string => !!x);
		const parts = [
			top ? `${top} led the way with ${count(topN, 'task')}.` : '',
			ids.length ? `Completed: ${some(ids, 4)}.` : '',
		].filter(Boolean);
		return { head: `Plan fulfilled: ${count(done.length, 'task')} completed`, body: parts.length ? parts.join(' ') : 'The Plan board has the details.' };
	},
	(ev, ctx) => {
		const answers = ev.filter((e) => e.action === 'issue.comment_added' && e.actorType === 'agent' && e.entityId && ctx.sent.has(e.entityId));
		if (!answers.length) return null;
		const names = [...new Set(answers.map((e) => (e.agentId ? ctx.nameOf(e.agentId) : null)).filter((n): n is string => !!n))];
		const on = [...new Set(answers.map((e) => e.identifier).filter((x): x is string => !!x))];
		const who = names.length ? list(names) : 'Comrades';
		return {
			head: names.length === 1 ? `${names[0]} answers your directives` : 'Comrades answer your directives',
			body: `${who} replied ${answers.length === 1 ? 'once' : `${answers.length} times`}${on.length ? `, on ${some(on, 3)}` : ''}. The Directives tab has the replies.`,
		};
	},
	(ev, ctx) => {
		const verb: Record<string, string> = { 'approval.approved': 'approved', 'approval.rejected': 'refused', 'approval.revision_requested': 'sent back' };
		const decided = unique(ev.filter((e) => verb[e.action]));
		const filed = unique(ev.filter((e) => e.action === 'approval.created'));
		if (!decided.length && !filed.length && !ctx.dossiers) return null;
		// Grouped: "approved 3 hires and a budget override", not the same words three times.
		const groups = new Map<string, number>();
		for (const e of decided) { const k = `${verb[e.action]}|${e.detail ?? ''}`; groups.set(k, (groups.get(k) ?? 0) + 1); }
		const phrases = [...groups.entries()].map(([k, n]) => {
			const [v, type] = k.split('|');
			const w = APPROVAL_WORDS[type] ?? ['an approval', 'approvals'];
			return `${v} ${n === 1 ? w[0] : `${n} ${w[1]}`}`;
		});
		const parts = [
			phrases.length ? `The board ${some(phrases, 3)}.` : '',
			filed.length ? `${filed.length === 1 ? 'A new request came' : `${filed.length} new requests came`} to the board.` : '',
			ctx.dossiers ? `${ctx.dossiers === 1 ? 'A dossier awaits' : `${ctx.dossiers} dossiers await`} your stamp.` : '',
		].filter(Boolean);
		return { head: 'The board at work', body: parts.join(' ') };
	},
	(ev, ctx) => {
		const hires = unique(ev.filter((e) => e.action === 'agent.hire_created' || e.action === 'agent.approved' || e.action === 'agent.created'));
		const joined: string[] = [];
		const waiting: string[] = [];
		for (const e of hires) {
			const status = e.entityId ? ctx.statusOf(e.entityId) : null;
			const name = (e.entityId ? ctx.nameOf(e.entityId) : null) ?? e.detail;
			// Not on the roster: refused or gone since. Nothing to welcome.
			if (!status || !name) continue;
			(status === 'pending_approval' ? waiting : joined).push(name);
		}
		if (!joined.length && (!waiting.length || ctx.hires)) return null;
		const parts = [
			joined.length ? `Welcome to ${list(joined)}.` : '',
			// The lead already says hires wait when any do; the brief does not say it again.
			waiting.length && !ctx.hires ? `${list(waiting)} ${waiting.length === 1 ? 'waits' : 'wait'} at the Recruitment Office for your stamp.` : '',
		].filter(Boolean);
		return {
			head: joined.length === 1 && !waiting.length ? `${joined[0]} joins the plant` : joined.length ? `${joined.length + waiting.length} new comrades for the plant` : `${waiting.length === 1 ? 'A new comrade asks' : `${waiting.length} new comrades ask`} to join`,
			body: parts.join(' '),
		};
	},
];

/**
 * Set the edition. Returns null when the feed holds no news: the state of the plant alone (a
 * comrade still in error, a dossier still waiting) never prints a paper, or it would print
 * the same one on every return. Nor does a status change that makes no story or count.
 *
 * @param feed Events since the last visit.
 * @param ctx The plant as it stands.
 * @returns Edition or null.
 */
export function setEdition(feed: Feed, ctx: PressContext): Edition | null {
	const ev = feed.events;
	/**
	 * The stories the desks write.
	 *
	 * @param c Context.
	 * @returns Stories, most serious first.
	 */
	const write = (c: PressContext): Story[] => DESKS.map((desk) => desk(ev, c)).filter((s): s is Story => s !== null);
	const stories = write(ctx);
	// The comrades' work: issues the owner filed themselves are not news to them.
	const created = unique(ev.filter((e) => e.action === 'issue.created' && e.actorType !== 'user')).length;
	const comments = ev.filter((e) => e.action === 'issue.comment_added' && e.actorType === 'agent').length;
	const blocked = unique(ev.filter((e) => e.action === 'issue.updated' && e.status === 'blocked')).length;
	const pauses = ev.filter((e) => e.action === 'agent.paused').length;
	const counts = [
		created ? `${created === 1 ? '1 new issue was' : `${created} new issues were`} filed.` : '',
		comments ? `Comrades wrote ${count(comments, 'comment')}.` : '',
		blocked ? `${blocked === 1 ? '1 issue was' : `${blocked} issues were`} blocked.` : '',
	].filter(Boolean);
	// News is what the feed says happened: the stories written with the standing state left
	// out, and the counts. A comrade still in error or a dossier still waiting never prints a
	// paper on its own, and nor does a pause (most likely the owner's own).
	if (!counts.length && !write({ ...ctx, inError: [], dossiers: 0, tribunals: 0, hires: 0 }).length) return null;
	if (pauses) counts.push(`The board paused comrades ${pauses === 1 ? 'once' : `${pauses} times`}.`);
	return {
		lead: stories[0] ?? { head: 'A quiet shift at the plant', body: 'Nothing of note happened, but the plant kept working.' },
		briefs: stories.slice(1, 5),
		inBrief: counts.join(' '),
	};
}

/**
 * A sentence when the feed did not reach back to the last visit.
 *
 * @param feed Feed.
 * @param when Words for a moment.
 * @returns Sentence, or ''.
 */
export function gapWords(feed: Feed, when: (ms: number) => string): string {
	return feed.cut && feed.oldest !== null ? `Pravda's archive only reaches back to ${when(feed.oldest)}; anything older is not printed.` : '';
}
