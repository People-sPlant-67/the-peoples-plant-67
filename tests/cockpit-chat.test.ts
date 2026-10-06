/**
 * The chat panel under a fake DOM (happy-dom): what a late answer may and may not touch, the
 * poll stopping on close, opening straight onto an unread reply, and the "maybe sent" warning.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { PAPERCLIP } from '../src/cockpit/host';
import { type Chat, ME_KEY, createChat, sendFailure } from '../src/cockpit/chat';
import { createTracked, type TrackedList } from '../src/cockpit/tracked';
import { createDirective } from '../src/live/directives';
import type { FetchLike } from '../src/live/http';
import { MOCK_COMPANY_ID, mockFetch, mockSnapshots } from '../src/live/mock';
import type { AgentState } from '../src/live/types';

const win = new Window();
Object.assign(globalThis, { document: win.document, localStorage: win.localStorage, requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number, cancelAnimationFrame: (h: number) => clearTimeout(h) });

const A = '00000000-0000-4000-8000-000000000002';
const B = '00000000-0000-4000-8000-000000000003';

/**
 * A roster entry.
 *
 * @param id Agent id.
 * @param name Name.
 * @returns AgentState.
 */
const agent = (id: string, name: string): AgentState => ({ id, name, title: null, role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null });

/**
 * Let pending promise work run.
 *
 * @returns Resolves after a few turns of the event loop.
 */
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r)); };

/**
 * A chat over a fetch, with its parts to hand.
 *
 * @param f Fetch.
 * @param tracked Tracked list.
 * @param isHidden Whether the chat is out of sight.
 * @returns Chat and its controls.
 */
function setup(f: FetchLike, tracked: TrackedList = createTracked(null), isHidden: () => boolean = () => false) {
	const chat: Chat = createChat({ host: PAPERCLIP, fetchImpl: f, companyId: () => MOCK_COMPANY_ID, lead: () => null, nameOf: (id) => (id === A ? 'Anna' : id === B ? 'Boris' : null), tracked, onSeen: () => {}, isHidden });
	const q = <T extends Element>(sel: string) => chat.el.querySelector(sel) as unknown as T;
	return {
		chat, tracked,
		input: () => q<HTMLTextAreaElement>('.p67-input'),
		send: () => q<HTMLButtonElement>('.p67-send'),
		error: () => q<HTMLElement>('.p67-chat-error').textContent ?? '',
		picker: () => q<HTMLSelectElement>('.p67-threads'),
		log: () => q<HTMLElement>('.p67-log').textContent ?? '',
	};
}

test('a directive sent to one comrade never touches the draft of the next one opened', async () => {
	const base = mockFetch(mockSnapshots(1), { replyDelayMs: 0 });
	let release: () => void = () => {};
	const slow: FetchLike = async (p, i) => {
		if (i?.method === 'POST') await new Promise<void>((r) => { release = r; });
		return base(p, i);
	};
	const s = setup(slow);
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.input().value = 'Paint the east wall.';
	s.send().click();
	await flush();
	assert.equal(s.send().textContent, 'Sending…');
	s.chat.open(agent(B, 'Boris'));
	s.input().value = 'A draft for Boris.';
	release();
	await flush();
	assert.equal(s.input().value, 'A draft for Boris.');
	assert.equal(s.error(), '');
	assert.equal(s.picker().value, 'new', 'Boris is not pulled onto Anna’s thread');
	assert.equal(s.tracked.all().length, 1, 'Anna’s directive is still remembered');
	assert.equal(s.tracked.all()[0].agentId, A);
	s.chat.close();
});

test('a failed send after switching comrade leaves the new comrade’s panel alone', async () => {
	let release: () => void = () => {};
	const failing: FetchLike = async (p, i) => {
		if (i?.method === 'POST') { await new Promise<void>((r) => { release = r; }); throw new TypeError('offline'); }
		return mockFetch(mockSnapshots(1))(p, i);
	};
	const s = setup(failing);
	s.chat.open(agent(A, 'Anna'));
	s.input().value = 'Paint the east wall.';
	s.send().click();
	await flush();
	s.chat.open(agent(B, 'Boris'));
	release();
	await flush();
	assert.equal(s.error(), '');
	s.chat.close();
});

