/**
 * The plant's memory of issued directives and the reply check that drives the "…" bubble.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDirective } from '../src/live/directives';
import { MOCK_COMPANY_ID, mockFetch, mockSnapshots } from '../src/live/mock';
import { REPLY_CHECK_MAX, createReplyWatch } from '../src/cockpit/replies';
import { TRACK_KEY, TRACK_MAX, type StoreLike, createTracked } from '../src/cockpit/tracked';

/**
 * In-memory storage.
 *
 * @returns Store and its backing map.
 */
function memory(): StoreLike & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

test('a comrade writing after the last seen comment is unread; the owner writing is not', () => {
	const t = createTracked(memory());
	t.add('i1', 'a1', '2026-09-23T10:00:00Z');
	assert.equal(t.sawLatest('i1', '2026-09-23T10:05:00Z', false), false);
	assert.equal(t.sawLatest('i1', '2026-09-23T09:00:00Z', true), false, 'older than issued');
	assert.equal(t.sawLatest('i1', '2026-09-23T10:05:00Z', true), true);
	assert.deepEqual([...t.unreadAgents()], ['a1']);
	assert.equal(t.unreadFor('a1')?.issueId, 'i1');
	assert.equal(t.markSeen('i1', '2026-09-23T10:05:00Z'), true);
	assert.equal(t.unreadAgents().size, 0);
	assert.equal(t.sawLatest('i1', '2026-09-23T10:05:00Z', true), false, 'already seen');
	assert.equal(t.sawLatest('unknown', '2030-01-01T00:00:00Z', true), false);
});

test('survives a reload, keeps only the newest thirty, and ignores junk in storage', () => {
	const store = memory();
	const t = createTracked(store);
	for (let i = 0; i < TRACK_MAX + 5; i++) t.add(`i${i}`, 'a', `2026-09-23T10:${String(i).padStart(2, '0')}:00Z`);
	t.sawLatest(`i${TRACK_MAX + 4}`, '2030-01-01T00:00:00Z', true);
	const again = createTracked(store);
	assert.equal(again.all().length, TRACK_MAX);
	assert.equal(again.all()[0].issueId, `i${TRACK_MAX + 4}`);
	assert.ok(!again.has('i0'));
	assert.equal(again.unreadAgents().size, 1);
	store.data.set(TRACK_KEY, JSON.stringify([{ issueId: 1 }, 'x', null, { issueId: 'ok', agentId: 'a', issuedAt: '', seenAt: '', unread: false }]));
	assert.deepEqual(createTracked(store).all().map((x) => x.issueId), ['ok']);
	store.data.set(TRACK_KEY, '{not json');
	assert.equal(createTracked(store).all().length, 0);
});

test('storage that throws on every call still works for the page', () => {
	const t = createTracked({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
	t.add('i1', 'a1', '2026-09-23T10:00:00Z');
	assert.ok(t.has('i1'));
	assert.ok(createTracked(null).all().length === 0);
});

test('the reply check flags a comrade who answered, checks at most eight, and joins a running check', async () => {
	let clock = Date.UTC(2026, 8, 23, 12);
	const f = mockFetch(mockSnapshots(1), { now: () => clock, replyDelayMs: 1_000 });
	const aid = '00000000-0000-4000-8000-000000000003';
	const tracked = createTracked(memory());
	const made = await createDirective(f, MOCK_COMPANY_ID, aid, 'Inspect the boiler.', null);
	assert.ok(made.ok);
	tracked.add(made.value.id, aid, made.value.createdAt);
	let changes = 0;
	let requests = 0;
	const counting: typeof f = (p, i) => { requests++; return f(p, i); };
	const watch = createReplyWatch({ fetchImpl: counting, tracked, onChange: () => changes++, isHidden: () => false });
	await watch.check();
	assert.equal(changes, 0, 'no reply yet');
	clock += 1_000;
	await Promise.all([watch.check(), watch.check()]);
	assert.equal(changes, 1);
	assert.deepEqual([...tracked.unreadAgents()], [aid]);
	// Flagged directives are not re-checked, and no more than eight are checked per pass.
	for (let i = 0; i < 12; i++) tracked.add(`00000000-0000-4000-9000-${String(i).padStart(12, '0')}`, aid, '2026-09-23T00:00:00Z');
	requests = 0;
	await watch.check();
	assert.equal(requests, REPLY_CHECK_MAX);
});
