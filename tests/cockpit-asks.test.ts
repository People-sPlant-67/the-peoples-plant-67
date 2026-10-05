/**
 * The question slips under a fake DOM: each stamp unlocks only when the answer
 * is complete, a slip keeps what the owner ticked across the chat's re-reads, a locked
 * confirmation offers only Paperclip, and a held stamp sends the answer and then the chat reads again.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import type { FetchLike, ResponseLike } from '../src/live/http';
import { type Interaction, toInteraction } from '../src/live/interactions';

const win = new Window();
Object.assign(globalThis, { document: win.document, requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number, cancelAnimationFrame: (h: number) => clearTimeout(h) });
const { createAsks } = await import('../src/cockpit/interactions');

const IID = '44444444-2222-4333-8444-555555555555';
const AID = '22222222-2222-4333-8444-555555555555';
/**
 * Who is asking, as the chat passes it.
 *
 * @param link Where the issue opens in Paperclip.
 * @returns Context.
 */
const from = (link: string | null = null) => ({ who: 'Anna', agentId: AID, chat: true, link });
const json = (body: unknown, status = 200): ResponseLike => ({ type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
let n = 0;
/**
 * An interaction, fresh id each time.
 *
 * @param kind Kind.
 * @param payload Payload.
 * @returns Raw object and the parsed interaction.
 */
function make(kind: string, payload: unknown) {
	const r = { id: `66666666-2222-4333-8444-${String(++n).padStart(12, '0')}`, issueId: IID, kind, status: 'pending', title: null, payload, continuationPolicy: 'wake_assignee', createdAt: '2026-09-30T10:00:00Z' };
	return { r, i: toInteraction(r) as Interaction };
}

/**
 * Slips over a fetch that serves the given interactions and records answers.
 *
 * @param list Raw interactions Paperclip holds.
 * @returns Slips, what was sent, and what was answered.
 */
function slips(list: Record<string, unknown>[]) {
	const sent: { path: string; body: unknown }[] = [];
	const answered: [string, string, boolean][] = [];
	const f: FetchLike = async (path, init) => {
		if (init?.method === 'POST') { sent.push({ path, body: JSON.parse(String(init.body)) }); return json({ ...list[0], status: 'answered' }); }
		return json(list);
	};
	const asks = createAsks({ fetchImpl: f, nameOf: (id) => (id === AID ? 'Anna' : null), onAnswered: (i, who, yes) => answered.push([i.id, who.agentId, yes]) });
	win.document.body.append(asks.el as never);
	const stamps = () => Array.from(asks.el.querySelectorAll('.p67-stamp')) as unknown as HTMLButtonElement[];
	return { asks, sent, answered, stamps };
}

/**
 * Hold a stamp down long enough to fire it.
 *
 * @param b The stamp button.
 */
async function hold(b: HTMLButtonElement): Promise<void> {
	b.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	await new Promise((r) => setTimeout(r, 1_150));
	b.dispatchEvent(new win.PointerEvent('pointerup') as unknown as Event);
	await new Promise((r) => setTimeout(r, 30));
}

/**
 * Tick or pick an input and tell the slip.
 *
 * @param box Input.
 * @param on Checked or not.
 */
function set(box: Element, on = true): void {
	(box as unknown as HTMLInputElement).checked = on;
	box.dispatchEvent(new win.Event('change') as unknown as Event);
}

test('questions: the stamp waits for every required answer and for "own words" when that option is picked; the answer carries them', async () => {
	const { r, i } = make('ask_user_questions', { version: 1, questions: [
		{ id: 'where', prompt: 'Where?', required: true, selectionMode: 'single', options: [{ id: 'n', label: 'North' }, { id: 'x', label: 'Elsewhere', freeText: true }] },
		{ id: 'when', prompt: 'When?', required: false, selectionMode: 'multi', options: [{ id: 'd', label: 'Day' }, { id: 'e', label: 'Night' }] },
	] });
	const s = slips([r]);
	s.asks.show([i], from('/issues/MOCK-1'));
	assert.match(s.asks.el.textContent!, /Anna has some questions/);
	assert.match(s.asks.el.textContent!, /When\? \(optional\)/);
	assert.match(s.asks.el.textContent!, /Answering wakes Anna: it starts a run\./);
	const [go] = s.stamps();
	assert.equal(go.disabled, true);
	assert.match(s.asks.el.querySelector('.p67-ask-why')!.textContent!, /Answer every question not marked optional/, 'why it is locked is said in words, not only in a tooltip');
	const inputs = Array.from(s.asks.el.querySelectorAll('input[type=radio], input[type=checkbox]'));
	set(inputs[1]);
	assert.equal(go.disabled, true, '"Elsewhere" needs its own words');
	assert.equal(s.asks.el.querySelectorAll('.p67-ask-other').length, 2, '"Elsewhere" has its box; "When?" gets Paperclip\'s Other box');
	const other = s.asks.el.querySelector('.p67-ask-other') as unknown as HTMLInputElement;
	assert.equal(other.hidden, false);
	other.value = 'The Urals';
	other.dispatchEvent(new win.Event('input') as unknown as Event);
	assert.equal(go.disabled, false);
	set(inputs[3]);
	await hold(go);
	assert.deepEqual(s.sent, [{ path: `/api/issues/${IID}/interactions/${i.id}/respond`, body: { answers: [{ questionId: 'where', optionIds: ['x'], otherText: 'The Urals' }, { questionId: 'when', optionIds: ['e'], otherText: null }] } }]);
	assert.deepEqual(s.answered, [[i.id, AID, false]], 'the answer names the comrade who asked, as the slip was drawn');
});

test('a checklist keeps its ticks across re-reads, and ДА waits for the right number; НЕТ waits for a reason when one is required', () => {
	const { r, i } = make('request_checkbox_confirmation', { version: 1, prompt: 'Which?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], minSelected: 1, maxSelected: 2, rejectRequiresReason: true });
	const s = slips([r]);
	s.asks.show([i], from());
	const [yes, no] = s.stamps();
	assert.equal(yes.disabled, true, 'none ticked, at least one wanted');
	const boxes = Array.from(s.asks.el.querySelectorAll('input[type=checkbox]'));
	set(boxes[0]); set(boxes[1]); set(boxes[2]);
	assert.equal(yes.disabled, true, 'three ticked, at most two wanted');
	set(boxes[2], false);
	assert.equal(yes.disabled, false);
	assert.equal(no.disabled, true);
	const reason = s.asks.el.querySelector('.p67-ask-reason') as unknown as HTMLTextAreaElement;
	reason.value = 'Not this week.';
	reason.dispatchEvent(new win.Event('input') as unknown as Event);
	assert.equal(no.disabled, false);
	s.asks.show([toInteraction(r)!], from());
	assert.deepEqual(Array.from(s.asks.el.querySelectorAll('input[type=checkbox]')).map((b) => (b as unknown as HTMLInputElement).checked), [true, true, false], 'the same question read again keeps the ticks');
	const changed = { ...r, payload: { ...(r.payload as object), prompt: 'Which, now?' } };
	s.asks.show([toInteraction(changed)!], from());
	assert.deepEqual(Array.from(s.asks.el.querySelectorAll('input[type=checkbox]')).map((b) => (b as unknown as HTMLInputElement).checked), [false, false, false], 'a changed question starts afresh');
	s.asks.show([], from());
	assert.equal(s.asks.el.hidden, true);
});

test('suggested tasks: ticking a sub-task ticks its parent, clearing a parent clears its sub-tasks; tasks name their comrade', () => {
	const { r, i } = make('suggest_tasks', { version: 1, tasks: [{ clientKey: 'p', title: 'Survey', assigneeAgentId: AID }, { clientKey: 'c', parentClientKey: 'p', title: 'Survey the north' }, { clientKey: 'o', title: 'Order gauges' }] });
	const s = slips([r]);
	s.asks.show([i], from());
	assert.match(s.asks.el.textContent!, /Survey For Anna\./);
	const [take] = s.stamps();
	const boxes = Array.from(s.asks.el.querySelectorAll('input[type=checkbox]')) as unknown as HTMLInputElement[];
	assert.ok(boxes.every((b) => b.checked), 'all ticked to start');
	set(boxes[0], false);
	assert.equal(boxes[1].checked, false);
	set(boxes[1]);
	assert.equal(boxes[0].checked, true);
	set(boxes[0], false); set(boxes[2], false);
	assert.equal(take.disabled, true, 'nothing ticked: decline instead');
});

test('verdicts: every item needs one, and a reason where Paperclip asks for it', () => {
	const { r, i } = make('request_item_verdicts', { version: 1, prompt: 'Which?', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], verdicts: ['approve', 'reject', 'defer'], requireReasonOn: ['reject'] });
	const s = slips([r]);
	s.asks.show([i], from());
	const [go] = s.stamps();
	const click = (sel: string, k: number) => (s.asks.el.querySelectorAll(sel)[k] as unknown as HTMLButtonElement).click();
	click('.p67-ask-v-approve', 0);
	assert.equal(go.disabled, true, 'B has no verdict');
	click('.p67-ask-v-reject', 1);
	assert.equal(go.disabled, true, 'a rejection needs a reason');
	const reasons = Array.from(s.asks.el.querySelectorAll('.p67-ask-reason')) as unknown as HTMLTextAreaElement[];
	assert.deepEqual(reasons.map((x) => x.hidden), [true, false]);
	reasons[1].value = 'Too gloomy.';
	reasons[1].dispatchEvent(new win.Event('input') as unknown as Event);
	assert.equal(go.disabled, false);
	assert.equal(s.asks.el.querySelectorAll('[aria-pressed=true]').length, 2);
});

test('a confirmation that approves a tool action offers only Paperclip; a connection is always Paperclip\'s; the unknown is too', () => {
	const tool = make('request_confirmation', { version: 1, prompt: 'Run the export?', toolAction: { name: 'x' } });
	const conn = make('connection_intent', { version: 1, serviceName: 'GitHub', serviceSlug: 'github' });
	const odd = make('something_new', {});
	const s = slips([tool.r, conn.r, odd.r]);
	s.asks.show([tool.i, conn.i, odd.i], from('/issues/MOCK-7'));
	assert.equal(s.stamps().length, 0, 'no stamp on any of them');
	assert.match(s.asks.el.textContent!, /approve an action by a tool\. Decide it in Paperclip/);
	assert.match(s.asks.el.textContent!, /Anna needs access to GitHub\. Connecting an account happens in Paperclip, so no password or key ever passes through the plant\./);
	assert.match(s.asks.el.textContent!, /cannot show here \(something new\)/);
	const links = Array.from(s.asks.el.querySelectorAll('.p67-ask-link')) as unknown as HTMLAnchorElement[];
	assert.equal(links.length, 3);
	assert.equal(links[1].getAttribute('href'), `/issues/MOCK-7#interaction-${conn.i.id}`);
	assert.equal(links[1].target, '_blank');
	assert.doesNotMatch(s.asks.el.textContent!, /Answering wakes/, 'nothing here is answered from the plant');
});

test('an answer to a question answered meanwhile is not sent, and the slip says so', async () => {
	const { r, i } = make('request_confirmation', { version: 1, prompt: 'Go?' });
	const s = slips([{ ...r, status: 'accepted' }]);
	s.asks.show([i], from());
	await hold(s.stamps()[0]);
	assert.equal(s.sent.length, 0);
	assert.match(s.asks.el.querySelector('.p67-ask-status')!.textContent!, /answered or withdrawn meanwhile, so nothing was sent/);
	assert.equal(s.stamps()[0].disabled, false, 'the stamps are live again');
});

test('sub-tasks follow every task above and below them, however deep', () => {
	const { r, i } = make('suggest_tasks', { version: 1, tasks: [{ clientKey: 'g', title: 'Grand' }, { clientKey: 'p', parentClientKey: 'g', title: 'Parent' }, { clientKey: 'c', parentClientKey: 'p', title: 'Child' }] });
	const s = slips([r]);
	s.asks.show([i], from());
	const boxes = Array.from(s.asks.el.querySelectorAll('input[type=checkbox]')) as unknown as HTMLInputElement[];
	set(boxes[0], false);
	assert.deepEqual(boxes.map((b) => b.checked), [false, false, false], 'clearing the top clears all under it');
	set(boxes[2]);
	assert.deepEqual(boxes.map((b) => b.checked), [true, true, true], 'ticking the bottom ticks all above it');
});

test('a question with no fitting option can be answered in Paperclip\'s "Other" box, and an optional choice can be cleared', async () => {
	const { r, i } = make('ask_user_questions', { version: 1, questions: [
		{ id: 'q', prompt: 'Which?', required: true, selectionMode: 'single', options: [{ id: 'a', label: 'A' }] },
		{ id: 'o', prompt: 'And?', required: false, selectionMode: 'single', options: [{ id: 'b', label: 'B' }] },
	] });
	const s = slips([r]);
	s.asks.show([i], from());
	const [go] = s.stamps();
	const [other] = Array.from(s.asks.el.querySelectorAll('.p67-ask-other')) as unknown as HTMLInputElement[];
	assert.equal(other.hidden, true, 'behind its button, as in Paperclip');
	(Array.from(s.asks.el.querySelectorAll('.p67-ask-clear')).find((b) => b.textContent === 'Other…') as unknown as HTMLButtonElement).click();
	assert.equal(other.hidden, false);
	other.value = 'Neither: C.';
	other.dispatchEvent(new win.Event('input') as unknown as Event);
	assert.equal(go.disabled, false, 'own words answer a required question');
	const radios = Array.from(s.asks.el.querySelectorAll('input[type=radio]')) as unknown as HTMLInputElement[];
	set(radios[1]);
	(Array.from(s.asks.el.querySelectorAll('.p67-ask-clear')).find((b) => b.textContent === 'Clear the choice') as unknown as HTMLButtonElement).click();
	assert.equal(radios[1].checked, false);
	await hold(go);
	assert.deepEqual((s.sent[0].body as { answers: unknown }).answers, [{ questionId: 'q', optionIds: [], otherText: 'Neither: C.' }, { questionId: 'o', optionIds: [], otherText: null }]);
});

test('a yes/no says what it is about; one about something unreadable is decided in Paperclip; a yes-only wake says so', () => {
	const pr = make('request_confirmation', { version: 1, prompt: 'Ready to merge?', target: { type: 'custom', key: 'acme/prod#42', label: 'Pull request 42', href: 'https://example.invalid/pr/42' } });
	const odd = make('request_confirmation', { version: 1, prompt: 'Ready?', target: { type: 'custom' } });
	const yesOnly = { ...make('request_confirmation', { version: 1, prompt: 'Go?' }).r, continuationPolicy: 'wake_assignee_on_accept' };
	const s = slips([pr.r, odd.r, yesOnly]);
	s.asks.show([pr.i, odd.i, toInteraction(yesOnly)!], from('/issues/MOCK-3'));
	const text = s.asks.el.textContent!;
	assert.match(text, /This is about: Pull request 42 \(acme\/prod#42\)https:\/\/example\.invalid\/pr\/42/, 'the label, the comrade\'s own key for it, and the address');
	assert.equal(s.asks.el.querySelectorAll('a[href^="https://example.invalid"]').length, 0, 'an address from an agent is text, never a link');
	assert.match(text, /about something the plant cannot show\. Decide it in Paperclip/);
	assert.match(text, /A yes wakes Anna: it starts a run\./);
	assert.equal(s.stamps().length, 4, 'two slips with stamps; the unreadable one has none');
});

test('verdict items show what they point at, and a reason typed for a rejection is not sent with an approval', async () => {
	const { r, i } = make('request_item_verdicts', { version: 1, prompt: 'Which?', items: [{ id: 'a', label: 'A', previewMarkdown: 'The whole text of A.', href: '/issues/X-1' }] });
	const s = slips([r]);
	s.asks.show([i], from());
	assert.match(s.asks.el.textContent!, /What it isThe whole text of A\./);
	assert.match(s.asks.el.textContent!, /\/issues\/X-1/);
	(s.asks.el.querySelector('.p67-ask-v-reject') as unknown as HTMLButtonElement).click();
	const reason = s.asks.el.querySelector('.p67-ask-reason') as unknown as HTMLTextAreaElement;
	reason.value = 'No.';
	reason.dispatchEvent(new win.Event('input') as unknown as Event);
	(s.asks.el.querySelector('.p67-ask-v-approve') as unknown as HTMLButtonElement).click();
	await hold(s.stamps()[0]);
	assert.deepEqual(s.sent[0].body, { verdicts: [{ id: 'a', verdict: 'approve', reason: null }] });
	reason.dispatchEvent(new win.Event('input') as unknown as Event);
	assert.equal(s.stamps()[0].disabled, true, 'once answered, typing never unlocks the stamp again');
});

test('a slip taken down mid-hold sends nothing; its replacement says the question changed', async () => {
	const { r, i } = make('request_confirmation', { version: 1, prompt: 'Go?' });
	const s = slips([r]);
	s.asks.show([i], from());
	const old = s.stamps()[0];
	old.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	const changed = { ...r, payload: { version: 1, prompt: 'Go, and burn the archive?' } };
	s.asks.show([toInteraction(changed)!], from());
	await new Promise((res) => setTimeout(res, 1_150));
	old.dispatchEvent(new win.PointerEvent('pointerup') as unknown as Event);
	await new Promise((res) => setTimeout(res, 30));
	assert.equal(s.sent.length, 0);
	assert.match(s.asks.el.textContent!, /This question changed after it was first shown\. Read it again before you answer\./);
	assert.match(s.asks.el.textContent!, /burn the archive/);
});

test('verdict items decided in Paperclip meanwhile are shown as decided and left out of the answer', async () => {
	const { r } = make('request_item_verdicts', { version: 1, prompt: 'Which?', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
	const partly = { ...r, result: { version: 1, outcome: 'resolved', complete: false, items: [{ id: 'a', verdict: 'approve', resolvedAt: '2026-09-30T10:01:00Z' }] } };
	const s = slips([partly]);
	s.asks.show([toInteraction(partly)!], from());
	assert.match(s.asks.el.textContent!, /Decided already in Paperclip: approve\./);
	assert.equal(s.asks.el.querySelectorAll('.p67-ask-v-approve').length, 1, 'only B asks for a verdict');
	(s.asks.el.querySelector('.p67-ask-v-approve') as unknown as HTMLButtonElement).click();
	await hold(s.stamps()[0]);
	assert.deepEqual(s.sent[0].body, { verdicts: [{ id: 'b', verdict: 'approve', reason: null }] });
});
