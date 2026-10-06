/**
 * The bridge's answers (src/bridge/protocol.ts) over a scratch folder: the roster from agent
 * files (stale, gone and malformed ones), stable ids, directives into the inbox, deliveries and
 * replies taken in (only into the agent's own threads), retried sends recorded once, and the
 * routes the bridge does not have.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { keyHash, uuidFrom } from '../src/bridge/files';
import { BRIDGE_COMPANY_ID, GONE_MS, RUNNING_STALE_MS, createBridge, toLive } from '../src/bridge/protocol';
import { UUID } from '../src/live/http';

const T0 = Date.parse('2026-10-06T12:00:00Z');
const C = `/api/companies/${BRIDGE_COMPANY_ID}`;

/**
 * A bridge over a fresh folder with a hand-driven clock.
 *
 * @returns The bridge, its folder and helpers.
 */
function make() {
	const dir = mkdtempSync(join(tmpdir(), 'plant-bridge-'));
	let clock = T0;
	const logs: string[] = [];
	const b = createBridge({ dir, now: () => clock, log: (l) => logs.push(l) });
	const agent = (file: string, rec: Record<string, unknown>): void => {
		mkdirSync(join(dir, 'agents'), { recursive: true });
		writeFileSync(join(dir, 'agents', file), JSON.stringify({ v: 1, name: 'shop', harness: 'Claude Code', status: 'idle', reason: null, updatedAt: new Date(clock).toISOString(), heartbeatAt: null, ...rec }));
	};
	const get = (url: string) => b.handle('GET', url);
	const post = (url: string, body: unknown) => b.handle('POST', url, body);
	return { dir, b, agent, get, post, logs, tick: (ms: number) => { clock += ms; } };
}

test('ids are UUIDs, stable, and different per key', () => {
	assert.match(uuidFrom('agent:claude:/a'), UUID);
	assert.equal(uuidFrom('agent:claude:/a'), uuidFrom('agent:claude:/a'));
	assert.notEqual(uuidFrom('agent:claude:/a'), uuidFrom('agent:codex:/a'));
	assert.match(BRIDGE_COMPANY_ID, UUID);
});

test('the roster: one company, agents from their files, newcomers announced once', () => {
	const t = make();
	assert.deepEqual(t.get('/api/companies').body, [{ id: BRIDGE_COMPANY_ID, name: 'The Plant' }]);
	assert.deepEqual(t.get(`${C}/agents`).body, []);
	t.agent('a.json', { key: 'claude:/tmp/shop', status: 'running', heartbeatAt: new Date(T0).toISOString() });
	t.agent('b.json', { key: 'codex:/tmp/api', name: 'api', harness: 'Codex', status: 'waiting', reason: 'Asks to use Bash.' });
	const list = t.get(`${C}/agents`).body as Record<string, unknown>[];
	assert.deepEqual(list.map((a) => [a.name, a.title, a.status]), [['api', 'Codex', 'waiting'], ['shop', 'Claude Code', 'running']]);
	assert.equal(list[1].id, uuidFrom('agent:claude:/tmp/shop'));
	t.get(`${C}/agents`);
	const news = t.get(`${C}/activity?limit=50`).body as Record<string, unknown>[];
	assert.equal(news.filter((n) => n.action === 'agent.created').length, 2, 'each newcomer once');
	assert.equal(t.get(`${C}/approvals?status=pending`).status, 200);
	assert.deepEqual(t.get(`${C}/approvals?status=pending`).body, []);
});

test('an agent gone quiet: running and waiting fall back to idle, and after a week it leaves', () => {
	const at = new Date(T0).toISOString();
	assert.equal(toLive({ key: 'k', status: 'running', updatedAt: at }, T0 + RUNNING_STALE_MS + 1)?.state.status, 'idle');
	assert.equal(toLive({ key: 'k', status: 'running', updatedAt: at }, T0 + 1000)?.state.status, 'running');
	assert.equal(toLive({ key: 'k', status: 'error', reason: 'Hit the rate limit.', updatedAt: at }, T0)?.state.errorReason, 'Hit the rate limit.');
	assert.equal(toLive({ key: 'k', status: 'idle', updatedAt: at }, T0 + GONE_MS + 1), null);
	assert.equal(toLive({ key: 'k', status: 'dancing', updatedAt: at }, T0)?.state.status, 'idle', 'an unknown status reads idle');
	assert.equal(toLive({ status: 'idle', updatedAt: at }, T0), null, 'no key, no comrade');
	assert.equal(toLive({ key: 'k', name: 'a\u0000b\nc'.repeat(40), updatedAt: at }, T0)?.state.name.length, 60, 'names are one tidy line');
});

