/**
 * Board approvals the plant acts on: tribunal referrals from the Director of Operational
 * Hygiene (request_board_approval with "tribunal": true, format in docs/PLANT-PROTOCOL.md),
 * hire requests (hire_agent) for comrades waiting at
 * the Recruitment desk, and every other type as a dossier. Also the calls that carry
 * out a decision.
 *
 * Everything in a payload is untrusted: ids must be UUIDs, text is shown with textContent only.
 */
import { type Failure, type FetchLike, type Got, UUID, request } from './http';
import { listOf } from './poller';

/** One strike as the Director lists it. */
export interface Strike { date: string; finding: string; serious: boolean }

/** A pending tribunal referral. */
export interface TribunalCase {
	approvalId: string;
	agentId: string;
	agentName: string;
	strikes: number;
	strikeList: Strike[];
	charge: string;
	/** The Director's report issue, for "Read the report"; null if the payload named none. */
	reportIssueId: string | null;
	probation: boolean;
	/** The agent the referral says filed it, or null. Only a first filter: the caller may set it to anything. */
	requestedBy: string | null;
	/** When the board decided it (ISO), for referrals decided elsewhere; null while pending. */
	decidedAt: string | null;
}

/** A pending hire. */
export interface HireRequest {
	approvalId: string;
	agentId: string;
	name: string;
	title: string | null;
	role: string | null;
	/** What the new comrade is for, from the request (trimmed). */
	about: string | null;
	/** Who they replace, and the rule they were hired under, when the request says. */
	replaces: string | null;
	rule: string | null;
}

/** One line of a dossier: a payload key in plain words and its value as text. */
export interface DossierField { label: string; value: string }

/** Any other pending approval, shown as a dossier and decided with the three stamps. */
export interface OtherApproval {
	approvalId: string;
	/** Paperclip's type, as sent (cut to 80 characters). */
	type: string;
	/** Plain words for a type the plant recognises, else the raw type. */
	typeLabel: string;
	/** True when the plant recognises the type. */
	known: boolean;
	/** The agent that filed it, or null (a board user, or no UUID). Only for routing: the caller may set it to anything. */
	requestedBy: string | null;
	/** When it was filed (ISO), or null. */
	createdAt: string | null;
	/** The payload, flattened one level, at most DOSSIER_MAX_FIELDS lines. */
	fields: DossierField[];
	/** Payload lines left out because of the cap. */
	hiddenFields: number;
	/** True when something is not shown in full (lines left out, or a value cut short). */
	cut: boolean;
	/** Why it cannot be decided here at all, or null. */
	blocked: string | null;
}

export interface Approvals {
	tribunals: TribunalCase[];
	hires: HireRequest[];
	others: OtherApproval[];
}

/** Most lines a dossier shows. */
export const DOSSIER_MAX_FIELDS = 20;
/** Longest value a dossier line shows. */
export const DOSSIER_MAX_VALUE = 600;

/** Plain words for the approval types the plant recognises. */
export const TYPE_LABELS: Readonly<Record<string, string>> = {
	request_board_approval: 'A request for the board\'s approval',
	approve_ceo_strategy: 'The Company Lead\'s strategy',
	budget_override_required: 'A budget override',
};

export type { Failure };

/**
 * A string field, trimmed and cut to a length, or null.
 *
 * @param v Raw value.
 * @param max Longest kept.
 * @returns String or null.
 */
function text(v: unknown, max: number): string | null {
	if (typeof v !== 'string') return null;
	const t = clean(v).trim();
	return t ? t.slice(0, max) : null;
}

/** Invisible and direction-changing characters: they can make "0021" display as "1200". */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * Text with invisible and direction-changing characters removed, so it reads as it is.
 *
 * @param t Text.
 * @returns Cleaned text.
 */
export function clean(t: string): string {
	return t.replace(INVISIBLE, '');
}

/**
 * A payload key in plain words: "budgetUsd" and "budget_usd" both read "Budget usd".
 *
 * @param key Raw key.
 * @returns Label, at most 60 characters.
 */
