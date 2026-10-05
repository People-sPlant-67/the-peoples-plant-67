/**
 * Interactions: reading each kind, falling back to 'unknown' for anything the
 * plant cannot show, locking a confirmation that approves a tool action or a secret, and answering
 * only a question that is still pending and unchanged, at the endpoint named for the answer.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FetchLike, ResponseLike } from '../src/live/http';
import { answer, listInteractions, outcomeWords, toInteraction } from '../src/live/interactions';

const IID = '44444444-2222-4333-8444-555555555555';
const XID = '66666666-2222-4333-8444-555555555555';
const AID = '22222222-2222-4333-8444-555555555555';
const json = (body: unknown, status = 200): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
/**
 * An interaction as Paperclip sends it.
 *
 * @param kind Kind.
 * @param payload Payload.
 * @param extra Other fields.
 * @returns Raw object.
 */
const raw = (kind: string, payload: unknown, extra: Record<string, unknown> = {}) => ({ id: XID, issueId: IID, kind, status: 'pending', title: 'T', payload, continuationPolicy: 'wake_assignee', createdAt: '2026-09-30T10:00:00Z', ...extra });

test('each kind reads as the plant shows it, as seen live for questions and confirmations', () => {
	const q = toInteraction(raw('ask_user_questions', { version: 1, supersedeOnUserComment: true, questions: [{ id: 'q1', prompt: 'Which?', required: true, selectionMode: 'single', options: [{ id: 'a', label: 'A', freeText: false }, { id: 'o', label: 'Other', freeText: true }] }] }));
	assert.ok(q && q.kind === 'questions');
	assert.equal(q.wakes, 'answer', 'wake_assignee: the answer starts a run');
	assert.equal(q.supersededByMessage, true);
	assert.deepEqual(q.questions[0].options.map((o) => o.freeText), [false, true]);
	const c = toInteraction(raw('request_confirmation', { version: 1, prompt: 'Go?', detailsMarkdown: 'More.', acceptLabel: 'Yes', rejectLabel: 'No', allowDeclineReason: true, rejectRequiresReason: false, target: null }));
	assert.ok(c && c.kind === 'confirm' && c.locked === null && c.reasonAllowed && !c.reasonRequired);
	const tool = toInteraction(raw('request_confirmation', { version: 1, prompt: 'Run it?', toolAction: { name: 'x' } }));
	assert.ok(tool && tool.kind === 'confirm' && /action by a tool/.test(tool.locked!), 'a tool action is decided in Paperclip');
	const secret = toInteraction(raw('request_confirmation', { version: 1, prompt: 'Store it?', secretProposal: {} }));
	assert.ok(secret && secret.kind === 'confirm' && /secret/.test(secret.locked!));
	const cb = toInteraction(raw('request_checkbox_confirmation', { version: 1, prompt: 'Which?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], defaultSelectedOptionIds: ['a', 'zzz'], minSelected: 1, maxSelected: 1 }));
	assert.ok(cb && cb.kind === 'checklist');
	assert.deepEqual([cb.defaults, cb.min, cb.max], [['a'], 1, 1], 'a default that is not an option is dropped');
	const tasks = toInteraction(raw('suggest_tasks', { version: 1, tasks: [{ clientKey: 'p', title: 'Parent', assigneeAgentId: AID }, { clientKey: 'c', parentClientKey: 'p', title: 'Child', assigneeAgentId: '../x' }] }));
	assert.ok(tasks && tasks.kind === 'tasks');
	assert.deepEqual(tasks.tasks.map((t) => [t.key, t.parentKey, t.assigneeAgentId]), [['p', null, AID], ['c', 'p', null]], 'an assignee id not in Paperclip\'s form is dropped');
	const v = toInteraction(raw('request_item_verdicts', { version: 1, prompt: 'Which?', items: [{ id: 'i1', label: 'One' }] }));
	assert.ok(v && v.kind === 'verdicts');
	assert.deepEqual([v.verdicts, v.reasonOn], [['approve', 'reject'], ['reject']], 'Paperclip\'s defaults');
	const conn = toInteraction(raw('connection_intent', { version: 1, serviceName: 'GitHub', serviceSlug: 'github' }));
	assert.ok(conn && conn.kind === 'connect' && conn.service === 'GitHub');
});

test('anything the plant cannot read in full is shown as unknown, not half-shown', () => {
	for (const [kind, payload] of [
		['ask_user_questions', { questions: [{ id: 'q', prompt: 'P', selectionMode: 'text', options: [{ id: 'a', label: 'A' }] }] }],
		['ask_user_questions', { questions: [] }],
		['request_confirmation', { prompt: '' }],
		['suggest_tasks', { tasks: [{ clientKey: 'k' }] }],
		['request_item_verdicts', { prompt: 'P', items: [{ id: 'i', label: 'L' }], verdicts: ['approve', 'defer'] }],
		['a_kind_from_the_future', {}],
	] as const) {
		const i = toInteraction(raw(kind, payload));
		assert.equal(i?.kind, 'unknown', kind);
	}
	assert.equal(toInteraction({ ...raw('suggest_tasks', {}), id: 'nope' }), null);
});

test('an answer goes only to a question still pending and unchanged, at the endpoint named for it', async () => {
	const shown = toInteraction(raw('request_confirmation', { version: 1, prompt: 'Go?' }))!;
	let now: unknown = raw('request_confirmation', { version: 1, prompt: 'Go?' });
	const posts: { path: string; body: unknown }[] = [];
	const f: FetchLike = async (path, init) => {
		if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(String(init.body)) }); return json({ ...(now as object), status: 'rejected' }); }
		return json([now]);
	};
	let r = await answer(f, shown, { kind: 'reject', reason: 'Not now.' });
	assert.ok(r.ok);
	assert.deepEqual(posts, [{ path: `/api/issues/${IID}/interactions/${XID}/reject`, body: { reason: 'Not now.' } }]);
	now = { ...(now as object), status: 'accepted' };
	r = await answer(f, shown, { kind: 'accept' });
	assert.ok(!r.ok && 'stale' in r && /answered or withdrawn meanwhile/.test(r.stale));
	now = raw('request_confirmation', { version: 1, prompt: 'Go now, and delete the archive?' });
	r = await answer(f, shown, { kind: 'accept' });
	assert.ok(!r.ok && 'stale' in r && /changed after you read it/.test(r.stale), 'a question edited after it was read is not answered');
	now = null;
	r = await answer(f, shown, { kind: 'accept' });
	assert.ok(!r.ok && 'stale' in r && /no longer there/.test(r.stale));
	assert.equal(posts.length, 1, 'nothing else was sent');
	const locked = toInteraction(raw('request_confirmation', { version: 1, prompt: 'Run?', toolAction: {} }))!;
	r = await answer(f, locked, { kind: 'accept' });
	assert.ok(!r.ok && 'stale' in r, 'a locked confirmation is never answered from the plant');
	const list = await listInteractions(async () => json([raw('request_confirmation', { version: 1, prompt: 'Go?' }, { issueId: XID })]), IID);
	assert.ok(list.ok && list.value.length === 0, 'an interaction of another issue is not taken for this one');
	assert.equal(outcomeWords({ ...shown, status: 'expired' }), '"T": withdrawn by a later message.');
});