test('junk in the agents folder is skipped, and two files with one key keep the newer', () => {
	const t = make();
	mkdirSync(join(t.dir, 'agents'), { recursive: true });
	const old = join(t.dir, 'agents', 'x.json.123.ab.tmp'), young = join(t.dir, 'agents', 'y.json.124.cd.tmp');
	writeFileSync(old, '{');
	writeFileSync(young, '{');
	utimesSync(old, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
	writeFileSync(join(t.dir, 'agents', 'junk.json'), '{not json');
	writeFileSync(join(t.dir, 'agents', 'big.json'), JSON.stringify({ key: 'big', updatedAt: new Date(T0).toISOString(), pad: 'x'.repeat(300_000) }));
	t.agent('old.json', { key: 'claude:/x', status: 'idle', updatedAt: new Date(T0 - 5000).toISOString() });
	t.agent('new.json', { key: 'claude:/x', status: 'running' });
	const list = t.get(`${C}/agents`).body as Record<string, unknown>[];
	assert.deepEqual(list.map((a) => a.status), ['running']);
	assert.equal(existsSync(old), false, 'a hook\'s leftover temporary file is cleared');
	assert.equal(existsSync(young), true, 'one being written right now is left alone');
});

test('a directive: a thread, a message in the agent\'s inbox, delivered, answered', () => {
	const t = make();
	t.agent('a.json', { key: 'claude:/tmp/shop' });
	const id = uuidFrom('agent:claude:/tmp/shop');
	t.get(`${C}/agents`);
	const made = t.post(`${C}/issues`, { title: 'Count the rivets', description: 'Count the rivets in src/.\n\n---\n*Sent from the plant*', assigneeAgentId: id, status: 'todo' });
	assert.equal(made.status, 201);
	const issue = made.body as Record<string, string>;
	assert.equal(issue.identifier, 'PLT-1');
	assert.match(issue.id, UUID);
	const box = join(t.dir, 'inbox', keyHash('claude:/tmp/shop'));
	const files = readdirSync(box);
	assert.equal(files.length, 1);
	const m = JSON.parse(readFileSync(join(box, files[0]), 'utf8'));
	assert.equal(m.issueId, issue.id);
	assert.equal(m.kind, 'directive');
	assert.equal((t.get(`${C}/sidebar-badges`).body as Record<string, number>).inbox, 1);
	// The hook takes it: moved to delivered/.
	mkdirSync(join(t.dir, 'delivered', keyHash('claude:/tmp/shop')), { recursive: true });
	writeFileSync(join(t.dir, 'delivered', keyHash('claude:/tmp/shop'), files[0]), readFileSync(join(box, files[0])));
	rmSync(join(box, files[0]));
	// And answers.
	mkdirSync(join(t.dir, 'replies'), { recursive: true });
	writeFileSync(join(t.dir, 'replies', '1.json'), JSON.stringify({ v: 1, key: 'claude:/tmp/shop', issueIds: [issue.id], text: 'There are 412.', at: new Date(T0 + 5000).toISOString() }));
	const comments = t.get(`/api/issues/${issue.id}/comments?order=asc`).body as Record<string, unknown>[];
	assert.deepEqual(comments.map((c) => [c.authorType, c.body]), [['agent', 'There are 412.']]);
	assert.equal(comments[0].authorAgentId, id);
	assert.equal((t.get(`/api/issues/${issue.id}`).body as Record<string, string>).status, 'answered');
	assert.equal(existsSync(join(t.dir, 'replies', '1.json')), false, 'a reply is taken in once');
	const list = t.get(`${C}/issues?assigneeAgentId=${id}&limit=50`).body as Record<string, unknown>[];
	assert.deepEqual(list.map((i) => i.title), ['Count the rivets']);
	// The bridge keeps its book across a restart.
	const again = createBridge({ dir: t.dir, now: () => T0 });
	assert.equal((again.handle('GET', `/api/issues/${issue.id}/comments`).body as unknown[]).length, 1);
});

test('a reply goes only into threads assigned to the agent that wrote it', () => {
	const t = make();
	t.agent('a.json', { key: 'claude:/a', name: 'a' });
	t.agent('b.json', { key: 'claude:/b', name: 'b' });
	t.get(`${C}/agents`);
	const forA = t.post(`${C}/issues`, { title: 'For A', assigneeAgentId: uuidFrom('agent:claude:/a') }).body as Record<string, string>;
	mkdirSync(join(t.dir, 'replies'), { recursive: true });
	writeFileSync(join(t.dir, 'replies', 'x.json'), JSON.stringify({ v: 1, key: 'claude:/b', issueIds: [forA.id], text: 'Not mine to answer.' }));
	writeFileSync(join(t.dir, 'replies', 'y.json'), 'garbage');
	assert.deepEqual(t.get(`/api/issues/${forA.id}/comments`).body, []);
	assert.ok(t.logs.some((l) => /not one/.test(l)), 'a junk reply file is said, then dropped');
});

test('messages in a thread: retried sends recorded once, files refused, empty refused', () => {
	const t = make();
	t.agent('a.json', { key: 'claude:/a' });
	t.get(`${C}/agents`);
	const issue = t.post(`${C}/issues`, { title: 'Go', assigneeAgentId: uuidFrom('agent:claude:/a') }).body as Record<string, string>;
	const one = t.post(`/api/issues/${issue.id}/comments`, { body: 'And polish them.', clientRequestId: 'r-1' });
	const two = t.post(`/api/issues/${issue.id}/comments`, { body: 'And polish them.', clientRequestId: 'r-1' });
	assert.equal(one.status, 201);
	assert.deepEqual(two.body, one.body);
	assert.equal(readdirSync(join(t.dir, 'inbox', keyHash('claude:/a'))).length, 2, 'the directive and one message');
	assert.equal(t.post(`/api/issues/${issue.id}/comments`, { body: '  ' }).status, 422);
	assert.equal(t.post(`/api/issues/${issue.id}/comments`, { body: 'x', attachmentIds: ['f'] }).status, 422);
	assert.equal(t.post(`${C}/issues`, { title: 'Nobody', assigneeAgentId: uuidFrom('agent:nobody') }).status, 409, 'only comrades on the roster');
});

test('routes the bridge does not have answer the way that hides them in the plant', () => {
	const t = make();
	assert.deepEqual(t.get(`${C}/chats/${uuidFrom('x')}`).body, { error: 'API route not found' });
	assert.equal(t.get(`${C}/chats/${uuidFrom('x')}`).status, 404);
	assert.equal(t.get(`/api/companies/${uuidFrom('other')}/agents`).status, 404);
	assert.equal(t.post(`/api/agents/${uuidFrom('x')}/pause`, {}).status, 404);
	assert.equal(t.get('/api/plant-bridge').status, 200);
	assert.equal(t.get(`/api/agents/${uuidFrom('x')}`).status, 404);
});

test('an unreadable threads.json is kept aside and the bridge starts afresh', () => {
	const dir = mkdtempSync(join(tmpdir(), 'plant-bridge-'));
	writeFileSync(join(dir, 'threads.json'), '{broken');
	const logs: string[] = [];
	createBridge({ dir, log: (l) => logs.push(l) });
	assert.ok(readdirSync(dir).some((f) => f.startsWith('threads.json.unreadable-')));
	assert.ok(logs.some((l) => /fresh one/.test(l)));
});

test('a pipe or a link in the agents folder is never opened, so it cannot stall the bridge', () => {
	const t = make();
	mkdirSync(join(t.dir, 'agents'), { recursive: true });
	execFileSync('mkfifo', [join(t.dir, 'agents', 'stall.json')]);
	writeFileSync(join(t.dir, 'elsewhere.json'), JSON.stringify({ key: 'link', updatedAt: new Date(T0).toISOString() }));
	symlinkSync(join(t.dir, 'elsewhere.json'), join(t.dir, 'agents', 'link.json'));
	t.agent('a.json', { key: 'claude:/a' });
	assert.deepEqual((t.get(`${C}/agents`).body as Record<string, unknown>[]).map((a) => a.name), ['shop']);
});

test('a message to a comrade who has left the plant is refused with a sentence, and nothing is stored', () => {
	const t = make();
	t.agent('a.json', { key: 'claude:/a' });
	t.get(`${C}/agents`);
	const issue = t.post(`${C}/issues`, { title: 'Go', assigneeAgentId: uuidFrom('agent:claude:/a') }).body as Record<string, string>;
	rmSync(join(t.dir, 'agents', 'a.json'));
	const r = t.post(`/api/issues/${issue.id}/comments`, { body: 'Still there?' });
	assert.equal(r.status, 409);
	assert.match((r.body as { error: string }).error, /Nobody has worked in that folder for a week, so nobody would read this\. Start a session there and they come back\./);
	assert.deepEqual(t.get(`/api/issues/${issue.id}/comments`).body, []);
	assert.equal(t.post(`${C}/issues`, { title: 'Go', assigneeAgentId: uuidFrom('agent:claude:/a') }).status, 409);
});

test('bad entries in threads.json are left out one by one, and the file is kept as it was', () => {
	const dir = mkdtempSync(join(tmpdir(), 'plant-bridge-'));
	const good = { id: 'i-1', companyId: BRIDGE_COMPANY_ID, identifier: 'PLT-1', title: 'Fine', description: null, status: 'todo', assigneeAgentId: 'a', createdByUserId: 'o', createdByAgentId: null, createdAt: '2026-10-06T12:00:00Z', updatedAt: '2026-10-06T12:00:00Z' };
	writeFileSync(join(dir, 'threads.json'), JSON.stringify({ v: 1, seq: 2, issues: [good, { ...good, id: 'i-2', title: 7 }], comments: [null], activity: [], seen: [] }));
	const logs: string[] = [];
	const b = createBridge({ dir, log: (l) => logs.push(l) });
	assert.equal(b.handle('GET', `${C}/issues?q=fine`).status, 200, 'a search no longer throws on a bad title');
	assert.deepEqual((b.handle('GET', `${C}/issues`).body as Record<string, string>[]).map((i) => i.id), ['i-1']);
	assert.ok(logs.some((l) => /left them out/.test(l)));
	assert.ok(readdirSync(dir).some((f) => f.startsWith('threads.json.unreadable-')));
});

test('waiting carries what the agent waits for; an over-long key is no agent; a long reply is not dropped', () => {
	const at = new Date(T0).toISOString();
	assert.equal(toLive({ key: 'k', status: 'waiting', reason: 'Claude needs your permission to use Bash', updatedAt: at }, T0)?.state.pauseReason, 'Claude needs your permission to use Bash');
	assert.equal(toLive({ key: 'k'.repeat(1001), updatedAt: at }, T0), null);
	const t = make();
	t.agent('a.json', { key: 'claude:/a' });
	t.get(`${C}/agents`);
	const issue = t.post(`${C}/issues`, { title: 'Go', assigneeAgentId: uuidFrom('agent:claude:/a') }).body as Record<string, string>;
	mkdirSync(join(t.dir, 'replies'), { recursive: true });
	// 20,000 three-byte characters and newlines: well past 64 KB on disk.
	writeFileSync(join(t.dir, 'replies', 'r.json'), JSON.stringify({ v: 1, key: 'claude:/a', issueIds: [issue.id], text: '字\n'.repeat(10_000) }));
	assert.equal((t.get(`/api/issues/${issue.id}/comments`).body as unknown[]).length, 1);
});

test('a thread reads answered once the agent replies, and to do again when the owner writes', () => {
	const t = make();
	t.agent('a.json', { key: 'claude:/a' });
	t.get(`${C}/agents`);
	const issue = t.post(`${C}/issues`, { title: 'Go', assigneeAgentId: uuidFrom('agent:claude:/a') }).body as Record<string, string>;
	mkdirSync(join(t.dir, 'replies'), { recursive: true });
	writeFileSync(join(t.dir, 'replies', 'r.json'), JSON.stringify({ v: 1, key: 'claude:/a', issueIds: [issue.id], text: 'Done.' }));
	t.get(`/api/issues/${issue.id}/comments`);
	assert.equal((t.get(`/api/issues/${issue.id}`).body as Record<string, string>).status, 'answered');
	t.post(`/api/issues/${issue.id}/comments`, { body: 'Again, please.' });
	assert.equal((t.get(`/api/issues/${issue.id}`).body as Record<string, string>).status, 'todo');
});

test('two folders with one name are told apart by the folder above; a waiting comrade counts on the board', () => {
	const t = make();
	t.agent('a.json', { key: 'claude:/work/a/app', name: 'app' });
	t.agent('b.json', { key: 'claude:/work/b/app', name: 'app', status: 'waiting', reason: 'May I?' });
	t.agent('c.json', { key: 'claude:/work/c/shop', name: 'shop' });
	assert.deepEqual((t.get(`${C}/agents`).body as Record<string, string>[]).map((a) => a.name), ['app (a)', 'app (b)', 'shop']);
	assert.equal((t.get(`${C}/sidebar-badges`).body as Record<string, number>).approvals, 1, 'the plan is not fulfilled while someone waits on the owner');
});

test('a delivery is left alone for its first seconds, so a hook whose turn failed can put it back', () => {
	const t = make();
	t.agent('a.json', { key: 'claude:/a' });
	t.get(`${C}/agents`);
	const issue = t.post(`${C}/issues`, { title: 'Go', assigneeAgentId: uuidFrom('agent:claude:/a') }).body as Record<string, string>;
	const box = join(t.dir, 'inbox', keyHash('claude:/a'));
	const name = readdirSync(box)[0];
	const to = join(t.dir, 'delivered', keyHash('claude:/a'));
	mkdirSync(to, { recursive: true });
	writeFileSync(join(to, name), readFileSync(join(box, name)));
	rmSync(join(box, name));
	t.get(`${C}/agents`);
	assert.deepEqual(readdirSync(to), [name], 'too young to take in');
	utimesSync(join(to, name), new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
	t.get(`${C}/agents`);
	assert.deepEqual(readdirSync(to), []);
	assert.equal((t.get(`/api/issues/${issue.id}`).body as Record<string, string>).status, 'in_progress');
});

test('a message longer than an agent can be handed in one go is refused with a sentence', () => {
	const t = make();
	t.agent('a.json', { key: 'claude:/a' });
	t.get(`${C}/agents`);
	const long = 'x'.repeat(7_001);
	const r = t.post(`${C}/issues`, { title: 'Go', description: long, assigneeAgentId: uuidFrom('agent:claude:/a') });
	assert.equal(r.status, 422);
	assert.match((r.body as { error: string }).error, /Keep it under 7,000 characters, or send it in parts\./);
	assert.equal(existsSync(join(t.dir, 'inbox')), false, 'nothing reaches the inbox');
	const issue = t.post(`${C}/issues`, { title: 'Go', assigneeAgentId: uuidFrom('agent:claude:/a') }).body as Record<string, string>;
	assert.equal(t.post(`/api/issues/${issue.id}/comments`, { body: long }).status, 422);
});

test('Claude Code and Codex in one folder are told apart by the harness', () => {
	const t = make();
	t.agent('a.json', { key: 'claude:/work/app', name: 'app', harness: 'Claude Code' });
	t.agent('b.json', { key: 'codex:/work/app', name: 'app', harness: 'Codex' });
	assert.deepEqual((t.get(`${C}/agents`).body as Record<string, string>[]).map((a) => a.name), ['app (Claude Code)', 'app (Codex)']);
});
