/**
 * The question watch: it reads the pending questions in the conversations started from
 * the plant (recent ones, at most ASKS_MAX), sums them per comrade with the oldest deciding where
 * to go, keeps what it knew through a failed read, says when something changed, and rings for a
 * question it has not seen before, but not for what was waiting when the plant opened.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASKS_MAX, ASKS_RECENT_MS, createAsksWatch } from '../src/cockpit/asks-watch';
import { createTracked } from '../src/cockpit/tracked';
import type { FetchLike, ResponseLike } from '../src/live/http';

const NOW = Date.parse('2026-10-01T10:00:00Z');
/**
 * An id in Paperclip's form.
 *
 * @param n Number.
 * @returns UUID.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
/**
 * A pending (or answered) question on an issue, as Paperclip sends it.
 *
 * @param issue Issue id.
 * @param n Interaction number.
 * @param status Status.
 * @param at Created at.
 * @returns Raw interaction.
 */
const ask = (issue: string, n: number, status = 'pending', at = '2026-10-01T09:00:00Z') => ({
	id: id(9000 + n), issueId: issue, kind: 'request_confirmation', status, title: 'T', createdAt: at, continuationPolicy: 'wake_assignee',
	payload: { version: 1, prompt: 'Go?' },
});

test('questions are summed per comrade; the oldest decides where to go; answered ones do not count', async () => {
	const tracked = createTracked(null);
	const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
	tracked.add(id(1), id(100), at(5000), true);
	tracked.add(id(2), id(100), at(4000));
	tracked.add(id(3), id(101), at(3000));
	tracked.add(id(4), id(102), at(ASKS_RECENT_MS + 1));
	const lists = new Map<string, unknown[]>([
		[id(1), [ask(id(1), 1, 'pending', '2026-10-01T09:30:00Z')]],
		[id(2), [ask(id(2), 2, 'pending', '2026-10-01T09:10:00Z'), ask(id(2), 3, 'answered')]],
		[id(3), [ask(id(3), 4, 'accepted')]],
		[id(4), [ask(id(4), 5)]],
	]);
	const asked: string[] = [];
	const f: FetchLike = async (path) => {
		const issue = path.split('/').at(-2)!;
		asked.push(issue);
		return json(lists.get(issue) ?? []);
	};
	let changes = 0;
	const bells: number[] = [];
	const w = createAsksWatch({ fetchImpl: f, tracked, now: () => NOW, onChange: () => changes++, onNew: (n) => bells.push(n) });
	assert.equal(w.checks, 0);
	await w.check();
	assert.ok(!asked.includes(id(4)), 'an old conversation is left alone');
	assert.deepEqual([...w.waiting.values()], [{ agentId: id(100), count: 2, issueId: id(2), chat: false }], 'the directive holds the older question');
	assert.equal(changes, 1);
	assert.deepEqual(bells, [], 'what waited when the plant opened does not ring');
	assert.equal(w.checks, 1);
	await w.check();
	assert.equal(changes, 1, 'nothing changed, nothing said');
	lists.set(id(3), [ask(id(3), 6)]);
	await w.check();
	assert.deepEqual(bells, [1], 'a new question rings once');
	assert.equal(w.waiting.get(id(101))?.count, 1);
	await w.check();
	assert.deepEqual(bells, [1], 'and not again');
	lists.set(id(2), [ask(id(2), 2, 'answered')]);
	await w.check();
	assert.deepEqual(w.waiting.get(id(100)), { agentId: id(100), count: 1, issueId: id(1), chat: true }, 'answered: the chat\'s question is what is left');
});

test('a failed read keeps what was known; at most ASKS_MAX conversations are read', async () => {
	const tracked = createTracked(null);
	for (let k = 1; k <= ASKS_MAX + 2; k++) tracked.add(id(k), id(200 + k), new Date(NOW - 1000 * (ASKS_MAX + 3 - k)).toISOString());
	let down = false;
	const asked: string[] = [];
	const f: FetchLike = async (path) => {
		const issue = path.split('/').at(-2)!;
		asked.push(issue);
		if (down) return json({ error: 'down' }, 503);
		return json(issue === id(ASKS_MAX + 2) ? [ask(issue, 1)] : []);
	};
	const w = createAsksWatch({ fetchImpl: f, tracked, now: () => NOW, onChange: () => {} });
	await w.check();
	assert.equal(asked.length, ASKS_MAX);
	assert.equal(w.waiting.get(id(200 + ASKS_MAX + 2))?.count, 1, 'the newest are read first');
	down = true;
	await w.check();
	assert.equal(w.waiting.get(id(200 + ASKS_MAX + 2))?.count, 1, 'kept through a failure');
});

test('a conversation whose first read failed does not ring for what was already waiting once it is read', async () => {
	const tracked = createTracked(null);
	tracked.add(id(1), id(300), new Date(NOW - 1000).toISOString());
	let down = true;
	const f: FetchLike = async (path) => (down ? json({ error: 'down' }, 503) : json([ask(path.split('/').at(-2)!, 1)]));
	const bells: number[] = [];
	const fresh: number[] = [];
	const w = createAsksWatch({ fetchImpl: f, tracked, now: () => NOW, onChange: (n) => fresh.push(n), onNew: (n) => bells.push(n) });
	await w.check();
	down = false;
	await w.check();
	assert.equal(w.waiting.get(id(300))?.count, 1, 'the question is found');
	assert.deepEqual(bells, [], 'but it was waiting all along: no bell');
	assert.deepEqual(fresh, [0], 'and nothing for the poster to unroll');
});
