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
const { BRIDGE_DOWN, createOverlay } = await import('../src/cockpit/overlay');
const { createChat } = await import('../src/cockpit/chat');
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

test('what each host can do', () => {
	assert.deepEqual(hostOf('paperclip'), { kind: 'paperclip', companies: true, ministry: true, board: true, server: 'Paperclip' });
	assert.deepEqual(hostOf('bridge'), { kind: 'bridge', companies: false, ministry: false, board: false, server: 'the bridge' });
	assert.deepEqual(hostOf('demo'), { kind: 'demo', companies: false, ministry: false, board: true, server: 'Paperclip' });
});

test('the bridge stops answering: the notice says how to start it, and offers no sign-in', () => {
	const o = createOverlay(undefined, true);
	const down = { ...snap([]), session: 'unreachable' as const, message: 'Paperclip could not be reached.' };
	o.update(down);
	assert.equal(o.open, true);
	assert.equal(o.el.querySelector('p')!.textContent, BRIDGE_DOWN);
	assert.equal((o.el.querySelector('a') as HTMLAnchorElement).hidden, true);
	assert.match(o.el.textContent ?? '', /once the bridge answers again/);
});

test('the directive box on the bridge: no 📎, and it says when the agent will read it', async () => {
	const chat = createChat({ fetchImpl: mockFetch(mockSnapshots(67)), companyId: () => MOCK_COMPANY_ID, lead: () => null, nameOf: () => 'shop', tracked: createTracked(null), onSeen: () => {}, isHidden: () => false, server: 'the bridge', files: false });
	document.body.replaceChildren(chat.el);
	chat.open({ ...waiting, status: 'idle' });
	await flush();
	assert.equal(chat.el.querySelector('.p67-attach'), null);
	assert.match(chat.el.textContent ?? '', /It waits in the bridge and reaches them at the start of their next turn/);
	assert.doesNotMatch(chat.el.textContent ?? '', /Paperclip issue/);
});

test('no board stamps on a host that cannot take them', () => {
	const p = createPersonnel({ fetchImpl: mockFetch(mockSnapshots(67)), companyId: () => MOCK_COMPANY_ID, nameOf: () => null, stamps: false });
	const heads = Array.from(p.el.querySelectorAll('h3')) as HTMLElement[];
	assert.equal(heads.find((h) => h.textContent === 'Board stamps')?.hidden, true);
	assert.equal((p.el.querySelector('.p67-file-papers') as HTMLElement).hidden, true);
	const q = createPersonnel({ fetchImpl: mockFetch(mockSnapshots(67)), companyId: () => MOCK_COMPANY_ID, nameOf: () => null });
	assert.equal((q.el.querySelector('.p67-file-papers') as HTMLElement).hidden, false);
});
