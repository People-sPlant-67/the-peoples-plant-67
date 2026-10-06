/**
 * The hook script (src/bridge/hook.ts): each event's effect on the comrade, sessions in one
 * folder sharing a comrade, tool events written at most every few seconds, messages handed
 * over exactly once (even to two sessions racing), the answer sent back to the threads that
 * were handed over, and the script never failing the agent on junk. The last test runs the
 * real hook and the real bridge together, through the plant's own poller.
 */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { keyHash, uuidFrom } from '../src/bridge/files';
import { BEAT_MS, CONTEXT_MAX, gitRoot, handleEvent, lastAssistantText, main, pick, recordFrom, run } from '../src/bridge/hook';
import { execFileSync, spawn } from 'node:child_process';
import { BRIDGE_COMPANY_ID, createBridge } from '../src/bridge/protocol';
import { createPoller } from '../src/live/poller';
import type { FetchLike } from '../src/live/http';
import type { Snapshot } from '../src/live/types';

const T0 = Date.parse('2026-10-06T12:00:00Z');
const fresh = () => recordFrom(null, 'claude:/tmp/shop', 'shop', 'Claude Code');
const ev = (event: string, more: Record<string, unknown> = {}) => ({ event, sessionId: 's1', cwd: '/tmp/shop', ...more });
const scratch = () => mkdtempSync(join(tmpdir(), 'plant-hook-'));
/** Run the hook for Claude Code with no CLAUDE_PROJECT_DIR (the one this test runs under must not leak in). */
const go = (payload: Record<string, unknown>, dir: string, now = Date.now()) => run('claude', payload, dir, false, now, {});
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
	assert.deepEqual([r.status, r.reason], ['error', 'The model hit its rate limit, so the turn stopped.']);
	r = handleEvent(r, ev('PermissionRequest', { toolName: 'shell' }), [], T0 + 40_000).record!;
	assert.deepEqual([r.status, r.reason], ['waiting', 'It asks to use shell.'], 'Codex asks this way');
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
	assert.ok(Object.values(r.sessions).every((x) => x.ended), 'only the ended sessions are left, kept a moment as markers');
});

test('messages are handed over on a prompt, and that turn\'s answer goes back to those threads only', () => {
	const m = { v: 1 as const, issueId: 'i-1', identifier: 'PLT-1', title: 'Count the rivets', text: 'Count them in src/.', kind: 'directive' as const, at: '' };
	const got = handleEvent(fresh(), ev('UserPromptSubmit'), [m], T0, null);
	assert.match(got.context!, /PLT-1 "Count the rivets" \(a new directive\):\nCount them in src\/\./);
	assert.deepEqual(got.awaiting, { ids: ['i-1'], replied: false });
	const done = handleEvent(got.record!, ev('Stop', { lastMessage: '  There are 412.  ' }), [], T0 + 2, got.awaiting);
	assert.deepEqual(done.reply, { issueIds: ['i-1'], text: 'There are 412.' });
	assert.deepEqual(done.awaiting, { ids: ['i-1'], replied: true });
	assert.equal(handleEvent(got.record!, ev('Stop', { lastMessage: 'Again.' }), [], T0 + 3, done.awaiting).reply, null, 'answered once');
	assert.deepEqual(handleEvent(got.record!, ev('Stop', { lastMessage: 'The real answer.', stopHookActive: true }), [], T0 + 3, done.awaiting).reply, { issueIds: ['i-1'], text: 'The real answer.' }, 'a Stop hook kept the turn going: its later answer goes back too');
	assert.equal(handleEvent(got.record!, ev('Stop', { lastMessage: 'Hi.' }), [], T0 + 3, null).reply, null, 'nothing awaited, no reply');
	assert.equal(handleEvent(got.record!, ev('PostToolUse'), [], T0 + 9_000, got.awaiting).awaiting, null, 'tool events never touch the awaited list');
	assert.deepEqual(handleEvent(got.record!, ev('SessionEnd'), [], T0 + 3, got.awaiting).awaiting, { ids: [], replied: false });
	assert.equal(handleEvent(got.record!, ev('Interrupt', { lastMessage: 'Half.' }), [], T0 + 4, got.awaiting).reply, null, 'an interrupted turn answers nothing');
});

