/**
 * Agent Chat and files, against the mock and a recording fetch: finding and
 * opening a comrade's chat, telling "no Agent Chat here" from a passing fault, the chat's writing
 * state, the chat kept out of the issues list, uploading and listing files, the size check made
 * before any upload, and files hung on a reply.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_FILE_BYTES, fileProblem, listParcels, parcelHref, sizeWords, toParcel, uploadFile } from '../src/live/attachments';
import { FRESH_START, chatUnavailable, ensureChat, getChat } from '../src/live/chats';
import { getThread, listMessages, listThreads, reply, toThread } from '../src/live/directives';
import type { FetchLike, ResponseLike } from '../src/live/http';
import { MOCK_COMPANY_ID, mockFetch, mockSnapshots } from '../src/live/mock';

const A = '00000000-0000-4000-8000-000000000002';
const IID = '44444444-2222-4333-8444-555555555555';
const REQ = '55555555-2222-4333-8444-555555555555';

/**
 * A mock Paperclip with Agent Chat, on a hand-driven clock.
 *
 * @param agentChat Serve Agent Chat.
 * @returns Fetch and clock.
 */
function paperclip(agentChat = true) {
	const clock = { t: Date.parse('2026-09-30T10:00:00Z') };
	const f = mockFetch(mockSnapshots(1), { agentChat, replyDelayMs: 4_000, now: () => clock.t });
	return { f, clock };
}

/**
 * A JSON response.
 *
 * @param body Value.
 * @param status HTTP status.
 * @returns Response-like.
 */
const json = (body: unknown, status = 200): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

test('a comrade has no chat until the first message; opening it twice gives the same one', async () => {
	const { f } = paperclip();
	const none = await getChat(f, MOCK_COMPANY_ID, A);
	assert.deepEqual(none, { ok: true, value: null }, 'looking never creates one');
	const made = await ensureChat(f, MOCK_COMPANY_ID, A);
	assert.ok(made.ok);
	assert.equal(made.value.conversation?.agentId, A);
	assert.equal(made.value.conversation?.state, 'waiting');
	const again = await ensureChat(f, MOCK_COMPANY_ID, A);
	assert.ok(again.ok);
	assert.equal(again.value.id, made.value.id);
	const found = await getChat(f, MOCK_COMPANY_ID, A);
	assert.ok(found.ok && found.value?.id === made.value.id);
	const issues = await listThreads(f, MOCK_COMPANY_ID, A);
	assert.ok(issues.ok && issues.value.every((t) => t.id !== made.value.id), 'the chat is not also listed as an issue');
});

test('a Paperclip without Agent Chat is told apart from a passing fault, and ids are checked first', async () => {
	const { f } = paperclip(false);
	const r = await getChat(f, MOCK_COMPANY_ID, A);
	assert.ok(!r.ok && chatUnavailable(r), 'the live build\'s 404 "API route not found"');
	assert.ok(chatUnavailable({ ok: false, session: 'unreachable', status: 404, detail: 'Agent Chat is disabled' }), 'switched off');
	assert.ok(!chatUnavailable({ ok: false, session: 'unreachable', status: 404, detail: 'Agent not found' }), 'a missing comrade is not a missing feature');
	assert.ok(!chatUnavailable({ ok: false, session: 'unreachable', status: 503, detail: null }));
	let asked = 0;
	const counting: FetchLike = async () => { asked++; return json(null); };
	const bad = await getChat(counting, MOCK_COMPANY_ID, '../agents/x');
	assert.ok(!bad.ok);
	assert.equal(asked, 0, 'a crafted id never reaches a request');
	const stray = await getChat(async () => json({ id: IID, conversationAgentId: '99999999-2222-4333-8444-555555555555' }), MOCK_COMPANY_ID, A);
	assert.ok(!stray.ok, 'someone else\'s chat is not taken for this comrade\'s');
});