export function labelOf(key: string): string {
	return fullLabel(key).slice(0, LABEL_MAX);
}

/** Longest label shown; a longer one counts as cut. */
const LABEL_MAX = 60;

/**
 * A payload key in plain words, however long.
 *
 * @param key Raw key.
 * @returns Label.
 */
function fullLabel(key: string): string {
	const words = clean(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().toLowerCase();
	return words ? words[0].toUpperCase() + words.slice(1) : 'Unnamed field';
}

/**
 * A key reduced to its letters, so "Tribunal", "tribunal\u200B" and "report_issue_id" compare plainly.
 *
 * @param key Raw key.
 * @returns Lower-case letters only.
 */
const bare = (key: string): string => clean(key).toLowerCase().replace(/[^a-z]/g, '');

/**
 * Whether a payload is shaped like a tribunal referral, at the top level or one level down.
 *
 * @param p Payload, or null.
 * @returns True when it names a tribunal, or an agent together with a report.
 */
function referralShaped(p: Record<string, unknown> | null): boolean {
	const shaped = (o: Record<string, unknown>): boolean => {
		const keys = new Set(Object.keys(o).map(bare));
		return keys.has('tribunal') || (keys.has('agentid') && keys.has('reportissueid'));
	};
	if (!p) return false;
	return shaped(p) || Object.values(p).some((v) => !!v && typeof v === 'object' && !Array.isArray(v) && shaped(v as Record<string, unknown>));
}

/**
 * A value as one line of text, or null when there is nothing to show. A value longer than
 * DOSSIER_MAX_VALUE is cut, and says so in words.
 *
 * @param v Raw value.
 * @returns Text and whether it was cut, or null.
 */
function asText(v: unknown): { value: string; cut: boolean } | null {
	let t: string;
	if (v === null || v === undefined) return null;
	if (typeof v === 'string') t = v.trim();
	else if (typeof v === 'number' || typeof v === 'boolean') t = String(v);
	else if (Array.isArray(v) && v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))) t = v.filter((x) => x !== null).join(', ');
	else {
		// Deeper than one level: shown as the JSON it is, never interpreted.
		try { t = JSON.stringify(v) ?? ''; } catch { t = ''; }
	}
	// A long run of blank lines could push the end of a value out of sight.
	t = clean(t).replace(/(?:[ \t]*\r?\n){3,}/g, '\n\n');
	if (!t) return null;
	if (t.length <= DOSSIER_MAX_VALUE) return { value: t, cut: false };
	return { value: `${t.slice(0, DOSSIER_MAX_VALUE)}… (cut: ${t.length - DOSSIER_MAX_VALUE} more characters)`, cut: true };
}

/**
 * Flatten a payload one level into dossier lines: { plan: { steps: 3 } } reads "Plan › steps: 3".
 *
 * @param p Payload, or null.
 * @returns Up to DOSSIER_MAX_FIELDS lines, how many were left out, and whether any shown value was cut.
 */
export function flatten(p: Record<string, unknown> | null): { fields: DossierField[]; hidden: number; cut: boolean } {
	const all: (DossierField & { cut: boolean })[] = [];
	for (const [k, v] of Object.entries(p ?? {})) {
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
				const t = asText(v2);
				if (t) all.push({ label: `${labelOf(k)} › ${labelOf(k2).toLowerCase()}`, ...t, cut: t.cut || fullLabel(k).length > LABEL_MAX || fullLabel(k2).length > LABEL_MAX });
			}
			continue;
		}
		const t = asText(v);
		if (t) all.push({ label: labelOf(k), ...t, cut: t.cut || fullLabel(k).length > LABEL_MAX });
	}
	const shown = all.slice(0, DOSSIER_MAX_FIELDS);
	return { fields: shown.map(({ label, value }) => ({ label, value })), hidden: Math.max(0, all.length - DOSSIER_MAX_FIELDS), cut: shown.some((f) => f.cut) };
}

/**
 * What a dossier says, as one string: if Paperclip's copy no longer matches it, the approval
 * changed after the owner read it.
 *
 * @param o Dossier.
 * @returns Fingerprint.
 */