test('sending opens the new thread, a reply shows on poke, and the owner’s line is theirs', async () => {
	let clock = Date.now();
	const f = mockFetch(mockSnapshots(1), { now: () => clock, replyDelayMs: 1_000 });
	const s = setup(f);
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.input().value = 'Paint the east wall.\nIn red.';
	s.send().click();
	await flush();
	assert.equal(s.input().value, '');
	assert.notEqual(s.picker().value, 'new');
	assert.match(s.log(), /You.*Paint the east wall\.In red\./s);
	assert.ok(s.chat.el.querySelector('.p67-me .p67-body br'), 'the line break is kept, as a break in the page');
	clock += 1_000;
	s.chat.poke();
	await flush();
	assert.match(s.log(), /Anna ·/);
	assert.equal(s.send().textContent, 'Send reply');
	s.chat.close();
});

test('closing the panel stops the thread poll', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let calls = 0;
	const base = mockFetch(mockSnapshots(1), { replyDelayMs: 0 });
	const counting: FetchLike = (p, i) => { calls++; return base(p, i); };
	const s = setup(counting);
	const made = await createDirective(base, MOCK_COMPANY_ID, A, 'Sweep the yard.', null);
	assert.ok(made.ok);
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.picker().value = made.value.id;
	s.picker().dispatchEvent(new win.Event('change') as unknown as Event);
	await flush();
	t.mock.timers.tick(5_000);
	await flush();
	const before = calls;
	assert.ok(before > 0);
	s.chat.close();
	for (let i = 0; i < 5; i++) { t.mock.timers.tick(5_000); await flush(); }
	assert.equal(calls, before);
});

test('opening a comrade with an unread reply goes straight to that thread', async () => {
	const f = mockFetch(mockSnapshots(1), { replyDelayMs: 0 });
	const tracked = createTracked(null);
	const made = await createDirective(f, MOCK_COMPANY_ID, A, 'Count the bolts.', null);
	assert.ok(made.ok);
	tracked.add(made.value.id, A, '2000-01-01T00:00:00.000Z');
	tracked.sawLatest(made.value.id, new Date().toISOString(), true);
	const s = setup(f, tracked);
	s.chat.open(agent(A, 'Anna'));
	await flush();
	assert.equal(s.picker().value, made.value.id);
	assert.equal(tracked.unreadAgents().size, 0, 'reading it clears the bubble');
	s.chat.close();
});

test('a question poster opens the comrade onto the directive holding the question, open already or not', async () => {
	const f = mockFetch(mockSnapshots(1), { replyDelayMs: 0 });
	const one = await createDirective(f, MOCK_COMPANY_ID, A, 'Count the bolts.', null);
	const two = await createDirective(f, MOCK_COMPANY_ID, A, 'Count the nuts.', null);
	assert.ok(one.ok && two.ok);
	const s = setup(f);
	s.chat.open(agent(A, 'Anna'), one.value.id);
	await flush();
	assert.equal(s.picker().value, one.value.id);
	s.chat.open(agent(A, 'Anna'), two.value.id);
	await flush();
	assert.equal(s.picker().value, two.value.id, 'already open on Anna: it moves to the other directive');
	s.chat.close();
});

test('the "maybe sent" warning appears exactly when a second send could duplicate', () => {
	const f = (status: number, detail: string | null = null) => sendFailure({ ok: false, session: 'unreachable', status, detail }, 'The directive', PAPERCLIP);
	for (const s of [0, 500, 503]) assert.match(f(s), /may have reached Paperclip anyway/, `${s}`);
	assert.match(f(201), /^Paperclip accepted the directive but its answer could not be read/);
	assert.doesNotMatch(f(201), /was not sent|still here/);
	assert.doesNotMatch(f(422, 'Validation failed'), /may have reached/);
	assert.doesNotMatch(f(0, 'Write something first.'), /may have reached/);
	assert.doesNotMatch(sendFailure({ ok: false, session: 'access-lapsed', status: 0, detail: null }, 'The reply', PAPERCLIP), /may have reached/);
	assert.match(f(422), /Your text is still here\.$/);
});

test('an unread reply opened out of sight (behind the Personnel File) stays unread until the owner looks', async () => {
	const base = mockFetch(mockSnapshots(1), { replyDelayMs: 0 });
	const reads: string[] = [];
	const f: FetchLike = async (p, i) => { if (p.endsWith('/read')) reads.push(p); return base(p, i); };
	const tracked = createTracked(null);
	const made = await createDirective(f, MOCK_COMPANY_ID, A, 'Count the bolts.', null);
	assert.ok(made.ok);
	tracked.add(made.value.id, A, '2000-01-01T00:00:00.000Z');
	tracked.sawLatest(made.value.id, new Date().toISOString(), true);
	let hidden = true;
	const s = setup(f, tracked, () => hidden);
	s.chat.open(agent(A, 'Anna'));
	await flush();
	assert.equal(tracked.unreadAgents().size, 1, 'still unread while out of sight');
	assert.equal(reads.length, 0, 'not marked read in Paperclip');
	hidden = false;
	s.chat.poke();
	await flush();
	assert.equal(tracked.unreadAgents().size, 0);
	assert.equal(reads.length, 1);
	s.chat.close();
});