test('messages wait for a prompt: a session start, a compaction or a resume hands nothing over and leaves the turn alone', () => {
	const m = { v: 1 as const, issueId: 'i-1', identifier: 'PLT-1', title: 'Go', text: 'Go.', kind: 'directive' as const, at: '' };
	const turn = handleEvent(fresh(), ev('UserPromptSubmit'), [m], T0, null);
	const compact = handleEvent(turn.record!, ev('SessionStart', { source: 'compact' }), [], T0 + 1, turn.awaiting);
	assert.equal(compact.record, null, 'mid-work, a compaction changes nothing');
	assert.equal(compact.awaiting, null);
	assert.deepEqual(handleEvent(turn.record!, ev('Stop', { lastMessage: 'Answer to PLT-1.' }), [], T0 + 2, turn.awaiting).reply, { issueIds: ['i-1'], text: 'Answer to PLT-1.' });
	// The owner pressed Esc: no Stop. The next prompt starts a new turn with nothing to answer.
	const next = handleEvent(turn.record!, ev('UserPromptSubmit'), [], T0 + 3, turn.awaiting);
	assert.deepEqual(next.awaiting, { ids: [], replied: false });
	const dir = scratch();
	const hash = keyHash('claude:/tmp/shop');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	writeFileSync(join(dir, 'inbox', hash, '01.json'), JSON.stringify(m));
	assert.equal(go({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/tmp/shop', source: 'startup' }, dir, T0), '');
	assert.deepEqual(readdirSync(join(dir, 'inbox', hash)), ['01.json'], 'still waiting for the first prompt');
});

test('two sessions in one folder never undo each other\'s state', () => {
	const dir = scratch();
	go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0);
	go({ hook_event_name: 'Notification', session_id: 's2', cwd: '/tmp/shop', notification_type: 'permission_prompt', message: 'May I?' }, dir, T0 + 20_000);
	// s1's tool event, read before s2 wrote, lands after: s2 must still be waiting.
	go({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/tmp/shop' }, dir, T0 + 10_000);
	const r = agentFile(dir);
	assert.equal(r.sessions.s2.status, 'waiting');
	assert.equal(r.status, 'waiting');
});

test('a late event never brings an ended session back', () => {
	const dir = scratch();
	go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0);
	go({ hook_event_name: 'SessionEnd', session_id: 's1', cwd: '/tmp/shop' }, dir, T0 + 20_000);
	go({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/tmp/shop' }, dir, T0 + 10_000);
	assert.equal(agentFile(dir).status, 'idle');
});

test('messages claimed for a turn that then fails to be written go back to the inbox', () => {
	const dir = scratch();
	const hash = keyHash('claude:/tmp/shop');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	writeFileSync(join(dir, 'inbox', hash, '01.json'), JSON.stringify({ v: 1, issueId: 'i-1', identifier: 'PLT-1', title: 'Go', text: 'Go.', kind: 'directive', at: '' }));
	// A file where the awaited list's folder should be: writing it throws.
	writeFileSync(join(dir, 'awaiting'), 'in the way');
	assert.throws(() => go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0));
	assert.deepEqual(readdirSync(join(dir, 'inbox', hash)), ['01.json']);
	assert.deepEqual(readdirSync(join(dir, 'delivered', hash)), []);
});

test('a pipe in the inbox is never opened, so the agent\'s turn is never held', () => {
	const dir = scratch();
	const hash = keyHash('claude:/tmp/shop');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	execFileSync('mkfifo', [join(dir, 'inbox', hash, '00.json')]);
	assert.equal(go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0), '');
});

test('the waiting flag stays until the tool runs, even when the PreToolUse lands late', () => {
	let r = handleEvent(fresh(), ev('Notification', { notificationType: 'permission_prompt' }), [], T0).record!;
	assert.equal(handleEvent(r, ev('PreToolUse'), [], T0 + BEAT_MS * 2).record, null);
	r = handleEvent(r, ev('PostToolUse'), [], T0 + BEAT_MS * 2).record!;
	assert.equal(r.status, 'running');
});

test('a late background event never overwrites a later one, nor brings back an answered thread', () => {
	const dir = scratch();
	const hash = keyHash('claude:/tmp/shop');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	writeFileSync(join(dir, 'inbox', hash, '01.json'), JSON.stringify({ v: 1, issueId: 'i-1', identifier: 'PLT-1', title: 'Go', text: 'Go.', kind: 'directive', at: '' }));
	go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0);
	go({ hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/shop', last_assistant_message: 'Done.' }, dir, T0 + 20_000);
	// A PostToolUse that began before the Stop lands after it.
	go({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/tmp/shop' }, dir, T0 + 10_000);
	assert.equal(agentFile(dir).status, 'idle', 'the Stop stands');
	go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0 + 30_000);
	go({ hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/shop', last_assistant_message: 'Something else entirely.' }, dir, T0 + 31_000);
	assert.equal(readdirSync(join(dir, 'replies')).length, 1, 'the second turn sent nothing to PLT-1');
});

test('run(): messages claimed before they are handed over, so a second session never gets them', () => {
	const dir = scratch();
	const hash = keyHash('claude:/tmp/shop');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	writeFileSync(join(dir, 'inbox', hash, '01.json'), JSON.stringify({ v: 1, issueId: 'i-1', identifier: 'PLT-1', title: 'Go', text: 'Go now.', kind: 'directive', at: '' }));
	const out = JSON.parse(go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0));
	assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
	assert.match(out.hookSpecificOutput.additionalContext, /Go now\./);
	assert.deepEqual(readdirSync(join(dir, 'inbox', hash)), []);
	assert.deepEqual(readdirSync(join(dir, 'delivered', hash)), ['01.json']);
	assert.equal(go({ hook_event_name: 'UserPromptSubmit', session_id: 's2', cwd: '/tmp/shop' }, dir, T0 + 1), '', 'nothing left for the second session');
	assert.equal(agentFile(dir).status, 'running');
	go({ hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/shop', last_assistant_message: 'Gone.' }, dir, T0 + 2);
	const replies = readdirSync(join(dir, 'replies'));
	assert.equal(replies.length, 1);
	assert.deepEqual(JSON.parse(readFileSync(join(dir, 'replies', replies[0]), 'utf8')).issueIds, ['i-1']);
});

test('a turn takes about 8,000 characters of messages (Claude Code keeps hook context under 10,000); the rest wait, and a long one is cut', () => {
	const big = (n: number, issueId: string) => ({ m: { v: 1 as const, issueId, identifier: 'PLT-1', title: 't', text: 'x'.repeat(n), kind: 'message' as const, at: '' } });
	assert.deepEqual(pick([big(3500, 'a'), big(3500, 'b'), big(3500, 'c')]).map((x) => x.m.issueId), ['a', 'b']);
	const one = pick([big(CONTEXT_MAX * 2, 'a'), big(10, 'b')]);
	assert.deepEqual(one.map((x) => x.m.issueId), ['a'], 'a very long one goes alone');
	assert.match(one[0].m.text, /Cut short here\. The whole message is in the plant\.\]$/);
	const dir = scratch();
	const hash = keyHash('claude:/tmp/shop');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	for (const n of ['01', '02', '03']) writeFileSync(join(dir, 'inbox', hash, `${n}.json`), JSON.stringify({ v: 1, issueId: `i-${n}`, identifier: 'PLT-1', title: 'Go', text: 'y'.repeat(3500), kind: 'message', at: '' }));
	const ctx = JSON.parse(go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0)).hookSpecificOutput.additionalContext;
	assert.ok(ctx.length < 10_000, `context is ${ctx.length} characters`);
	assert.match(ctx, /More messages are waiting\. They come with the next prompt\./);
	assert.deepEqual(readdirSync(join(dir, 'inbox', hash)), ['03.json']);
});

test('a session keeps its project folder after a cd: one comrade, and the reply still comes back', () => {
	const dir = scratch();
	const hash = keyHash('codex:/tmp/proj');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	writeFileSync(join(dir, 'inbox', hash, '01.json'), JSON.stringify({ v: 1, issueId: 'i-1', identifier: 'PLT-1', title: 'Go', text: 'Go.', kind: 'directive', at: '' }));
	run('codex', { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/proj' }, dir, false, T0, {});
	run('codex', { hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/tmp/proj/sub' }, dir, false, T0 + BEAT_MS, {});
	run('codex', { hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/proj/sub', last_assistant_message: 'Done.' }, dir, false, T0 + 2 * BEAT_MS, {});
	assert.deepEqual(readdirSync(join(dir, 'agents')), [`${hash}.json`], 'no second comrade for the sub folder');
	assert.equal(readdirSync(join(dir, 'replies')).length, 1);
	// Claude Code names the project itself.
	run('claude', { hook_event_name: 'UserPromptSubmit', session_id: 'c1', cwd: '/tmp/proj/deep/er' }, dir, false, T0, { CLAUDE_PROJECT_DIR: '/tmp/proj' });
	assert.ok(readdirSync(join(dir, 'agents')).includes(`${keyHash('claude:/tmp/proj')}.json`));
	// A project named elsewhere than the session's own folder is not taken: no claiming another comrade.
	run('claude', { hook_event_name: 'UserPromptSubmit', session_id: 'c2', cwd: '/tmp/mine' }, dir, false, T0, { CLAUDE_PROJECT_DIR: '/tmp/other' });
	assert.ok(readdirSync(join(dir, 'agents')).includes(`${keyHash('claude:/tmp/mine')}.json`));
	assert.ok(!readdirSync(join(dir, 'agents')).includes(`${keyHash('claude:/tmp/other')}.json`));
});

test('Codex: its hooks name the comrade by harness, and the notify fallback shows a turn just done', () => {
	const dir = scratch();
	run('codex', { hook_event_name: 'UserPromptSubmit', session_id: 'c1', cwd: '/tmp/shop' }, dir, false, T0, {});
	assert.equal(agentFile(dir, 'codex:/tmp/shop').harness, 'Codex');
	run('codex', { type: 'agent-turn-complete', 'thread-id': 't1', cwd: '/tmp/api', 'last-assistant-message': 'Done.' }, dir, true, T0, {});
	const r = agentFile(dir, 'codex:/tmp/api');
	assert.equal(r.status, 'idle');
	assert.equal(r.heartbeatAt, new Date(T0).toISOString(), 'a heartbeat, so the plant shows them at work for a while');
	assert.equal(run('codex', { type: 'something-else' }, dir, true, T0, {}), '');
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

test('the script itself never fails the agent: junk in, nothing out', async () => {
	const dir = scratch();
	assert.equal(await main(['codex-notify', '--dir', dir, '{not json']), '');
	assert.equal(await main(['nobody', '--dir', dir, '{}']), '');
	assert.equal(await main(['codex-notify', '--dir', dir]), '');
});

test('the real script prints the whole context to a slow reader, then exits', async () => {
	const dir = scratch();
	const hash = keyHash('claude:/tmp/wide');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	// 15,000 three-byte characters: about 45 KB as text, past 64 KB once escaped in JSON.
	writeFileSync(join(dir, 'inbox', hash, '01.json'), JSON.stringify({ v: 1, issueId: 'i-1', identifier: 'PLT-1', title: 'Wide', text: '字\u0001'.repeat(7500), kind: 'directive', at: '' }));
	// A clean environment: the test runner's own tsx settings would tangle with the child's.
	const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(NODE_OPTIONS|TSX_|CLAUDE_PROJECT_DIR)/.test(k)));
	// A slow reader on a real pipe: the shell reads nothing until the script has had every chance
	// to exit (a Node parent would drain the pipe at once and hide the cut).
	const child = spawn('sh', ['-c', `"${process.execPath}" --import tsx src/bridge/hook-entry.ts claude --dir "${dir}" | (sleep 1; cat)`], { env });
	let text = '';
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (c) => { text += c; });
	const closed = new Promise((r) => child.on('close', r));
	child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/wide' }));
	const code = await closed;
	assert.equal(code, 0);
	assert.ok(Buffer.byteLength(text) > 30_000, `got ${Buffer.byteLength(text)} bytes`);
	assert.match(JSON.parse(text).hookSpecificOutput.additionalContext, /Wide/);
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
	run('claude', { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/tmp/shop' }, dir, false, Date.now(), {});
	run('claude', { hook_event_name: 'Notification', session_id: 's1', cwd: '/tmp/shop', notification_type: 'permission_prompt', message: 'May I?' }, dir, false, Date.now(), {});
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
	const ctx = JSON.parse(run('claude', { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, false, Date.now(), {})).hookSpecificOutput.additionalContext;
	assert.match(ctx, /Report in\./);
	run('claude', { hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/shop', last_assistant_message: 'Reporting: all quiet.' }, dir, false, Date.now(), {});
	const comments = JSON.parse(await (await fetchImpl(`/api/issues/${issue.id}/comments?order=asc`)).text());
	assert.deepEqual(comments.map((c: Record<string, string>) => c.body), ['Reporting: all quiet.']);
});

test('a turn whose record cannot be written leaves no awaited list behind, so no unrelated answer is filed', () => {
	const dir = scratch();
	const hash = keyHash('claude:/tmp/shop');
	mkdirSync(join(dir, 'inbox', hash), { recursive: true });
	writeFileSync(join(dir, 'inbox', hash, '01.json'), JSON.stringify({ v: 1, issueId: 'i-1', identifier: 'PLT-1', title: 'Go', text: 'Go.', kind: 'directive', at: '' }));
	// A folder where the agent file should be: the record write throws.
	mkdirSync(join(dir, 'agents', `${hash}.json`), { recursive: true });
	assert.throws(() => go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0));
	assert.deepEqual(readdirSync(join(dir, 'inbox', hash)), ['01.json'], 'the message is back for the next prompt');
	assert.equal(existsSync(join(dir, 'awaiting', hash)), false, 'and nothing awaits an answer to it');
	rmSync(join(dir, 'agents', `${hash}.json`), { recursive: true });
	go({ hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/shop', last_assistant_message: 'Unrelated.' }, dir, T0 + 1);
	assert.equal(existsSync(join(dir, 'replies')), false);
});

test('a folder someone else could write is never used: the hook does nothing at all', () => {
	const dir = scratch();
	chmodSync(dir, 0o777);
	assert.equal(go({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/shop' }, dir, T0), '');
	assert.equal(existsSync(join(dir, 'agents')), false);
	chmodSync(dir, 0o700);
});

test('the transcript fallback stops at this turn\'s prompt: an earlier turn\'s answer is never sent', () => {
	const dir = scratch();
	const path = join(dir, 't.jsonl');
	writeFileSync(path, [
		JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'The earlier answer.' }] } }),
		JSON.stringify({ type: 'user', message: { content: 'This turn\'s prompt.' } }),
		JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }),
		JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
	].join('\n'));
	assert.equal(lastAssistantText(path), null);
});

test('a session started in a subfolder of a git project is the project\'s comrade; background events never pin', () => {
	const dir = scratch();
	const proj = scratch();
	mkdirSync(join(proj, '.git'));
	mkdirSync(join(proj, 'src', 'deep'), { recursive: true });
	assert.equal(gitRoot(join(proj, 'src', 'deep')), proj);
	run('codex', { hook_event_name: 'PostToolUse', session_id: 'c9', cwd: join(proj, 'src') }, dir, false, T0, {});
	assert.equal(existsSync(join(dir, 'sessions')), false, 'a late background event pins nothing');
	run('codex', { hook_event_name: 'UserPromptSubmit', session_id: 'c1', cwd: join(proj, 'src', 'deep') }, dir, false, T0, {});
	assert.ok(readdirSync(join(dir, 'agents')).includes(`${keyHash(`codex:${proj}`)}.json`));
});
