/**
 * Directives: the title rule, the cc footer, what each call sends, the UUID guard, reading
 * comments into chat lines, failure sentences, and a full round trip against the mock.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BODY_MAX, FOOTER_MARK, TITLE_MAX, createDirective, descriptionOf, failureWords, latestMessage, listMessages,
	listThreads, markRead, openingOf, reply, sortThreads, titleOf, toMessage, toThread, withoutFooter,
} from '../src/live/directives';
import type { FetchLike, ResponseLike } from '../src/live/http';
import { MOCK_COMPANY_ID, MOCK_USER_ID, mockFetch, mockSnapshots } from '../src/live/mock';

const CID = '11111111-2222-4333-8444-555555555555';
const AID = '22222222-2222-4333-8444-555555555555';
const LEAD = { id: '33333333-2222-4333-8444-555555555555', name: 'Comrade Director' };
const IID = '44444444-2222-4333-8444-555555555555';
const REQ = '55555555-2222-4333-8444-555555555555';

/**
 * A JSON response.
 *
 * @param body Value.
 * @param status HTTP status.
 * @returns Response-like.
 */
const json = (body: unknown, status = 200): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

/**
 * Fake fetch recording calls.
 *
 * @param answer Response for every call.
 * @returns Fetch and log.
 */
function fake(answer: (path: string) => ResponseLike) {
	const calls: { path: string; init?: RequestInit; body: unknown }[] = [];
	const f: FetchLike = async (path, init) => {
		calls.push({ path, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return answer(path);
	};
	return { f, calls };
}

const ISSUE = { id: IID, identifier: 'MKT-9', title: 'Fix it', status: 'todo', description: `Fix it${FOOTER_MARK}`, assigneeAgentId: AID, createdByUserId: 'u1', createdAt: '2026-09-23T10:00:00.000Z', updatedAt: '2026-09-23T10:00:00.000Z' };

test('the title is the first non-empty line, cut at a word with an ellipsis when long', () => {
	assert.equal(titleOf('\n\n  Fix the pricing page  \nDetails here.'), 'Fix the pricing page');
	const long = 'word '.repeat(60).trim();
	const t = titleOf(long);
	assert.ok(t.length <= TITLE_MAX, `${t.length}`);
	assert.ok(t.endsWith('…'));
	assert.doesNotMatch(t, / …$/);
	assert.equal(titleOf('x'.repeat(300)).length, TITLE_MAX);
	assert.equal(titleOf('   \n  '), '');
});

test('the description keeps the text and adds a footer that ccs the Company Lead', () => {
	const d = descriptionOf('  Do the thing.\nCarefully.  ', AID, LEAD);
	assert.ok(d.startsWith('Do the thing.\nCarefully.'));
	assert.ok(d.includes(FOOTER_MARK));
	assert.ok(d.endsWith(` cc [@Comrade Director](agent://${LEAD.id})`));
	assert.equal(withoutFooter(d), 'Do the thing.\nCarefully.');
});

test('no cc when there is no Lead, when the directive is to the Lead, or when the Lead id is odd', () => {
	for (const d of [descriptionOf('x', AID, null), descriptionOf('x', LEAD.id, LEAD), descriptionOf('x', AID, { id: 'not-a-uuid', name: 'Boss' })]) {
		assert.doesNotMatch(d, /agent:\/\//);
		assert.ok(d.endsWith(FOOTER_MARK));
	}
	// Brackets in a name cannot break the mention link.
	assert.match(descriptionOf('x', AID, { id: LEAD.id, name: 'Boss [acting] (temp)' }), /\[@Boss acting temp\]\(agent:/);
});

test('createDirective POSTs one issue, assigned and todo, as same-origin JSON with manual redirects', async () => {
	const { f, calls } = fake(() => json(ISSUE, 201));
	const r = await createDirective(f, CID, AID, 'Fix it\nsoon', LEAD);
	assert.ok(r.ok);
	assert.equal(r.value.identifier, 'MKT-9');
	assert.equal(calls.length, 1);
	assert.equal(calls[0].path, `/api/companies/${CID}/issues`);
	assert.equal(calls[0].init?.method, 'POST');
	assert.equal(calls[0].init?.credentials, 'same-origin');
	assert.equal(calls[0].init?.redirect, 'manual');
	assert.equal((calls[0].init?.headers as Record<string, string>)['content-type'], 'application/json');
	const body = calls[0].body as Record<string, unknown>;
	assert.deepEqual(Object.keys(body).sort(), ['assigneeAgentId', 'description', 'status', 'title']);
	assert.equal(body.title, 'Fix it');
	assert.equal(body.assigneeAgentId, AID);
	assert.equal(body.status, 'todo');
});

test('nothing is sent for bad ids, blank text or text over the limit', async () => {
	const { f, calls } = fake(() => json(ISSUE));
	for (const [cid, aid, text] of [['../x', AID, 'hi'], [CID, 'abc', 'hi'], [CID, AID, '   '], [CID, AID, 'x'.repeat(BODY_MAX + 1)]]) {
		const r = await createDirective(f, cid, aid, text, null);
		assert.equal(r.ok, false);
		if (!r.ok) assert.match(failureWords(r, 'The directive was not sent', 'Paperclip'), /^The directive was not sent\. .+\.$/);
	}
	assert.equal((await reply(f, { ...toThread(ISSUE)!, id: 'x/../y' }, 'hi', REQ)).ok, false);
	assert.equal((await reply(f, toThread(ISSUE)!, 'hi', 'not-uuid')).ok, false);
	assert.equal((await listMessages(f, '../../admin')).ok, false);
	assert.equal(await markRead(f, 'nope'), false);
	assert.equal(calls.length, 0);
});

test('reply posts the body with its clientRequestId, and reopens a finished thread', async () => {
	const { f, calls } = fake(() => json({ id: 'c1', body: 'Go', authorUserId: 'u1', createdAt: '2026-09-23T10:01:00Z' }, 201));
	const open = toThread(ISSUE)!;
	const r = await reply(f, open, '  Go  ', REQ);
	assert.ok(r.ok);
	assert.deepEqual(calls[0].body, { body: 'Go', clientRequestId: REQ });
	assert.equal(calls[0].path, `/api/issues/${IID}/comments`);
	await reply(f, { ...open, status: 'done' }, 'Again', REQ);
	assert.deepEqual(calls[1].body, { body: 'Again', clientRequestId: REQ, reopen: true });
});

test('comments become chat lines: agent, user, system; deleted ones are dropped', () => {
	assert.deepEqual(toMessage({ id: 'a', body: 'Hi', authorAgentId: AID, createdAt: 't' })?.author, { kind: 'agent', agentId: AID });
	assert.deepEqual(toMessage({ id: 'b', body: 'Hi', derivedAuthorAgentId: AID, authorUserId: 'local-board' })?.author, { kind: 'agent', agentId: AID });
	assert.deepEqual(toMessage({ id: 'c', body: 'Hi', authorUserId: 'u1' })?.author, { kind: 'user', userId: 'u1' });
	assert.deepEqual(toMessage({ id: 'd', body: 'Moved', authorType: 'system' })?.author, { kind: 'system' });
	assert.deepEqual(toMessage({ id: 'e', body: 'x', presentation: { kind: 'system_notice' }, authorAgentId: AID })?.author, { kind: 'system' });
	assert.equal(toMessage({ id: 'f', body: 'gone', deletedAt: '2026-01-01' }), null);
	assert.equal(toMessage({ body: 'no id' }), null);
});

test('the directive itself opens the thread, without the footer', () => {
	const m = openingOf(toThread(ISSUE)!)!;
	assert.equal(m.body, 'Fix it');
	assert.deepEqual(m.author, { kind: 'user', userId: 'u1' });
	assert.equal(openingOf({ ...toThread(ISSUE)!, description: null }), null);
});

test('threads: only the comrade’s, open ones first, newest first, at most six', async () => {
	const mk = (n: number, status: string, assignee = AID) => ({ ...ISSUE, id: `44444444-2222-4333-8444-${String(n).padStart(12, '0')}`, status, assigneeAgentId: assignee, updatedAt: `2026-09-2${n % 10}T00:00:00Z` });
	const { f, calls } = fake(() => json([mk(1, 'done'), mk(2, 'todo'), mk(3, 'in_progress'), mk(4, 'todo', LEAD.id), mk(5, 'cancelled'), mk(6, 'todo'), mk(7, 'todo'), mk(8, 'todo'), { id: 'bad' }]));
	const r = await listThreads(f, CID, AID);
	assert.ok(r.ok);
	assert.equal(calls[0].path, `/api/companies/${CID}/issues?assigneeAgentId=${AID}&limit=50`);
	assert.equal(r.value.length, 6);
	assert.ok(r.value.every((t) => t.assigneeAgentId === AID));
	assert.deepEqual(r.value.map((t) => t.status), ['todo', 'todo', 'todo', 'in_progress', 'todo', 'cancelled']);
	assert.deepEqual(sortThreads([]), []);
});

test('latestMessage finds the newest even if the server ignores order and limit', async () => {
	const { f } = fake(() => json([
		{ id: 'a', body: '1', createdAt: '2026-09-23T10:00:00Z', authorUserId: 'u' },
		{ id: 'b', body: '3', createdAt: '2026-09-23T12:00:00Z', authorAgentId: AID },
		{ id: 'c', body: '2', createdAt: '2026-09-23T11:00:00Z', authorUserId: 'u' },
	]));
	const r = await latestMessage(f, IID);
	assert.ok(r.ok && r.value);
	assert.equal(r.value.id, 'b');
	const m = await listMessages(f, IID);
	assert.ok(m.ok);
	assert.deepEqual(m.value.map((x) => x.body), ['1', '2', '3']);
});

test('failures say what happened and what to do, quoting Paperclip’s reason', async () => {
	const lapsed = await createDirective(async () => ({ type: 'opaqueredirect', status: 0, ok: false, text: async () => '' }), CID, AID, 'x', null);
	assert.ok(!lapsed.ok);
	assert.match(failureWords(lapsed, 'The directive was not sent', 'Paperclip'), /sign-in in front of Paperclip has lapsed/);
	const refused = await createDirective(async () => json({ error: 'Agent is terminated.' }, 403), CID, AID, 'x', null);
	assert.ok(!refused.ok);
	assert.equal(failureWords(refused, 'The directive was not sent', 'Paperclip'), 'The directive was not sent, because Paperclip refused it. Paperclip said: "Agent is terminated".');
	const down = await createDirective(async () => { throw new TypeError('offline'); }, CID, AID, 'x', null);
	assert.ok(!down.ok);
	assert.match(failureWords(down, 'The reply was not sent', 'Paperclip'), /^The reply was not sent, because Paperclip could not be reached/);
	const bad = await createDirective(async () => json({ error: 'Validation failed' }, 422), CID, AID, 'x', null);
	assert.ok(!bad.ok);
	assert.match(failureWords(bad, 'The directive was not sent', 'Paperclip'), /\(422\)\. Paperclip said: "Validation failed"\.$/);
});

test('round trip against the mock: issue a directive, read it back, and see the comrade reply', async () => {
	let clock = Date.UTC(2026, 8, 23, 12);
	const f = mockFetch(mockSnapshots(1), { now: () => clock, replyDelayMs: 4_000 });
	const aid = '00000000-0000-4000-8000-000000000002';
	const made = await createDirective(f, MOCK_COMPANY_ID, aid, 'Draw up the plan\nFor next quarter.', null);
	assert.ok(made.ok);
	assert.match(made.value.identifier!, /^PLT-\d+$/);
	const threads = await listThreads(f, MOCK_COMPANY_ID, aid);
	assert.ok(threads.ok);
	assert.equal(threads.value[0].id, made.value.id);
	let msgs = await listMessages(f, made.value.id);
	assert.ok(msgs.ok);
	assert.equal(msgs.value.length, 0, 'the reply is not there yet');
	clock += 4_000;
	msgs = await listMessages(f, made.value.id);
	assert.ok(msgs.ok);
	assert.equal(msgs.value.length, 1);
	assert.deepEqual(msgs.value[0].author, { kind: 'agent', agentId: aid });
	const sent = await reply(f, made.value, 'Faster, please.', REQ);
	assert.ok(sent.ok);
	assert.deepEqual(sent.value.author, { kind: 'user', userId: MOCK_USER_ID });
	assert.ok(await markRead(f, made.value.id));
	// The old thread in the mock belongs to comrade 4 and is done.
	const old = await listThreads(f, MOCK_COMPANY_ID, '00000000-0000-4000-8000-000000000004');
	assert.ok(old.ok);
	assert.equal(old.value[0].status, 'done');
});