for (const planted of [null, 'someone-else']) test(`another board member's comment is named as such before the owner has sent anything${planted ? ', even with a wrong id in storage' : ''}`, async () => {
	win.localStorage.clear();
	if (planted) win.localStorage.setItem(ME_KEY, planted);
	const base = mockFetch(mockSnapshots(1), { replyDelayMs: 0 });
	const tracked = createTracked(null);
	const made = await createDirective(base, MOCK_COMPANY_ID, A, 'Count the bolts.', null);
	assert.ok(made.ok);
	// Paperclip also holds a comment from a different board user on that issue.
	const f: FetchLike = async (p, i) => {
		const r = await base(p, i);
		if (!p.startsWith(`/api/issues/${made.value.id}/comments`) || (i?.method ?? 'GET') !== 'GET') return r;
		const list = JSON.parse(await r.text()) as unknown[];
		const other = { id: 'c-other', issueId: made.value.id, body: 'I disagree.', createdAt: new Date().toISOString(), authorAgentId: null, authorUserId: 'someone-else', authorType: 'user' };
		return { type: 'basic', status: 200, ok: true, text: async () => JSON.stringify([...list, other]) };
	};
	tracked.add(made.value.id, A, '2000-01-01T00:00:00.000Z');
	tracked.sawLatest(made.value.id, new Date().toISOString(), true);
	const s = setup(f, tracked);
	s.chat.open(agent(A, 'Anna'));
	await flush();
	assert.match(s.log(), /Another board member/);
	assert.match(s.log(), /You/, 'the owner\'s own directive is still theirs');
	s.chat.close();
});

/**
 * A chat panel over a mock Paperclip with Agent Chat, on a hand-driven clock.
 *
 * @returns The setup, the clock, and what the chat said about writing.
 */
function withAgentChat() {
	const clock = { t: Date.parse('2026-09-30T10:00:00Z') };
	const f = mockFetch(mockSnapshots(1), { agentChat: true, replyDelayMs: 4_000, now: () => clock.t });
	const states: [string, boolean][] = [];
	const tracked = createTracked(null);
	const chat: Chat = createChat({ host: PAPERCLIP, fetchImpl: f, companyId: () => MOCK_COMPANY_ID, lead: () => null, nameOf: (id) => (id === A ? 'Anna' : null), tracked, onSeen: () => {}, onChatState: (id, w) => states.push([id, w]), isHidden: () => false });
	const q = <T extends Element>(sel: string) => chat.el.querySelector(sel) as unknown as T;
	const buttons = () => Array.from(chat.el.querySelectorAll('.p67-chat-swap')) as unknown as HTMLButtonElement[];
	return {
		chat, tracked, clock, states, f,
		input: () => q<HTMLTextAreaElement>('.p67-input'),
		send: () => q<HTMLButtonElement>('.p67-send'),
		error: () => q<HTMLElement>('.p67-chat-error').textContent ?? '',
		picker: () => q<HTMLSelectElement>('.p67-threads'),
		log: () => q<HTMLElement>('.p67-log'),
		writing: () => q<HTMLElement>('.p67-writing'),
		heading: () => q<HTMLElement>('.p67-chat-head h3').textContent,
		swap: () => buttons()[0],
		afresh: () => buttons()[1],
	};
}

