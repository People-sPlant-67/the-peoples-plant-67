/**
 * Directives: the chat's side of Paperclip. A new directive is a new issue assigned to the
 * comrade; a reply is a comment on that issue; a thread is the issue's description followed
 * by its comments. Pure over FetchLike, so the tests and the mock drive it under Node.
 *
 * Built from Paperclip's open-source API (POST /companies/:id/issues, GET and POST
 * /issues/:id/comments, POST /issues/:id/read). Everything read back is untrusted text.
 */
import { type Failure, type FetchLike, UUID, fail, request } from './http';
import { listOf } from './poller';

/** Longest issue title the plant writes; longer first lines are cut at a word. */
export const TITLE_MAX = 120;
/** Longest directive or reply accepted, in characters. */
export const BODY_MAX = 20_000;
/** Threads offered per comrade in the picker. */
export const THREADS_SHOWN = 6;
/** Marks the start of the footer the plant adds to a directive's description. */
export const FOOTER_MARK = "\n\n---\nIssued from The People's Plant #67.";

/** Issue statuses that count as finished. */
const CLOSED = new Set(['done', 'cancelled']);

/** The Agent Chat side of an issue: set only on a comrade's running conversation with the owner. */
export interface Conversation {
	agentId: string;
	/** 'active' while the comrade is working on an answer, 'waiting' while they wait for the owner. */
	state: 'active' | 'waiting' | null;
}

/** One issue, trimmed to what the chat shows. */
export interface Thread {
	id: string;
	/** Short human id such as "MKT-41", or null if Paperclip gave none. */
	identifier: string | null;
	title: string;
	status: string;
	description: string | null;
	assigneeAgentId: string | null;
	createdByAgentId: string | null;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
	/** Set when the issue is an Agent Chat, null for an ordinary issue. */
	conversation: Conversation | null;
}

/** Who wrote a message. 'user' carries the user id so the chat can tell the owner from anyone else. */
export type Author =
	| { kind: 'agent'; agentId: string }
	| { kind: 'user'; userId: string | null }
	| { kind: 'system' };

/** One chat line: a comment, or the directive itself (the issue description). */
export interface Message {
	id: string;
	body: string;
	/** ISO timestamp. */
	at: string;
	author: Author;
}

export type { Failure };

export type Result<T> = { ok: true; value: T } | Failure;

/**
 * A string field, or null.
 *
 * @param v Raw value.
 * @returns String or null.
 */
function str(v: unknown): string | null {
	return typeof v === 'string' ? v : null;
}

/** A failure for input the plant refuses to send, before any request is made. */
const refused = (detail: string): Failure => ({ ok: false, session: 'unreachable', status: 0, detail });

/**
 * The issue title for a directive: its first non-empty line, cut to TITLE_MAX characters at a
 * word boundary (with an ellipsis) when longer.
 *
 * @param text The directive as typed.
 * @returns Title, or an empty string for blank text.
 */
