/**
 * Agent Chat: a comrade's one running conversation with the owner. In Paperclip it is an
 * ordinary issue with conversation fields, so reading and replying reuse directives.ts; this
 * file finds it and opens it.
 *
 * Seen on the live instance (2026.916.0): there is no list of chats, only
 * GET /companies/:id/chats/:agent (the chat, or null before the first message) and POST on the
 * same path (opens it). A chat never closes. A comment of exactly "/new" starts a fresh
 * conversation: the comrade forgets the earlier one, and the history stays.
 */
import { type Failure, type Result, type Thread, toThread } from './directives';
import { type FetchLike, UUID, fail, request } from './http';

/** The message that starts a fresh conversation in Paperclip. */
export const FRESH_START = '/new';

/**
 * Whether a failure means this Paperclip has no Agent Chat (switched off, or a build without
 * the route), as opposed to a passing fault.
 *
 * @param r Failure.
 * @returns True when the chat cannot be used on this instance.
 */
export function chatUnavailable(r: Failure): boolean {
	return r.status === 404 && /route not found|agent chat is disabled/i.test(r.detail ?? '');
}

/**
 * Check the ids that go into the request path.
 *
 * @param companyId Company.
 * @param agentId Comrade.
 * @returns A refusal, or null when both are UUIDs.
 */
function badIds(companyId: string, agentId: string): Failure | null {
	return UUID.test(companyId) && UUID.test(agentId) ? null : { ok: false, session: 'unreachable', status: 0, detail: 'The company or comrade id is not in the form Paperclip uses, so nothing was sent.' };
}

/**
 * Read an answer that should be a chat.
 *
 * @param body Response body.
 * @param agentId The comrade asked about.
 * @returns The chat, or null when the answer is not the comrade's chat.
 */
function chatOf(body: unknown, agentId: string): Thread | null {
	const t = toThread(body);
	return t && t.conversation?.agentId === agentId ? t : null;
}

/**
 * The comrade's chat with the owner, or null before the first message.
 *
 * @param f Fetch.
 * @param companyId Company.
 * @param agentId Comrade.
 * @returns The chat, null, or a failure (see chatUnavailable).
 */
export async function getChat(f: FetchLike, companyId: string, agentId: string): Promise<Result<Thread | null>> {
	const bad = badIds(companyId, agentId);
	if (bad) return bad;
	const g = await request(f, 'GET', `/api/companies/${companyId}/chats/${agentId}`);
	if (!g.ok) return fail(g);
	if (g.body === null) return { ok: true, value: null };
	const t = chatOf(g.body, agentId);
	return t ? { ok: true, value: t } : { ok: false, session: 'unreachable', status: 0, detail: 'Paperclip sent back a chat the plant could not read.' };
}

/**
 * Open the comrade's chat, or find it if it is already open. Called on the first message, so
 * merely looking at a comrade never creates an issue.
 *
 * @param f Fetch.
 * @param companyId Company.
 * @param agentId Comrade.
 * @returns The chat.
 */
export async function ensureChat(f: FetchLike, companyId: string, agentId: string): Promise<Result<Thread>> {
	const bad = badIds(companyId, agentId);
	if (bad) return bad;
	const g = await request(f, 'POST', `/api/companies/${companyId}/chats/${agentId}`, {});
	if (!g.ok) return fail(g);
	const t = chatOf(g.body, agentId);
	return t ? { ok: true, value: t } : { ok: false, session: 'unreachable', status: 200, detail: null };
}