test('with Agent Chat the card opens on the chat; the first message opens it in Paperclip, and the comrade is shown writing until the answer lands', async () => {
	const s = withAgentChat();
	s.chat.open(agent(A, 'Anna'));
	await flush();
	assert.equal(s.picker().value, 'chat');
	assert.equal(s.heading(), 'Chat');
	assert.match(s.log().textContent!, /running conversation with Anna/);
	assert.equal(s.swap().textContent, 'New directive');
	assert.equal(s.afresh().hidden, true, 'nothing to start afresh before the first message');
	assert.equal(s.send().textContent, 'Send');
	s.input().value = 'How are the boilers?';
	s.send().click();
	await flush();
	assert.equal(s.error(), '');
	assert.equal(s.input().value, '');
	assert.equal(s.tracked.all()[0].chat, true, 'remembered as a chat, for the "…" bubble and the sealed letter');
	assert.match(s.log().textContent!, /You.*How are the boilers\?/s);
	assert.equal(s.writing().hidden, false);
	assert.equal(s.writing().textContent, 'Anna is writing…');
	assert.deepEqual(s.states.at(-1), [A, true]);
	assert.equal(s.afresh().hidden, false);
	s.clock.t += 4_001;
	s.chat.poke();
	await flush();
	assert.match(s.log().textContent!, /Anna ·.*Understood, comrade/s);
	assert.equal(s.writing().hidden, true);
	assert.deepEqual(s.states.at(-1), [A, false], 'the open chat tells the bubble at once');
	s.swap().click();
	assert.equal(s.picker().value, 'new');
	assert.equal(s.swap().textContent, 'Back to chat');
	assert.ok(Array.from(s.picker().options).every((o) => !/Chat ·/.test(o.text)), 'the chat is not listed again among the issues');
	s.swap().click();
	await flush();
	assert.equal(s.picker().value, 'chat');
	assert.match(s.log().textContent!, /Understood, comrade/, 'back to the same conversation');
	s.chat.close();
});

test('"Start afresh" asks for a second click, then sends Paperclip\'s /new, shown as a divider, not as a message', async () => {
	const s = withAgentChat();
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.input().value = 'First.';
	s.send().click();
	await flush();
	const before = s.log().querySelectorAll('.p67-msg').length;
	s.afresh().click();
	await flush();
	assert.equal(s.afresh().textContent, 'Click again to start afresh');
	assert.equal(s.log().querySelectorAll('.p67-msg').length, before, 'one click sends nothing');
	s.afresh().click();
	await flush();
	assert.equal(s.afresh().textContent, 'Start afresh');
	assert.match(s.log().textContent!, /A fresh conversation started here, .*Anna has put what came before out of mind\./);
	assert.doesNotMatch(s.log().textContent!, /\/new/);
	s.chat.close();
});

test('files: refused in a sentence when too big, uploaded on send, and shown on the line as a download', async () => {
	const s = withAgentChat();
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.chat.attach([new File([new Uint8Array(11 * 1024 * 1024)], 'huge.zip')]);
	assert.match(s.error(), /huge\.zip is 11 MB; Paperclip takes files up to 10 MB/);
	s.chat.attach([new File(['quota,4\n'], 'quota.csv', { type: 'text/csv' })]);
	assert.equal(s.error(), '', 'a good file clears the refusal');
	assert.match(s.chat.el.querySelector('.p67-parcels')!.textContent!, /quota\.csv/);
	s.send().click();
	await flush();
	assert.equal(s.error(), '');
	assert.equal((s.chat.el.querySelector('.p67-parcels') as unknown as HTMLElement).hidden, true, 'the box is empty again');
	assert.match(s.log().textContent!, /Files attached: quota\.csv\./, 'files alone still make a message: Paperclip needs a body');
	const link = s.log().querySelector('.p67-msg-parcel') as unknown as HTMLAnchorElement;
	assert.ok(link, 'the file hangs on the line');
	assert.match(link.getAttribute('href')!, /^\/api\/attachments\/[0-9a-f-]{36}\/content\?download=1$/);
	assert.equal(link.textContent, '📦 quota.csv · 8 bytes');
	s.chat.close();
});

test('where Paperclip has no Agent Chat, the card opens on a new directive with no chat to go back to', async () => {
	const f = mockFetch(mockSnapshots(1), { replyDelayMs: 0 });
	const s = setup(f);
	s.chat.open(agent(A, 'Anna'));
	await flush();
	assert.equal(s.picker().value, 'new');
	assert.ok(Array.from(s.picker().options).every((o) => o.value !== 'chat'));
	assert.equal((s.chat.el.querySelector('.p67-chat-swap') as unknown as HTMLElement).hidden, true);
	s.chat.close();
});

/**
 * A chat panel with Agent Chat over a fetch the test can hold or break.
 *
 * @param wrap Wraps the mock's fetch.
 * @returns The chat and its parts.
 */