export function titleOf(text: string): string {
	const line = text.split('\n').map((l) => l.trim()).find((l) => l) ?? '';
	if (line.length <= TITLE_MAX) return line;
	const cut = line.slice(0, TITLE_MAX - 1);
	const space = cut.lastIndexOf(' ');
	return `${(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The issue description for a directive: the text as typed, then a footer saying where it
 * came from and cc'ing the Company Lead with a Paperclip agent mention. The cc is left out
 * when there is no Lead or the directive is to the Lead.
 *
 * @param text The directive as typed.
 * @param toAgentId The comrade it is assigned to.
 * @param lead The Company Lead, or null.
 * @returns Description.
 */
export function descriptionOf(text: string, toAgentId: string, lead: { id: string; name: string } | null): string {
	const cc = lead && lead.id !== toAgentId && UUID.test(lead.id)
		// Brackets or a backslash in a name would break the mention link, so they are dropped from the label.
		? ` cc [@${lead.name.replace(/[[\]()\\]/g, '')}](agent://${lead.id})`
		: '';
	return `${text.trim()}${FOOTER_MARK}${cc}`;
}

/**
 * The directive as the owner wrote it, without the plant's footer.
 *
 * @param description Issue description.
 * @returns Description with the footer removed.
 */
export function withoutFooter(description: string): string {
	const i = description.indexOf(FOOTER_MARK);
	return i >= 0 ? description.slice(0, i) : description;
}

/**
 * Read an issue.
 *
 * @param raw Issue object from the API.
 * @returns Thread, or null without a usable id.
 */
export function toThread(raw: unknown): Thread | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const id = str(r.id);
	if (!id || !UUID.test(id)) return null;
	const createdAt = str(r.createdAt) ?? new Date(0).toISOString();
	const talker = str(r.conversationAgentId);
	const state = r.conversationState === 'active' || r.conversationState === 'waiting' ? r.conversationState : null;
	return {
		id,
		identifier: str(r.identifier),
		title: str(r.title) ?? 'Untitled issue',
		status: str(r.status) ?? 'unknown',
		description: str(r.description),
		assigneeAgentId: str(r.assigneeAgentId),
		createdByAgentId: str(r.createdByAgentId),
		createdByUserId: str(r.createdByUserId),
		createdAt,
		updatedAt: str(r.updatedAt) ?? createdAt,
		conversation: talker && UUID.test(talker) ? { agentId: talker, state } : null,
	};
}

/**
 * Read a comment. Deleted comments are dropped.
 *
 * @param raw Comment object from the API.
 * @returns Message, or null.
 */
export function toMessage(raw: Record<string, unknown>): Message | null {
	const id = str(raw.id);
	if (!id || raw.deletedAt) return null;
	const presentation = raw.presentation && typeof raw.presentation === 'object' ? raw.presentation as Record<string, unknown> : null;
	const agentId = str(raw.authorAgentId) ?? str(raw.derivedAuthorAgentId);
	let author: Author;
	if (raw.authorType === 'system' || presentation?.kind === 'system_notice') author = { kind: 'system' };
	else if (agentId) author = { kind: 'agent', agentId };
	else author = { kind: 'user', userId: str(raw.authorUserId) };
	return { id, body: str(raw.body) ?? '', at: str(raw.createdAt) ?? new Date(0).toISOString(), author };
}

/**
 * The directive itself as the first chat line.
 *
 * @param t Thread.
 * @returns Message (id "issue:<id>"), or null when the issue has no description.
 */
export function openingOf(t: Thread): Message | null {
	if (!t.description) return null;
	const author: Author = t.createdByAgentId ? { kind: 'agent', agentId: t.createdByAgentId } : { kind: 'user', userId: t.createdByUserId };
	return { id: `issue:${t.id}`, body: withoutFooter(t.description), at: t.createdAt, author };
}

/**
 * Order threads for the picker: open before closed, then most recently updated first.
 *
 * @param list Threads.
 * @returns Sorted copy.
 */