export function dossierKey(o: OtherApproval): string {
	return JSON.stringify([o.type, o.requestedBy, o.fields, o.hiddenFields, o.cut, o.blocked]);
}

/**
 * Read one approval of any other type as a dossier.
 *
 * @param id Its id (already a UUID).
 * @param a The raw approval.
 * @param p Its payload, or null.
 * @returns The dossier, or null when it has no type.
 */
function toOther(id: string, a: Record<string, unknown>, p: Record<string, unknown> | null): OtherApproval | null {
	const type = text(a.type, 80);
	if (!type) return null;
	const known = Object.hasOwn(TYPE_LABELS, type);
	const { fields, hidden, cut } = flatten(p);
	// Something shaped like a tribunal referral that is not one the plant hears (tribunal: "true",
	// say) must never be approved as a plain request: in Paperclip it would still read as guilty.
	const referral = referralShaped(p);
	return {
		approvalId: id,
		type,
		typeLabel: known ? TYPE_LABELS[type] : type,
		known,
		requestedBy: typeof a.requestedByAgentId === 'string' && UUID.test(a.requestedByAgentId) ? a.requestedByAgentId : null,
		createdAt: text(a.createdAt, 40),
		fields,
		hiddenFields: hidden,
		cut: cut || hidden > 0,
		blocked: referral ? 'This looks like a tribunal referral, but not in the form the plant hears, so it can only be decided in the dashboard.' : null,
	};
}

/**
 * Read the approvals. Anything malformed is skipped rather than guessed at: a tribunal needs a
 * UUID approval id and a UUID agent id, a hire needs the same, and any other type needs a UUID
 * approval id and a type (and is kept only when pending).
 *
 * @param body Parsed JSON from GET /companies/:id/approvals?status=<status>.
 * @param status The status asked for (pending normally; approved to find verdicts given elsewhere).
 * @returns Tribunals, hires and the other types as dossiers.
 */
export function toApprovals(body: unknown, status = 'pending'): Approvals {
	const out: Approvals = { tribunals: [], hires: [], others: [] };
	const seenAgents = new Set<string>();
	for (const a of listOf(body)) {
		const id = typeof a.id === 'string' && UUID.test(a.id) ? a.id : null;
		if (!id || (a.status !== undefined && a.status !== status)) continue;
		const p = a.payload && typeof a.payload === 'object' && !Array.isArray(a.payload) ? a.payload as Record<string, unknown> : null;
		const tribunal = a.type === 'request_board_approval' && p?.tribunal === true;
		if (!tribunal && a.type !== 'hire_agent') {
			// Only pending ones: a dossier is something to decide.
			const other = status === 'pending' ? toOther(id, a, p) : null;
			if (other) out.others.push(other);
			continue;
		}
		if (!p) continue;
		const agentId = typeof p.agentId === 'string' && UUID.test(p.agentId) ? p.agentId : null;
		if (!agentId) continue;
		const requestedBy = typeof a.requestedByAgentId === 'string' && UUID.test(a.requestedByAgentId) ? a.requestedByAgentId : null;
		if (tribunal) {
			// One trial per comrade: a duplicate referral waits until the first is decided.
			if (seenAgents.has(agentId)) continue;
			seenAgents.add(agentId);
			const list = Array.isArray(p.strikeList) ? p.strikeList : [];
			const strikeList: Strike[] = list.slice(0, 12).flatMap((s): Strike[] => {
				if (!s || typeof s !== 'object') return [];
				const r = s as Record<string, unknown>;
				const finding = text(r.finding, 300);
				return finding ? [{ date: text(r.date, 20) ?? '', finding, serious: r.serious === true }] : [];
			});
			const strikes = typeof p.strikes === 'number' && Number.isFinite(p.strikes) ? Math.max(0, Math.floor(p.strikes)) : strikeList.length;
			out.tribunals.push({
				approvalId: id,
				agentId,
				agentName: text(p.agentName, 120) ?? 'The accused',
				strikes,
				strikeList,
				charge: text(p.charge, 280) ?? 'The Director of Operational Hygiene gave no charge.',
				reportIssueId: typeof p.reportIssueId === 'string' && UUID.test(p.reportIssueId) ? p.reportIssueId : null,
				probation: p.probation === true,
				requestedBy,
				decidedAt: text(a.decidedAt, 40),
			});
		} else if (a.type === 'hire_agent') {
			out.hires.push({
				approvalId: id,
				agentId,
				name: text(p.name, 120) ?? 'A new comrade',
				title: text(p.title, 160),
				role: text(p.role, 60),
				about: text(p.capabilities, 400),
				replaces: text(p.replaces, 120),
				rule: text(p.rule, 400),
			});
		}
	}
	return out;
}

