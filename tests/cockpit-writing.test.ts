/**
 * The "…" bubble's watch: it follows only chats the owner has written in from the
 * plant, recently, says when a comrade starts and stops writing, keeps what it knew when a read
 * fails, and takes the open chat's word at once. Plus the chat flag in the tracked list.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRACK_MAX, createTracked } from '../src/cockpit/tracked';
import { PANEL_WORD_MS, WRITING_FAILS_MAX, WRITING_MAX, WRITING_RECENT_MS, createWritingWatch } from '../src/cockpit/writing';
import type { FetchLike, ResponseLike } from '../src/live/http';

const NOW = Date.parse('2026-09-30T10:00:00Z');
/**
 * An id in Paperclip's form.
 *
 * @param n Number.
 * @returns UUID.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

test('the tracked list keeps the chat flag, and writing again never moves "seen" backwards', () => {
	const store = new Map<string, string>();
	const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
	const t = createTracked(s);
	t.add(id(1), id(100), '2026-09-30T10:00:00Z', true);
	t.add(id(2), id(101), '2026-09-30T10:01:00Z');
	t.markSeen(id(1), '2026-09-30T10:05:00Z');
	t.add(id(1), id(100), '2026-09-30T10:03:00Z', true);
	const again = createTracked(s);
	const chat = again.all().find((x) => x.issueId === id(1))!;
	assert.equal(chat.chat, true);
	assert.equal(chat.seenAt, '2026-09-30T10:05:00Z');
	assert.equal(again.all()[0].issueId, id(1), 'writing again brings it to the front');
	assert.equal(again.all().find((x) => x.issueId === id(2))!.chat, undefined, 'a directive has no flag');
	store.set('plant67.directives', JSON.stringify([{ issueId: id(3), agentId: id(1), issuedAt: 'x', seenAt: 'x', unread: false, chat: 'yes' }]));
	assert.equal(createTracked(s).all().length, 0, 'a malformed flag drops the record');
});

test('the writing watch follows recent chats only, says who starts and stops, and keeps what it knew through a failure', async () => {
	const tracked = createTracked(null);
	const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
	tracked.add(id(9), id(109), at(WRITING_RECENT_MS + 1000), true);
	for (let k = 1; k <= WRITING_MAX + 1; k++) tracked.add(id(k), id(100 + k), at(1000 * (WRITING_MAX + 2 - k)), true);
	tracked.add(id(50), id(150), at(0));
	const states = new Map<string, string>([[id(WRITING_MAX + 1), 'active'], [id(1), 'active']]);
	const asked: string[] = [];
	let down = false;
	const f: FetchLike = async (path) => {
		const issue = path.split('/').at(-1)!;
		asked.push(issue);
		if (down) return json({ error: 'down' }, 503);
		return json({ id: issue, conversationAgentId: id(100 + Number(issue.slice(-2))), conversationState: states.get(issue) ?? 'waiting' });
	};
	const changes: string[][] = [];
	const done: string[] = [];
	const w = createWritingWatch({ fetchImpl: f, tracked, now: () => NOW, onChange: (s) => changes.push([...s].sort()), onDone: (a) => done.push(a) });
	await w.check();
	assert.equal(asked.length, WRITING_MAX, 'at most WRITING_MAX chats a check');
	assert.ok(!asked.includes(id(9)), 'an old chat is left alone');
	assert.ok(!asked.includes(id(50)), 'a directive is not a chat');
	assert.deepEqual([...w.writing].sort(), [id(100 + WRITING_MAX + 1)], 'the newest chats are checked: the oldest recent one fell off the end');
	assert.equal(changes.length, 1);
	down = true;
	await w.check();
	assert.deepEqual([...w.writing], [id(100 + WRITING_MAX + 1)], 'a failed read keeps what was known');
	assert.equal(changes.length, 1, 'and says nothing');
	down = false;
	states.clear();
	await w.check();
	assert.equal(w.writing.size, 0);
	assert.deepEqual(done, [id(100 + WRITING_MAX + 1)], 'stopping is reported, so the reply check can look now');
	w.see(id(101), true);
	assert.ok(w.writing.has(id(101)), 'the open chat\'s word counts at once');
	w.see(id(101), true);
	assert.equal(changes.length, 3, 'saying the same again changes nothing');
});

test('the open chat\'s word holds for a chat the watch does not check, but not for ever; a chat that cannot be read loses its "…"', async () => {
	const tracked = createTracked(null);
	let t = NOW;
	let down = false;
	const f: FetchLike = async (path) => {
		const issue = path.split('/').at(-1)!;
		return down ? json({ error: 'gone' }, 404) : json({ id: issue, conversationAgentId: id(201), conversationState: 'active' });
	};
	const w = createWritingWatch({ fetchImpl: f, tracked, now: () => t, onChange: () => {} });
	w.see(id(300), true);
	await w.check();
	assert.ok(w.writing.has(id(300)), 'a chat opened in Paperclip, seen writing by the open card, stays on');
	t += PANEL_WORD_MS + 1;
	await w.check();
	assert.ok(!w.writing.has(id(300)), 'until the card stops saying so');
	tracked.add(id(1), id(201), new Date(t).toISOString(), true);
	await w.check();
	assert.ok(w.writing.has(id(201)));
	down = true;
	for (let k = 1; k < WRITING_FAILS_MAX; k++) { await w.check(); assert.ok(w.writing.has(id(201)), `failure ${k} keeps it`); }
	await w.check();
	assert.ok(!w.writing.has(id(201)), 'failing every time drops it');
});

test('chats never push directives out of the tracked list', () => {
	const t = createTracked(null);
	for (let k = 0; k < TRACK_MAX; k++) t.add(id(k), id(500), new Date(NOW + k).toISOString());
	for (let k = 0; k < 5; k++) t.add(id(100 + k), id(600 + k), new Date(NOW + 100 + k).toISOString(), true);
	assert.equal(t.all().filter((x) => !x.chat).length, TRACK_MAX);
	assert.equal(t.all().filter((x) => x.chat).length, 5);
	t.add(id(999), id(500), new Date(NOW + 999).toISOString());
	assert.equal(t.all().filter((x) => !x.chat).length, TRACK_MAX, 'a new directive pushes out only the oldest directive');
	assert.ok(!t.has(id(0)));
});