function heldChat(wrap: (base: FetchLike) => FetchLike) {
	const base = mockFetch(mockSnapshots(1), { agentChat: true, replyDelayMs: 0 });
	const tracked = createTracked(null);
	const chat: Chat = createChat({ host: PAPERCLIP, fetchImpl: wrap(base), companyId: () => MOCK_COMPANY_ID, lead: () => null, nameOf: (id) => (id === A ? 'Anna' : id === B ? 'Boris' : null), tracked, onSeen: () => {}, isHidden: () => false });
	const q = <T extends Element>(sel: string) => chat.el.querySelector(sel) as unknown as T;
	return {
		chat, tracked, base,
		input: () => q<HTMLTextAreaElement>('.p67-input'),
		send: () => q<HTMLButtonElement>('.p67-send'),
		error: () => q<HTMLElement>('.p67-chat-error').textContent ?? '',
		log: () => q<HTMLElement>('.p67-log').textContent ?? '',
		picker: () => q<HTMLSelectElement>('.p67-threads'),
		swap: () => q<HTMLButtonElement>('.p67-chat-swap'),
		parcels: () => q<HTMLElement>('.p67-parcels').textContent ?? '',
	};
}

test('a first message sent while the owner opens another comrade goes to the first comrade\'s chat, files and all, and never shows in the second\'s', async () => {
	let release: () => void = () => {};
	let held = false;
	const s = heldChat((base) => async (p, i) => {
		if (i?.method === 'POST' && p.includes('/chats/') && !held) { held = true; await new Promise<void>((r) => { release = r; }); }
		return base(p, i);
	});
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.chat.attach([new File(['a'], 'a.txt')]);
	s.input().value = 'Hello, Anna.';
	s.send().click();
	await flush();
	s.chat.open(agent(B, 'Boris'));
	await flush();
	s.input().value = 'A draft for Boris.';
	release();
	await flush();
	assert.equal(s.input().value, 'A draft for Boris.');
	assert.doesNotMatch(s.log(), /Hello, Anna/);
	s.swap().click();
	s.swap().click();
	await flush();
	assert.doesNotMatch(s.log(), /Hello, Anna/, 'Boris\'s chat is still Boris\'s after going back to it');
	const anna = await (await import('../src/live/chats')).getChat(s.base, MOCK_COMPANY_ID, A);
	assert.ok(anna.ok && anna.value);
	const lines = await (await import('../src/live/directives')).listMessages(s.base, anna.value.id);
	assert.ok(lines.ok && lines.value.some((m) => m.body === 'Hello, Anna.'));
	const files = await (await import('../src/live/attachments')).listParcels(s.base, anna.value.id);
	assert.ok(files.ok);
	assert.deepEqual(files.value.map((p) => p.name), ['a.txt'], 'the file went with it');
	assert.ok(files.value[0].commentId, 'hung on the message');
	s.chat.close();
});