export function sortThreads(list: Thread[]): Thread[] {
	return [...list].sort((a, b) => (Number(CLOSED.has(a.status)) - Number(CLOSED.has(b.status))) || b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Whether a thread is finished.
 *
 * @param t Thread.
 * @returns True when done or cancelled.
 */
export function isClosed(t: Thread): boolean {
	return CLOSED.has(t.status);
}

/**
 * Check text before sending it.
 *
 * @param text Text as typed.
 * @returns A sentence saying what is wrong, or null when it can be sent.
 */
export function problemWith(text: string): string | null {
	if (!text.trim()) return 'Write something first.';
	if (text.length > BODY_MAX) return `That is ${text.length.toLocaleString('en-GB')} characters; the limit is ${BODY_MAX.toLocaleString('en-GB')}.`;
	return null;
}

/**
 * Create a directive: a new issue assigned to the comrade, status todo.
 *
 * @param f Fetch.
 * @param companyId Company.
 * @param toAgentId Comrade.
 * @param text Directive as typed.
 * @param lead Company Lead to cc, or null.
 * @returns The new thread.
 */
export async function createDirective(f: FetchLike, companyId: string, toAgentId: string, text: string, lead: { id: string; name: string } | null): Promise<Result<Thread>> {
	if (!UUID.test(companyId) || !UUID.test(toAgentId)) return refused('The company or comrade id is not in the form Paperclip uses, so nothing was sent.');
	const problem = problemWith(text);
	if (problem) return refused(problem);
	const g = await request(f, 'POST', `/api/companies/${companyId}/issues`, {
		title: titleOf(text),
		description: descriptionOf(text, toAgentId, lead),
		assigneeAgentId: toAgentId,
		status: 'todo',
	});
	if (!g.ok) return fail(g);
	const t = toThread(g.body);
	// Created, but unreadable: reported as an unreadable success so the chat warns against resending.
	return t ? { ok: true, value: t } : { ok: false, session: 'unreachable', status: 201, detail: null };
}

/**
 * The comrade's recent issues for the picker, open first.
 *
 * @param f Fetch.
 * @param companyId Company.
 * @param agentId Comrade.
 * @returns Up to THREADS_SHOWN threads.
 */
export async function listThreads(f: FetchLike, companyId: string, agentId: string): Promise<Result<Thread[]>> {
	if (!UUID.test(companyId) || !UUID.test(agentId)) return refused('The company or comrade id is not in the form Paperclip uses.');
	const g = await request(f, 'GET', `/api/companies/${companyId}/issues?assigneeAgentId=${agentId}&limit=50`);
	if (!g.ok) return fail(g);
	// Filter here too: an older Paperclip that ignores the query would return everyone's issues.
	// The comrade's Agent Chat is an issue too, but it has a place of its own at the top of the picker.
	const mine = listOf(g.body).map(toThread).filter((t): t is Thread => !!t && t.assigneeAgentId === agentId && !t.conversation);
	return { ok: true, value: sortThreads(mine).slice(0, THREADS_SHOWN) };
}

/**
 * Read one issue.
 *
 * @param f Fetch.
 * @param issueId Issue.
 * @returns Thread.
 */
export async function getThread(f: FetchLike, issueId: string): Promise<Result<Thread>> {
	if (!UUID.test(issueId)) return refused('The issue id is not in the form Paperclip uses.');
	const g = await request(f, 'GET', `/api/issues/${issueId}`);
	if (!g.ok) return fail(g);
	const t = toThread(g.body);
	return t ? { ok: true, value: t } : refused('Paperclip sent back an issue the plant could not read.');
}

/**
 * All comments on an issue, oldest first.
 *
 * @param f Fetch.
 * @param issueId Issue.
 * @returns Messages in time order.
 */
export async function listMessages(f: FetchLike, issueId: string): Promise<Result<Message[]>> {
	if (!UUID.test(issueId)) return refused('The issue id is not in the form Paperclip uses.');
	const g = await request(f, 'GET', `/api/issues/${issueId}/comments?order=asc`);
	if (!g.ok) return fail(g);
	const list = listOf(g.body).map(toMessage).filter((m): m is Message => !!m);
	// Sort here as well, in case the order parameter is ignored.
	return { ok: true, value: list.sort((a, b) => a.at.localeCompare(b.at)) };
}

/**
 * The newest comment on an issue that is not a system notice, for the reply check.
 *
 * @param f Fetch.
 * @param issueId Issue.
 * @returns The newest message, or null when there are none.
 */
export async function latestMessage(f: FetchLike, issueId: string): Promise<Result<Message | null>> {
	if (!UUID.test(issueId)) return refused('The issue id is not in the form Paperclip uses.');
	// A few, not one: a system notice landing after a comrade's reply must not hide the reply.
	const g = await request(f, 'GET', `/api/issues/${issueId}/comments?order=desc&limit=5`);
	if (!g.ok) return fail(g);
	const list = listOf(g.body).map(toMessage).filter((m): m is Message => !!m && m.author.kind !== 'system');
	// Take the newest whatever order came back, in case limit or order is ignored.
	let newest: Message | null = null;
	for (const m of list) if (!newest || m.at > newest.at) newest = m;
	return { ok: true, value: newest };
}

/**
 * Reply on a thread. A reply to a finished issue reopens it, so the comrade picks it up.
 *
 * @param f Fetch.
 * @param thread The thread replied to.
 * @param text Reply as typed.
 * @param clientRequestId A UUID per message, so Paperclip never records a retried send twice.
 * @param attachmentIds Files already uploaded to the issue, to hang on this comment.
 * @returns The comment as saved.
 */
export async function reply(f: FetchLike, thread: Thread, text: string, clientRequestId: string, attachmentIds: readonly string[] = []): Promise<Result<Message>> {
	if (!UUID.test(thread.id) || !UUID.test(clientRequestId) || !attachmentIds.every((id) => UUID.test(id))) return refused('The issue id is not in the form Paperclip uses, so nothing was sent.');
	const problem = problemWith(text);
	if (problem) return refused(problem);
	const body: Record<string, unknown> = { body: text.trim(), clientRequestId };
	if (attachmentIds.length) body.attachmentIds = [...attachmentIds];
	if (isClosed(thread)) body.reopen = true;
	const g = await request(f, 'POST', `/api/issues/${thread.id}/comments`, body);
	if (!g.ok) return fail(g);
	const m = g.body && typeof g.body === 'object' && !Array.isArray(g.body) ? toMessage(g.body as Record<string, unknown>) : null;
	// Paperclip saved it; if the reply cannot be read, show what was sent.
	return { ok: true, value: m ?? { id: `sent:${clientRequestId}`, body: text.trim(), at: new Date().toISOString(), author: { kind: 'user', userId: null } } };
}

/**
 * Mark an issue read for the signed-in board user, as opening it in the dashboard would.
 * Best effort: the result is ignored by the chat.
 *
 * @param f Fetch.
 * @param issueId Issue.
 * @returns Whether Paperclip accepted it.
 */
export async function markRead(f: FetchLike, issueId: string): Promise<boolean> {
	if (!UUID.test(issueId)) return false;
	return (await request(f, 'POST', `/api/issues/${issueId}/read`, {})).ok;
}

/**
 * The signed-in board user's id, from Paperclip's session endpoint. Only the id is read: the
 * answer also carries profile fields the plant has no use for.
 *
 * @param f Fetch.
 * @returns The id, or null when Paperclip did not say.
 */
export async function whoAmI(f: FetchLike): Promise<string | null> {
	const r = await request(f, 'GET', '/api/auth/get-session');
	if (!r.ok || !r.body || typeof r.body !== 'object') return null;
	const s = (r.body as Record<string, unknown>).session;
	const id = s && typeof s === 'object' ? (s as Record<string, unknown>).userId : null;
	return typeof id === 'string' && id.trim() && id.length <= 200 ? id.trim() : null;
}

/**
 * A sentence for a failed send or load, saying what happened and what to do.
 *
 * @param r Failure.
 * @param what What was being done, e.g. "The directive was not sent".
 * @param server What the plant calls the server ("Paperclip", "the bridge").
 * @returns Complete sentence(s).
 */
export function failureWords(r: Failure, what: string, server: string): string {
	const Server = server.charAt(0).toUpperCase() + server.slice(1);
	const why = r.detail ? ` ${Server} said: "${r.detail.replace(/[."]+$/, '')}".` : '';
	switch (r.session) {
		case 'access-lapsed': return `${what}, because your sign-in in front of ${server} has lapsed. Sign in on the dashboard, then try again.`;
		case 'signed-out': return `${what}, because ${server} refused it.${why || ' Your session may have expired; sign in on the dashboard, then try again.'}`;
		case 'no-company': return `${what}, because the plant has no company to send it to yet.`;
		case 'company-gone': return `${what}, because the company chosen for this plant is no longer listed in ${server}.`;
		default: return r.status === 0 && r.detail ? `${what}. ${r.detail}` : `${what}, because ${server} could not be reached or answered with an error${r.status ? ` (${r.status})` : ''}.${why}`;
	}
}