test('the chat reads "active" while the comrade writes, then "waiting" once the answer lands; "/new" gets its own answer', async () => {
	const { f, clock } = paperclip();
	const chat = await ensureChat(f, MOCK_COMPANY_ID, A);
	assert.ok(chat.ok);
	const sent = await reply(f, chat.value, 'Report on the boilers.', REQ);
	assert.ok(sent.ok);
	let t = await getThread(f, chat.value.id);
	assert.ok(t.ok && t.value.conversation?.state === 'active');
	clock.t += 4_001;
	t = await getThread(f, chat.value.id);
	assert.ok(t.ok && t.value.conversation?.state === 'waiting');
	await reply(f, chat.value, FRESH_START, '66666666-2222-4333-8444-555555555555');
	clock.t += 4_001;
	const lines = await listMessages(f, chat.value.id);
	assert.ok(lines.ok);
	assert.match(lines.value.at(-1)!.body, /clean page/);
	assert.equal(toThread({ id: IID, conversationAgentId: A, conversationState: 'thinking' })?.conversation?.state, null, 'an unknown state is no state');
	assert.equal(toThread({ id: IID, conversationAgentId: 'not-a-uuid' })?.conversation, null);
});

test('files: sizes in words, refused before any upload when empty or too big, and fetched only as downloads', async () => {
	assert.equal(sizeWords(500), '500 bytes');
	assert.equal(sizeWords(12_345), '12 KB');
	assert.equal(sizeWords(3.4 * 1024 * 1024), '3.4 MB');
	assert.equal(sizeWords(MAX_FILE_BYTES), '10 MB');
	assert.equal(fileProblem({ name: 'a.txt', size: 3 }), null);
	assert.match(fileProblem({ name: 'big.zip', size: MAX_FILE_BYTES + 1 })!, /big\.zip is 10 MB; Paperclip takes files up to 10 MB/);
	assert.match(fileProblem({ name: 'nil.txt', size: 0 })!, /empty/);
	let asked = 0;
	const counting: FetchLike = async () => { asked++; return json({}); };
	const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big.zip');
	const r = await uploadFile(counting, MOCK_COMPANY_ID, IID, big);
	assert.ok(!r.ok && r.status === 0 && /10 MB/.test(r.detail!));
	assert.equal(asked, 0, 'the live instance drops the connection above the limit, so the plant never tries');
	const p = toParcel({ id: IID, originalFilename: '  plan.csv ', byteSize: 42, issueCommentId: REQ });
	assert.deepEqual(p, { id: IID, name: 'plan.csv', bytes: 42, commentId: REQ });
	assert.equal(parcelHref(p!), `/api/attachments/${IID}/content?download=1`, 'a download, never a page opened with the owner\'s sign-in');
	assert.equal(toParcel({ id: 'x' }), null);
	assert.equal(toParcel({ id: IID })?.name, 'A file');
});

test('files: uploaded as multipart, then hung on a reply; Paperclip\'s refusal comes back in its words', async () => {
	const { f } = paperclip();
	const chat = await ensureChat(f, MOCK_COMPANY_ID, A);
	assert.ok(chat.ok);
	const up = await uploadFile(f, MOCK_COMPANY_ID, chat.value.id, new File(['quota,4\n'], 'quota.csv', { type: 'text/csv' }));
	assert.ok(up.ok);
	assert.equal(up.value.name, 'quota.csv');
	assert.equal(up.value.commentId, null, 'on the issue until a comment takes it');
	const sent = await reply(f, chat.value, 'The quota, attached.', REQ, [up.value.id]);
	assert.ok(sent.ok);
	const files = await listParcels(f, chat.value.id);
	assert.ok(files.ok);
	assert.deepEqual(files.value.map((p) => [p.name, p.commentId]), [['quota.csv', sent.value.id]]);
	let seen: RequestInit | undefined;
	const refusing: FetchLike = async (_p, init) => { seen = init; return json({ error: 'Attachment type is not allowed' }, 422); };
	const no = await uploadFile(refusing, MOCK_COMPANY_ID, IID, new File(['x'], 'run.exe'));
	assert.ok(!no.ok && no.detail === 'Attachment type is not allowed');
	assert.ok(seen?.body instanceof FormData, 'sent as a form');
	assert.equal((seen?.headers as Record<string, string>)['content-type'], undefined, 'the browser sets the multipart boundary');
	const badIds = await reply(f, chat.value, 'x', REQ, ['../../x']);
	assert.ok(!badIds.ok, 'attachment ids are checked like any other id');
});