/**
 * Carry over a failed Got.
 *
 * @param g Failed request.
 * @returns Failure.
 */
const fail = (g: Extract<Got, { ok: false }>): Failure => ({ ok: false, session: g.session, status: g.status, detail: g.detail });
/** Refused before sending. */
const refused = (detail: string): Failure => ({ ok: false, session: 'unreachable', status: 0, detail });

/**
 * Approve an approval with a note (a guilty verdict, or a hire).
 *
 * @param f Fetch.
 * @param approvalId Approval.
 * @param note Decision note.
 * @returns Ok, or the failure.
 */
export async function approve(f: FetchLike, approvalId: string, note: string): Promise<{ ok: true } | Failure> {
	if (!UUID.test(approvalId)) return refused('The approval id is not in the form Paperclip uses, so nothing was sent.');
	const g = await request(f, 'POST', `/api/approvals/${approvalId}/approve`, { decisionNote: note });
	return g.ok ? { ok: true } : fail(g);
}

/**
 * Reject an approval with the reason (a pardon, or a refused hire).
 *
 * @param f Fetch.
 * @param approvalId Approval.
 * @param reason The owner's reason; required.
 * @returns Ok, or the failure.
 */
export async function reject(f: FetchLike, approvalId: string, reason: string): Promise<{ ok: true } | Failure> {
	if (!UUID.test(approvalId)) return refused('The approval id is not in the form Paperclip uses, so nothing was sent.');
	if (!reason.trim()) return refused('A reason is required.');
	const g = await request(f, 'POST', `/api/approvals/${approvalId}/reject`, { decisionNote: reason.trim().slice(0, 4000) });
	return g.ok ? { ok: true } : fail(g);
}

/**
 * Read one approval back as a dossier, just before a stamp acts on it.
 *
 * @param f Fetch.
 * @param approvalId Approval.
 * @returns Its status, who decided it and when, and (while pending) the dossier as it reads now; null when it cannot be read.
 */
export async function readDossier(f: FetchLike, approvalId: string): Promise<{ status: string; decidedBy: string | null; decidedAt: string | null; dossier: OtherApproval | null } | null> {
	if (!UUID.test(approvalId)) return null;
	const g = await request(f, 'GET', `/api/approvals/${approvalId}`);
	if (!g.ok || !g.body || typeof g.body !== 'object' || Array.isArray(g.body)) return null;
	const b = g.body as Record<string, unknown>;
	const status = typeof b.status === 'string' ? b.status : '';
	const dossier = status === 'pending' ? toApprovals([b]).others.find((o) => o.approvalId === approvalId) ?? null : null;
	return { status, decidedBy: text(b.decidedByUserId, 120), decidedAt: text(b.decidedAt, 40), dossier };
}

/**
 * Send an approval back to whoever filed it, asking for changes. The path is inferred from
 * Paperclip's API as recon saw it, not yet seen working on the live instance: a 404 is reported
 * as a sentence by the caller, and nothing else is tried.
 *
 * @param f Fetch.
 * @param approvalId Approval.
 * @param note What to change; required.
 * @returns Ok, or the failure.
 */
export async function requestRevision(f: FetchLike, approvalId: string, note: string): Promise<{ ok: true } | Failure> {
	if (!UUID.test(approvalId)) return refused('The approval id is not in the form Paperclip uses, so nothing was sent.');
	if (!note.trim()) return refused('A note saying what to change is required.');
	const g = await request(f, 'POST', `/api/approvals/${approvalId}/request-revision`, { decisionNote: note.trim().slice(0, 4000) });
	return g.ok ? { ok: true } : fail(g);
}

