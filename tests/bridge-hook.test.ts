/**
 * The hook script (src/bridge/hook.ts): each event's effect on the comrade, sessions in one
 * folder sharing a comrade, tool events written at most every few seconds, messages handed
 * over exactly once (even to two sessions racing), the answer sent back to the threads that
 * were handed over, and the script never failing the agent on junk. The last test runs the
 * real hook and the real bridge together, through the plant's own poller.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { keyHash, uuidFrom } from '../src/bridge/files';
import { BEAT_MS, handleEvent, lastAssistantText, main, recordFrom, run } from '../src/bridge/hook';
import { BRIDGE_COMPANY_ID, createBridge } from '../src/bridge/protocol';
import { createPoller } from '../src/live/poller';
import type { FetchLike } from '../src/live/http';
import type { Snapshot } from '../src/live/types';

const T0 = Date.parse('2026-10-06T12:00:00Z');
const fresh = () => recordFrom(null, 'claude:/tmp/shop', 'shop', 'Claude Code');
const ev = (event: string, more: Record<string, unknown> = {}) => ({ event, sessionId: 's1', cwd: '/tmp/shop', ...more });
const scratch = () => mkdtempSync(join(tmpdir(), 'plant-hook-'));
const agentFile = (dir: string, key = 'claude:/tmp/shop') => JSON.parse(readFileSync(join(dir, 'agents', `${keyHash(key)}.json`), 'utf8'));

test('each event moves the comrade: prompt works, permission waits, stop idles, failure errs', () => {
	let r = fresh();
	r = handleEvent(r, ev('UserPromptSubmit'), [], T0).record!;
	assert.equal(r.status, 'running');
	assert.equal(r.heartbeatAt, new Date(T0).toISOString());
	r = handleEvent(r, ev('Notification', { notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' }), [], T0 + 1).record!;
	assert.deepEqual([r.status, r.reason], ['waiting', 'Claude needs your permission to use Bash']);
	r = handleEvent(r, ev('PostToolUse'), [], T0 + BEAT_MS + 10).record!;
	assert.equal(r.status, 'running', 'the OK was given: back at work');
	r = handleEvent(r, ev('Stop'), [], T0 + 20_000).record!;
	assert.equal(r.status, 'idle');
	r = handleEvent(r, ev('StopFailure', { errorType: 'rate_limit' }), [], T0 + 30_000).record!;
	assert.deepEqual([r.status, r.reason], ['error', 'Hit the rate limit and stopped.']);
	r = handleEvent(r, ev('PermissionRequest', { toolName: 'shell' }), [], T0 + 40_000).record!;
	assert.deepEqual([r.status, r.reason], ['waiting', 'Asks to use shell.'], 'Codex asks this way');
	assert.equal(handleEvent(r, ev('Notification', { notificationType: 'auth_success' }), [], T0).record, null, 'other notifications change nothing');
	assert.equal(handleEvent(r, ev('PreCompact'), [], T0).record, null, 'unknown events change nothing');
});

test('tool events from a session already at work are written at most every few seconds', () => {
	const r = handleEvent(fresh(), ev('PreToolUse'), [], T0).record!;
	assert.equal(handleEvent(r, ev('PostToolUse'), [], T0 + BEAT_MS - 1).record, null);
	assert.ok(handleEvent(r, ev('PostToolUse'), [], T0 + BEAT_MS).record);
});

test('two sessions in one folder are one comrade, showing the more pressing state', () => {
	let r = handleEvent(fresh(), ev('UserPromptSubmit'), [], T0).record!;
	r = handleEvent(r, { ...ev('Stop'), sessionId: 's2' }, [], T0 + 1).record!;
	assert.equal(r.status, 'running', 'one still works, so the comrade works');
	r = handleEvent(r, { ...ev('Notification', { notificationType: 'permission_prompt' }), sessionId: 's2' }, [], T0 + 2).record!;
	assert.equal(r.status, 'waiting', 'waiting on the owner beats working');
	r = handleEvent(r, { ...ev('SessionEnd'), sessionId: 's2' }, [], T0 + 3).record!;
	assert.equal(r.status, 'running');
	r = handleEvent(r, ev('SessionEnd'), [], T0 + 4).record!;
	assert.equal(r.status, 'idle');
	assert.deepEqual(r.sessions, {});
});

test('messages are handed over on a prompt, and the answer goes back to those threads only', () => {
	const m = { v: 1 as const, issueId: 'i-1', identifier: 'PLT-1', title: 'Count the rivets', text: 'Count them in src/.', kind: 'directive' as const, at: '' };
	const got = handleEvent(fresh(), ev('UserPromptSubmit'), [{ file: 'a.json', m }], T0, ['i-0']);
	assert.deepEqual(got.take, ['a.json']);
	assert.match(got.context!, /PLT-1 "Count the rivets" \(a new directive\):\nCount them in src\/\./);
	assert.deepEqual(got.awaiting, ['i-0', 'i-1']);
	assert.equal(handleEvent(got.record!, ev('Stop', { lastMessage: 'Not for you.' }), [], T0 + 1, []).reply, null, 'nothing awaited, no reply');
	const done = handleEvent(got.record!, ev('Stop', { lastMessage: '  There are 412.  ' }), [], T0 + 2, ['i-1']);
	assert.deepEqual(done.reply, { issueIds: ['i-1'], text: 'There are 412.' });
	assert.deepEqual(done.awaiting, [], 'answered once');
	assert.equal(handleEvent(got.record!, ev('PostToolUse'), [], T0 + 9_000, ['i-1']).awaiting, null, 'tool events never touch the awaited list');
	assert.deepEqual(handleEvent(got.record!, ev('SessionEnd'), [], T0 + 3, ['i-1']).awaiting, []);
});

test('a late tool event cannot bring back an answered thread', () => {
	const dir = scratch();
	const hash = keyHash('claude:/tmp/shop');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	writeFileSync(join(dir, 'inbox', hash, '01.json'), JSON.stringify({ v: 1, issueId: 'i-1', identifier: 'PLT-1', title: 'Go', text: 'Go.', kind: 'directive', at: '' }));
	run('claude', { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, false, T0);
	run('claude', { hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/shop', last_assistant_message: 'Done.' }, dir, false, T0 + 1000);
	// A PostToolUse that started before the Stop lands after it.
	run('claude', { hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/tmp/shop' }, dir, false, T0 + 20_000);
	run('claude', { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, false, T0 + 30_000);
	run('claude', { hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/shop', last_assistant_message: 'Something else entirely.' }, dir, false, T0 + 31_000);
	assert.equal(readdirSync(join(dir, 'replies')).length, 1, 'the second turn sent nothing to PLT-1');
});

test('run(): the files on disk, and a message taken by one session is never handed to another', () => {
	const dir = scratch();
	const hash = keyHash('claude:/tmp/shop');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	writeFileSync(join(dir, 'inbox', hash, '01.json'), JSON.stringify({ v: 1, issueId: 'i-1', identifier: 'PLT-1', title: 'Go', text: 'Go now.', kind: 'directive', at: '' }));
	const first = run('claude', { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, false, T0);
	const out = JSON.parse(first);
	assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
	assert.match(out.hookSpecificOutput.additionalContext, /Go now\./);
	assert.deepEqual(readdirSync(join(dir, 'inbox', hash)), []);
	assert.deepEqual(readdirSync(join(dir, 'delivered', hash)), ['01.json']);
	assert.equal(run('claude', { hook_event_name: 'UserPromptSubmit', session_id: 's2', cwd: '/tmp/shop' }, dir, false, T0 + 1), '', 'nothing left for the second session');
	assert.equal(agentFile(dir).status, 'running');
	run('claude', { hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/shop', last_assistant_message: 'Gone.' }, dir, false, T0 + 2);
	const replies = readdirSync(join(dir, 'replies'));
	assert.equal(replies.length, 1);
	assert.deepEqual(JSON.parse(readFileSync(join(dir, 'replies', replies[0]), 'utf8')).issueIds, ['i-1']);
});

test('Codex: its hooks name the comrade by harness, and the notify fallback shows a turn just done', () => {
	const dir = scratch();
	run('codex', { hook_event_name: 'UserPromptSubmit', session_id: 'c1', cwd: '/tmp/shop' }, dir, false, T0);
	assert.equal(agentFile(dir, 'codex:/tmp/shop').harness, 'Codex');
	run('codex', { type: 'agent-turn-complete', 'thread-id': 't1', cwd: '/tmp/api', 'last-assistant-message': 'Done.' }, dir, true, T0);
	const r = agentFile(dir, 'codex:/tmp/api');
	assert.equal(r.status, 'idle');
	assert.equal(r.heartbeatAt, new Date(T0).toISOString(), 'a heartbeat, so the plant shows them at work for a while');
	assert.equal(run('codex', { type: 'something-else' }, dir, true, T0), '');
});

test('a Stop without the message reads the end of the transcript', () => {
	const dir = scratch();
	const path = join(dir, 't.jsonl');
	writeFileSync(path, [
		JSON.stringify({ type: 'user', message: { content: 'hi' } }),
		JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'First.' }] } }),
		JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }, { type: 'text', text: 'Last words.' }] } }),
		'not json',
	].join('\n'));
	assert.equal(lastAssistantText(path), 'Last words.');
	assert.equal(lastAssistantText(join(dir, 'missing.jsonl')), null);
});

test('the script itself never fails the agent: junk in, nothing out, exit as normal', async () => {
	const dir = scratch();
	const writes: string[] = [];
	const real = process.stdout.write.bind(process.stdout);
	(process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => { writes.push(String(s)); return true; };
	try {
		await main(['codex-notify', '--dir', dir, '{not json']);
		await main(['nobody', '--dir', dir, '{}']);
		await main(['codex-notify', '--dir', dir]);
	} finally {
		(process.stdout as unknown as { write: typeof real }).write = real;
	}
	assert.deepEqual(writes, []);
});

test('end to end: hook events in, the plant\'s own poller sees the comrade, a directive goes round', async () => {
	const dir = scratch();
	const bridge = createBridge({ dir });
	const fetchImpl: FetchLike = async (input, init) => {
		const a = bridge.handle((init?.method ?? 'GET').toUpperCase(), input, init?.body ? JSON.parse(String(init.body)) : undefined);
		return { type: 'basic', status: a.status, ok: a.status < 300, text: async () => JSON.stringify(a.body) };
	};
	const seen: Snapshot[] = [];
	const poller = createPoller({ fetchImpl, onSnapshot: (s) => seen.push(s), isHidden: () => false, onVisibilityChange: () => () => {} });
	run('claude', { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/tmp/shop' }, dir);
	run('claude', { hook_event_name: 'Notification', session_id: 's1', cwd: '/tmp/shop', notification_type: 'permission_prompt', message: 'May I?' }, dir);
	poller.start();
	await poller.refresh();
	poller.stop();
	const s = seen.at(-1)!;
	assert.equal(s.session, 'ok');
	assert.equal(s.companyId, BRIDGE_COMPANY_ID);
	assert.deepEqual(s.agents.map((a) => [a.name, a.title, a.status]), [['shop', 'Claude Code', 'waiting']]);
	const id = uuidFrom('agent:claude:/tmp/shop');
	const made = await fetchImpl(`/api/companies/${BRIDGE_COMPANY_ID}/issues`, { method: 'POST', body: JSON.stringify({ title: 'Report', description: 'Report in.', assigneeAgentId: id }) });
	const issue = JSON.parse(await made.text());
	const ctx = JSON.parse(run('claude', { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir)).hookSpecificOutput.additionalContext;
	assert.match(ctx, /Report in\./);
	run('claude', { hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/shop', last_assistant_message: 'Reporting: all quiet.' }, dir);
	const comments = JSON.parse(await (await fetchImpl(`/api/issues/${issue.id}/comments?order=asc`)).text());
	assert.deepEqual(comments.map((c: Record<string, string>) => c.body), ['Reporting: all quiet.']);
});
