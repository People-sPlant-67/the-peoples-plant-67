/**
 * The cockpit on the bridge: the new "waiting" state (at the station, flagged, every stamp
 * locked), what each host can do, and the words and controls that change on the bridge (the
 * notice when it stops answering, the directive box with no 📎, no board stamps).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { placement, needsYou } from '../src/live/placement';
import { stampRules } from '../src/live/personnel';
import type { AgentState, Snapshot } from '../src/live/types';

const win = new Window({ url: 'http://localhost:6767/' });
Object.assign(globalThis, { document: win.document, localStorage: win.localStorage, requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number, cancelAnimationFrame: (h: number) => clearTimeout(h) });

const { hostOf } = await import('../src/cockpit/host');
const { createOverlay } = await import('../src/cockpit/overlay');
const { createChat, sendFailure } = await import('../src/cockpit/chat');
const { statusWords } = await import('../src/cockpit/status');
const { createTracked } = await import('../src/cockpit/tracked');
const { createPersonnel } = await import('../src/cockpit/personnel');
const { MOCK_COMPANY_ID, mockFetch, mockSnapshots } = await import('../src/live/mock');

const A = '00000000-0000-4000-8000-000000000002';
const waiting: AgentState = { id: A, name: 'shop', title: 'Claude Code', role: null, status: 'waiting', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null };
const snap = (agents: AgentState[]): Snapshot => ({ at: 0, session: 'ok', message: null, companyId: MOCK_COMPANY_ID, companyName: 'x', agents, badges: null, badgesStale: false, approvals: null });
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r)); };

test('waiting: at the station mid-task, flagged for the owner, every stamp locked', () => {
	assert.deepEqual(placement(waiting, Date.now()), { zone: placement({ ...waiting, status: 'running' }, Date.now()).zone, activity: 'working' });
	assert.equal(needsYou(waiting, snap([waiting])), true);
	const rules = stampRules(waiting);
	assert.ok(Object.values(rules).every((r) => r === 'They are waiting for your OK in the terminal.'));
});

test('an error on the bridge clears with the next prompt, not a board member', () => {
	assert.equal(statusWords('error', null, false), 'Stopped with an error, and sent to Siberia. It clears the next time you send them a prompt in their terminal.');
	assert.match(statusWords('error'), /until a board member clears it/);
});

test('what each host can do', () => {
	const p = hostOf('paperclip'), b = hostOf('bridge'), d = hostOf('demo');
	assert.deepEqual([p.companies, p.ministry, p.board, p.books, p.files, p.wakes, p.restart], [true, true, true, true, true, true, null]);
	assert.deepEqual([b.companies, b.ministry, b.board, b.books, b.files, b.wakes, b.chat, b.server], [false, false, false, false, false, false, false, 'the bridge']);
	assert.match(b.relink ?? '', /from before the plant last started/);
	assert.equal(hostOf('bridge', 'npx x --port 7000').start, 'npx x --port 7000', 'the exact start command, when the bridge said it');
	assert.equal(b.restart, 'The plant\'s terminal has stopped. Start it again with:');
	assert.deepEqual([d.companies, d.ministry, d.board, d.files], [false, false, true, true], 'the demo mock takes stamps and files');
});

test('waiting: the status line says what the agent waits for, as a sentence', () => {
	assert.equal(statusWords('waiting', 'Claude needs your permission to use Bash'), 'Waiting for you in the terminal. Claude needs your permission to use Bash.');
	assert.equal(statusWords('waiting', 'Asks to use shell.'), 'Waiting for you in the terminal. Asks to use shell.');
	assert.equal(statusWords('waiting'), 'Waiting for you in the terminal. The agent wants your OK before it goes on.');
});

test('the bridge stops answering: the notice says how to start it, and offers no sign-in', () => {
	const o = createOverlay(hostOf('bridge', 'npx github:People-sPlant-67/the-peoples-plant-67 --port 7000 --dir "/a/very/long/folder"'));
	const down = { ...snap([]), session: 'unreachable' as const, message: 'Paperclip could not be reached.' };
	o.update(down);
	assert.equal(o.open, true);
	assert.equal(o.el.querySelector('p')!.textContent, 'The plant\'s terminal has stopped. Start it again with:');
	const cmd = o.el.querySelector('code') as HTMLElement;
	assert.equal(cmd.hidden, false);
	assert.equal(cmd.textContent, 'npx github:People-sPlant-67/the-peoples-plant-67 --port 7000 --dir "/a/very/long/folder"', 'the command on a line of its own');
	assert.match(o.el.textContent ?? '', /The plant keeps trying, and this notice closes by itself once it answers\./);
	assert.equal(o.el.querySelector('h2')!.textContent, 'THE LINE IS DOWN', 'no sign-in to show papers for');
	assert.equal((o.el.querySelector('a') as HTMLAnchorElement).hidden, true);
	const lost = createOverlay(hostOf('bridge', 'npx x'));
	lost.update({ ...down, session: 'signed-out' });
	lost.update({ ...down, session: 'signed-out' });
	assert.match(lost.el.querySelector('p')!.textContent ?? '', /This tab is from before the plant last started/);
	assert.equal((lost.el.querySelector('.p67-note') as HTMLElement).hidden, true, 'it never promises to close by itself: this tab\'s key is gone for good');
	const p = createOverlay(hostOf('paperclip'));
	p.update(down);
	assert.equal(p.el.querySelector('p')!.textContent, 'Paperclip could not be reached.', 'Paperclip keeps its own words and its sign-in link');
	assert.equal((p.el.querySelector('a') as HTMLAnchorElement).hidden, false);
});

test('a send that fails on the bridge says it was not sent and how to start the bridge', () => {
	const r = { ok: false as const, session: 'unreachable' as const, status: 0, detail: null };
	assert.equal(sendFailure(r, 'The directive', hostOf('bridge')), 'The directive was not sent, because the bridge did not answer. See the notice above. Your text is still here.');
	assert.equal(sendFailure({ ...r, status: 409, detail: 'Nobody has worked in that folder for a week, so nobody would read this. Start a session there and they come back.' }, 'The reply', hostOf('bridge')),
		'The reply was not sent. Nobody has worked in that folder for a week, so nobody would read this. Start a session there and they come back. Your text is still here.', 'the bridge answered and said why');
	assert.doesNotMatch(sendFailure({ ...r, status: 502 }, 'The reply', hostOf('bridge')), /Paperclip/);
	assert.match(sendFailure(r, 'The directive', hostOf('paperclip')), /It may have reached Paperclip anyway/);
});

test('the directive box on the bridge: no 📎, and it says the agent reads it with the next prompt', async () => {
	const chat = createChat({ fetchImpl: mockFetch(mockSnapshots(67)), companyId: () => MOCK_COMPANY_ID, lead: () => null, nameOf: () => 'shop', tracked: createTracked(null), onSeen: () => {}, isHidden: () => false, host: hostOf('bridge') });
	document.body.replaceChildren(chat.el);
	chat.open({ ...waiting, status: 'idle' });
	await flush();
	assert.equal(chat.el.querySelector('.p67-attach'), null);
	assert.match(chat.el.textContent ?? '', /shop reads it with your next prompt in their terminal\. Their answer comes back here\./);
	assert.doesNotMatch(chat.el.textContent ?? '', /Paperclip/);
});

test('the Personnel File on the bridge: no stamps, no budget, no shift log, no Paperclip', () => {
	const p = createPersonnel({ fetchImpl: mockFetch(mockSnapshots(67)), companyId: () => MOCK_COMPANY_ID, nameOf: () => null, host: hostOf('bridge') });
	p.show({ ...waiting, status: 'idle' }, true);
	const heads = Array.from(p.el.querySelectorAll('h3')) as HTMLElement[];
	for (const h of ['Board stamps', 'Recent shifts']) assert.equal(heads.find((x) => x.textContent === h)?.hidden, true, h);
	assert.equal((p.el.querySelector('.p67-file-papers') as HTMLElement).hidden, true);
	assert.doesNotMatch(p.el.textContent ?? '', /Paperclip/);
	p.show(null, false);
	const q = createPersonnel({ host: hostOf('paperclip'), fetchImpl: mockFetch(mockSnapshots(67)), companyId: () => MOCK_COMPANY_ID, nameOf: () => null });
	assert.equal((q.el.querySelector('.p67-file-papers') as HTMLElement).hidden, false);
});