/**
 * Terminate an agent. Paperclip allows this to the board only, and it cannot be undone.
 *
 * @param f Fetch.
 * @param agentId Agent.
 * @returns Ok, or the failure.
 */
export async function terminate(f: FetchLike, agentId: string): Promise<{ ok: true } | Failure> {
	if (!UUID.test(agentId)) return refused('The agent id is not in the form Paperclip uses, so nothing was sent.');
	const g = await request(f, 'POST', `/api/agents/${agentId}/terminate`, {});
	return g.ok ? { ok: true } : fail(g);
}

/**
 * What became of an agent who left the roster.
 *
 * @param f Fetch.
 * @param agentId Agent.
 * @returns 'terminated', 'gone' (Paperclip no longer has them), another status, or null when the check failed.
 */
export async function fate(f: FetchLike, agentId: string): Promise<string | null> {
	if (!UUID.test(agentId)) return null;
	const g = await request(f, 'GET', `/api/agents/${agentId}`);
	if (g.ok) {
		const b = g.body && typeof g.body === 'object' ? g.body as Record<string, unknown> : {};
		return typeof b.status === 'string' ? b.status : null;
	}
	return g.status === 404 ? 'gone' : null;
}

/**
 * Read one approval back, to check a verdict left unfinished (after a reload) before retrying it.
 *
 * @param f Fetch.
 * @param approvalId Approval.
 * @returns Its status, the agent its payload names, and who decided it and when (if anyone has),
 *   or null when it cannot be read.
 */
export async function approvalState(f: FetchLike, approvalId: string): Promise<{ status: string; agentId: string | null; tribunal: boolean; decidedBy: string | null; decidedAt: string | null } | null> {
	if (!UUID.test(approvalId)) return null;
	const g = await request(f, 'GET', `/api/approvals/${approvalId}`);
	if (!g.ok || !g.body || typeof g.body !== 'object') return null;
	const b = g.body as Record<string, unknown>;
	const p = b.payload && typeof b.payload === 'object' ? b.payload as Record<string, unknown> : {};
	return {
		status: typeof b.status === 'string' ? b.status : '',
		agentId: typeof p.agentId === 'string' ? p.agentId : null,
		tribunal: b.type === 'request_board_approval' && p.tribunal === true,
		decidedBy: text(b.decidedByUserId, 120),
		decidedAt: text(b.decidedAt, 40),
	};
}

/**
 * Who really created an approval, and which issues it was linked to at that moment, from
 * Paperclip's own activity log. The server fills these in from the caller's credentials, so unlike
 * `requestedByAgentId` (which the caller may set to anything) an agent cannot forge them.
 *
 * @param f Fetch.
 * @param companyId Company.
 * @param approvalId Approval.
 * @returns The creating actor and linked issue ids, or null when the record cannot be read.
 */
export async function approvalOrigin(f: FetchLike, companyId: string, approvalId: string): Promise<{ actorType: string; actorId: string; issueIds: string[] } | null> {
	if (!UUID.test(companyId) || !UUID.test(approvalId)) return null;
	// The most Paperclip returns, so a pile of comments on the approval cannot push the record out.
	const g = await request(f, 'GET', `/api/companies/${companyId}/activity?entityType=approval&entityId=${approvalId}&limit=500`);
	if (!g.ok) return null;
	// Newest first: the last one is the original filing.
	const created = listOf(g.body).filter((e) => e.action === 'approval.created' && e.entityId === approvalId).at(-1);
	if (!created || typeof created.actorType !== 'string' || typeof created.actorId !== 'string') return null;
	const details = created.details && typeof created.details === 'object' ? created.details as Record<string, unknown> : {};
	const issueIds = Array.isArray(details.issueIds) ? details.issueIds.filter((x): x is string => typeof x === 'string') : [];
	return { actorType: created.actorType, actorId: created.actorId, issueIds };
}