test('a send whose second file fails posts nothing, says so, and the retry does not upload the first file again', async () => {
	const uploads: string[] = [];
	let refuse = true;
	const s = heldChat((base) => async (p, i) => {
		if (p.endsWith('/attachments') && i?.method === 'POST') {
			const f = (i.body as FormData).get('file') as File;
			uploads.push(f.name);
			if (f.name === 'b.txt' && refuse) return { type: 'basic', status: 422, ok: false, text: async () => JSON.stringify({ error: 'Attachment type is not allowed' }) };
		}
		return base(p, i);
	});
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.chat.attach([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
	s.input().value = 'Two files.';
	s.send().click();
	await flush();
	assert.match(s.error(), /b\.txt could not be attached.*Attachment type is not allowed.*The message was not posted\. The files before it are on the issue already; they go with the message when you send it again\. Your text and files are still here\./);
	assert.equal(s.input().value, 'Two files.');
	assert.doesNotMatch(s.log(), /Two files\./);
	refuse = false;
	s.send().click();
	await flush();
	assert.equal(s.error(), '');
	assert.deepEqual(uploads, ['a.txt', 'b.txt', 'b.txt'], 'a.txt went up once');
	assert.match(s.log(), /Two files\..*📦 a\.txt.*📦 b\.txt/s);
	s.chat.close();
});

test('a directive whose file fails is still issued; the file waits in the box for a reply', async () => {
	const s = heldChat((base) => async (p, i) => {
		if (p.endsWith('/attachments') && i?.method === 'POST') return { type: 'basic', status: 422, ok: false, text: async () => JSON.stringify({ error: 'Attachment is larger than the 10 MB limit' }) };
		return base(p, i);
	});
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.swap().click();
	s.chat.attach([new File(['x'], 'brief.pdf')]);
	s.input().value = 'Paint the east wall.';
	s.send().click();
	await flush();
	assert.notEqual(s.picker().value, 'new', 'the new directive is open');
	assert.match(s.error(), /The directive was issued, but brief\.pdf could not be attached.*What is left in the box goes with your next reply\./);
	assert.match(s.parcels(), /brief\.pdf/);
	assert.equal(s.input().value, '');
	s.chat.close();
});

test('a chat that could not be read says so, and is asked for again when the owner comes back to it', async () => {
	let down = true;
	const s = heldChat((base) => async (p, i) => {
		if (p.includes('/chats/') && down) return { type: 'basic', status: 502, ok: false, text: async () => '' };
		return base(p, i);
	});
	s.chat.open(agent(A, 'Anna'));
	await flush();
	assert.match(s.log(), /Your conversation could not be loaded.*The plant will try again at the next check\./);
	assert.doesNotMatch(s.log(), /running conversation/, 'not shown as empty');
	s.chat.update(agent(A, 'Anna'));
	await flush();
	assert.match(s.log(), /could not be loaded/, 'still down: the same note, asked once per check');
	down = false;
	s.chat.update(agent(A, 'Anna'));
	await flush();
	assert.match(s.log(), /running conversation with Anna/, 'the next check asks again, and there is simply no chat yet');
	down = true;
	s.swap().click();
	s.swap().click();
	await flush();
	assert.doesNotMatch(s.log(), /could not be loaded/, 'a chat known to exist or not is not asked for again on coming back');
	s.chat.close();
});

test('with no company found yet, the chat says so once and does not ask again and again', async () => {
	let asked = 0;
	const f: FetchLike = async () => { asked++; return { type: 'basic', status: 200, ok: true, text: async () => 'null' }; };
	const chat: Chat = createChat({ host: PAPERCLIP, fetchImpl: f, companyId: () => null, lead: () => null, nameOf: () => 'Anna', tracked: createTracked(null), onSeen: () => {}, isHidden: () => false });
	chat.open(agent(A, 'Anna'));
	await flush();
	assert.match(chat.el.querySelector('.p67-log')!.textContent!, /The plant has not found the company yet/);
	const swap = chat.el.querySelector('.p67-chat-swap') as unknown as HTMLButtonElement;
	swap.click();
	swap.click();
	await flush();
	assert.match(chat.el.querySelector('.p67-log')!.textContent!, /The plant has not found the company yet/);
	assert.ok(asked <= 2, `no loop: ${asked} requests (the sign-in check only)`);
	chat.close();
});

test('a file already on the chat is held in the box there, but can be taken out after moving to another thread', async () => {
	const s = heldChat((base) => async (p, i) => {
		if (p.endsWith('/attachments') && i?.method === 'POST' && ((i.body as FormData).get('file') as File).name === 'b.txt') return { type: 'basic', status: 422, ok: false, text: async () => JSON.stringify({ error: 'No' }) };
		return base(p, i);
	});
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.chat.attach([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
	s.input().value = 'Two.';
	s.send().click();
	await flush();
	const xs = () => Array.from(s.chat.el.querySelectorAll('.p67-parcel-x')) as unknown as HTMLButtonElement[];
	assert.deepEqual(xs().map((x) => x.disabled), [true, false], 'a.txt is on the chat already');
	assert.match(xs()[0].getAttribute('aria-label')!, /a\.txt is on the issue already/);
	s.swap().click();
	assert.deepEqual(xs().map((x) => x.disabled), [false, false], 'a new directive gets its own copy, so a.txt can be taken out');
	s.chat.close();
});

test('a question from the comrade shows as a slip; typing warns that a message would withdraw it; once withdrawn it is a line in the log', async () => {
	const s = withAgentChat();
	s.chat.open(agent(A, 'Anna'));
	await flush();
	s.input().value = 'A question first, please.';
	s.send().click();
	await flush();
	s.clock.t += 4_001;
	s.chat.poke();
	await flush();
	const slips = () => s.chat.asks.querySelectorAll('.p67-ask').length;
	assert.equal(slips(), 1);
	const note = () => (s.chat.el.querySelector('.p67-chat-note') as unknown as HTMLElement);
	assert.equal(note().hidden, true);
	s.input().value = 'Never mind.';
	s.input().dispatchEvent(new win.Event('input') as unknown as Event);
	assert.match(note().textContent!, /Sending a message withdraws the question above/);
	s.send().click();
	await flush();
	assert.equal(slips(), 0, 'withdrawn by the message');
	assert.match(s.log().textContent!, /"Two questions before I start": withdrawn by a later message\./);
	s.chat.close();
});