test('a form longer than Paperclip takes answers to is answered in Paperclip; the result is part of what "unchanged" means', () => {
	const many = Array.from({ length: 21 }, (_, k) => ({ id: `q${k}`, prompt: 'P', selectionMode: 'single', options: [{ id: 'a', label: 'A' }] }));
	assert.equal(toInteraction(raw('ask_user_questions', { version: 1, questions: many }))?.kind, 'unknown');
	const a = toInteraction(raw('request_item_verdicts', { version: 1, prompt: 'P', items: [{ id: 'i', label: 'L' }] }))!;
	const b = toInteraction({ ...raw('request_item_verdicts', { version: 1, prompt: 'P', items: [{ id: 'i', label: 'L' }] }), result: { verdicts: [{ id: 'i', verdict: 'approve' }] } })!;
	assert.notEqual(a.fingerprint, b.fingerprint, 'an item decided in Paperclip meanwhile makes the slip stale');
	assert.equal(toInteraction({ ...raw('request_confirmation', { version: 1, prompt: 'P' }), continuationPolicy: 'wake_assignee_on_accept' })?.wakes, 'yes');
	assert.equal(toInteraction({ ...raw('request_confirmation', { version: 1, prompt: 'P' }), continuationPolicy: 'none' })?.wakes, null);
});
