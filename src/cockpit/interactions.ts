/**
 * The comrade's questions, as slips of paper above the chat box: a yes/no, a checklist, a short
 * form of questions, suggested tasks, verdicts on a list of items, and a request to connect an
 * account (sent to Paperclip). Each answer is a press-and-hold stamp, each slip says whether an
 * answer wakes the comrade, and a line under the stamps says why one is still locked.
 *
 * A slip is kept, with whatever the owner has ticked or typed, for as long as its question is
 * unchanged: the chat reads the questions again every few seconds, and that must not wipe a
 * half-filled form. Every word from Paperclip is set with textContent; links an agent supplies
 * are shown as text, never made clickable.
 */
import { type Answer, type Choice, type Interaction, type VerdictValue, answer } from '../live/interactions';
import { failureWords } from '../live/directives';
import type { FetchLike } from '../live/http';
import { el, setText } from './dom';
import { renderMarkdown } from './markdown';
import { type Stamp, createStamp } from './stamp';

/** Who a set of slips is from, and where their issue opens in Paperclip. */
export interface AskContext {
	/** The comrade's name. */
	who: string;
	agentId: string;
	/** The issue is the comrade's chat (so an answer shows them writing). */
	chat: boolean;
	/** Where the issue opens in Paperclip, or null. */
	link: string | null;
}

export interface AsksDeps {
	fetchImpl: FetchLike;
	/** A comrade's name, or null when they are not on the roster. */
	nameOf: (agentId: string) => string | null;
	/**
	 * Called after an answer went through, so the chat reads again.
	 *
	 * @param i The question answered.
	 * @param from Who asked it, as it was when the slip was drawn.
	 * @param yes True for a yes (an accept), which matters when only a yes wakes the comrade.
	 */
	onAnswered: (i: Interaction, from: AskContext, yes: boolean) => void;
}

export interface Asks {
	/** The slips (empty and hidden while nothing is asked). */
	el: HTMLElement;
	/**
	 * Show the questions waiting for the owner.
	 *
	 * @param pending Interactions with status 'pending', oldest first.
	 * @param from Who is asking.
	 */
	show(pending: Interaction[], from: AskContext): void;
}

/** The words on the verdict buttons. */
const VERDICT_WORDS: Record<VerdictValue, { mark: string; label: string }> = {
	approve: { mark: '✓', label: 'Approve' },
	reject: { mark: '✗', label: 'Reject' },
	defer: { mark: '…', label: 'Later' },
};

/**
 * Build the slips.
 *
 * @param d Dependencies.
 * @returns Asks.
 */
export function createAsks(d: AsksDeps): Asks {
	const root = el('section', 'p67-asks');
	root.setAttribute('aria-label', 'Questions waiting for you');
	root.hidden = true;
	/** Slips on show, by interaction id: the fingerprint each was built from, and how to retire it. */
	const slips = new Map<string, { node: HTMLElement; fingerprint: string; retire: () => void }>();

	/**
	 * A paragraph of the comrade's words, kept as they wrote them (markdown shown as plain text).
	 *
	 * @param words Text.
	 * @param cls Class.
	 * @returns Element.
	 */
	const para = (words: string, cls = 'p67-ask-text'): HTMLElement => el('p', cls, words);

	/**
	 * The comrade's own words, with their markdown read safely (markdown.ts).
	 *
	 * @param words Text.
	 * @param cls Class.
	 * @returns Element.
	 */
	const theirs = (words: string, cls = 'p67-ask-text'): HTMLElement => {
		const box = el('div', cls);
		box.append(renderMarkdown(words));
		return box;
	};

	/**
	 * Long words folded away under a summary line.
	 *
	 * @param words Text, or null.
	 * @param summary The line shown folded.
	 * @returns Element, or null.
	 */
	const details = (words: string | null, summary = 'Details'): HTMLElement | null => {
		if (!words) return null;
		const box = el('details', 'p67-ask-details');
		box.append(el('summary', '', summary), theirs(words));
		return box;
	};

	/**
	 * A reason box.
	 *
	 * @param label What it is for.
	 * @returns The textarea.
	 */
	const reasonBox = (label: string): HTMLTextAreaElement => {
		const t = el('textarea', 'p67-ask-reason');
		t.rows = 2;
		t.placeholder = label;
		t.setAttribute('aria-label', label);
		t.addEventListener('keydown', (e) => e.stopPropagation());
		return t;
	};

	/**
	 * One line of own words.
	 *
	 * @param label What it is for.
	 * @returns The input.
	 */
	const wordsBox = (label: string): HTMLInputElement => {
		const t = el('input', 'p67-ask-other');
		t.type = 'text';
		t.placeholder = label;
		t.setAttribute('aria-label', label);
		t.addEventListener('keydown', (e) => e.stopPropagation());
		return t;
	};

	/**
	 * One tick box with its label.
	 *
	 * @param o Option.
	 * @param on Ticked at first.
	 * @param boxes Where the box is registered, by option id.
	 * @param changed Called when it is ticked or cleared.
	 * @returns The label.
	 */
	const tick = (o: Choice, on: boolean, boxes: Map<string, HTMLInputElement>, changed: () => void): HTMLElement => {
		const box = el('input');
		box.type = 'checkbox';
		box.checked = on;
		box.addEventListener('change', changed);
		boxes.set(o.id, box);
		const label = el('label', 'p67-ask-option');
		label.append(box, document.createTextNode(` ${o.label}`));
		if (o.description) label.append(el('small', '', ` ${o.description}`));
		return label;
	};

	/**
	 * Build one slip.
	 *
	 * @param i Interaction.
	 * @param from Who is asking.
	 * @param changed The question changed while an earlier slip for it was on show.
	 * @returns The slip, and how to retire it once it is taken down.
	 */
	function slip(i: Interaction, from: AskContext, changed: boolean): { node: HTMLElement; retire: () => void } {
		const who = from.who;
		const node = el('article', 'p67-ask');
		const heading = i.title ?? (i.kind === 'questions' ? `${who} has some questions` : i.kind === 'tasks' ? `${who} suggests some tasks` : i.kind === 'verdicts' ? `${who} asks for your verdicts` : i.kind === 'connect' ? `${who} needs access` : `${who} asks`);
		node.append(el('h4', 'p67-ask-head', `☭ ${heading}`));
		const status = el('p', 'p67-ask-status');
		status.setAttribute('role', 'status');
		if (changed) setText(status, 'This question changed after it was first shown. Read it again before you answer.');
		const why = el('p', 'p67-ask-why');
		why.setAttribute('aria-live', 'polite');
		const stamps: Stamp[] = [];
		let busy = false;
		/** Answered: nothing may unlock the stamps again while the slip waits to be taken down. */
		let done = false;
		/** Taken down: a stamp still held on the old slip must not send anything. */
		let retired = false;
		/** Re-check every stamp's lock; set by each kind below. */
		let check = (): void => {};
		let linked = false;

		/**
		 * Say why a stamp is locked, under the stamps where everyone can read it.
		 *
		 * @param words The reason, or '' when nothing is locked.
		 */
		const explain = (words: string): void => setText(why, words);

		/**
		 * The row of stamps.
		 *
		 * @param list Stamps.
		 * @returns Element.
		 */
		const stampRow = (list: Stamp[]): HTMLElement => {
			stamps.push(...list);
			const row = el('div', `p67-stamps ${list.length === 1 ? 'p67-one' : 'p67-two'}`);
			row.append(...list.map((s) => s.el));
			return row;
		};

		/**
		 * Send an answer, then say what came of it.
		 *
		 * @param a Answer.
		 * @param said What to say once it went through.
		 */
		const send = async (a: Answer, said: string): Promise<void> => {
			if (busy || done || retired) return;
			busy = true;
			for (const s of stamps) s.set(false, 'Sending…');
			explain('');
			setText(status, 'Sending your answer…');
			const r = await answer(d.fetchImpl, i, a);
			busy = false;
			if (r.ok) {
				done = true;
				setText(status, said);
				d.onAnswered(i, from, a.kind === 'accept');
				return;
			}
			setText(status, 'stale' in r ? r.stale : failureWords(r, 'Your answer was not sent', 'Paperclip'));
			check();
		};

		/**
		 * A link to this question in Paperclip, in a new tab.
		 *
		 * @param words The link's words.
		 * @returns The link, or null when the issue has no address yet.
		 */
		const openLink = (words: string): HTMLElement | null => {
			if (!from.link) return null;
			linked = true;
			const a = el('a', 'p67-ask-link', words);
			a.href = `${from.link}#interaction-${encodeURIComponent(i.id)}`;
			a.target = '_blank';
			a.rel = 'noopener';
			return a;
		};

		/**
		 * What a confirmation is about, in words, with any address as plain text.
		 *
		 * @param t Target.
		 * @returns Element.
		 */
		const about = (t: { label: string | null; key: string | null; href: string | null }): HTMLElement => {
			const box = el('p', 'p67-ask-target');
			const name = [t.label, t.key && t.key !== t.label ? `(${t.key})` : null].filter(Boolean).join(' ');
			box.append(el('b', '', 'This is about: '), document.createTextNode(name || 'the address below'));
			if (t.href) box.append(el('span', 'p67-ask-href', t.href));
			return box;
		};

		/**
		 * Mark a stamp's lock and collect the reason.
		 *
		 * @param s Stamp.
		 * @param reason Why it is locked, or '' when it is not.
		 * @param reasons Where the reasons go.
		 */
		const lock = (s: Stamp, reason: string, reasons: string[]): void => {
			s.set(!reason, reason || undefined);
			if (reason) reasons.push(reason);
		};

		switch (i.kind) {
			case 'confirm':
			case 'checklist': {
				node.append(theirs(i.prompt));
				if (i.target) node.append(about(i.target));
				const more = details(i.details);
				if (more) node.append(more);
				if (i.locked) {
					node.append(para(i.locked, 'p67-ask-status'));
					const a = openLink('Open in Paperclip');
					if (a) node.append(a);
					break;
				}
				const boxes = new Map<string, HTMLInputElement>();
				if (i.kind === 'checklist') {
					const list = el('div', 'p67-ask-options');
					for (const o of i.options) list.append(tick(o, i.defaults.includes(o.id), boxes, () => check()));
					node.append(list);
				}
				const reason = i.reasonAllowed || i.reasonRequired ? reasonBox(i.reasonRequired ? 'Your reason (needed to decline)' : 'A reason, if you decline (optional)') : null;
				if (reason) { node.append(reason); reason.addEventListener('input', () => check()); }
				const yes = createStamp('ДА', i.acceptLabel ? `${i.acceptLabel}: hold` : 'Yes: hold', 'green', () => void send(
					i.kind === 'checklist' ? { kind: 'accept', selectedOptionIds: [...boxes].filter(([, b]) => b.checked).map(([id]) => id) } : { kind: 'accept' },
					'Answered: yes.',
				));
				const no = createStamp('НЕТ', i.rejectLabel ? `${i.rejectLabel}: hold` : 'No: hold', 'red', () => void send(
					reason?.value.trim() ? { kind: 'reject', reason: reason.value.trim() } : { kind: 'reject' },
					'Answered: no.',
				));
				node.append(stampRow([yes, no]));
				check = () => {
					if (busy || done) return;
					const n = [...boxes.values()].filter((b) => b.checked).length;
					const range = i.kind !== 'checklist' ? ''
						: n < i.min ? `Tick at least ${i.min} for a yes.`
							: i.max !== null && n > i.max ? `Tick at most ${i.max} for a yes.` : '';
					const reasons: string[] = [];
					lock(yes, range, reasons);
					lock(no, i.reasonRequired && !reason?.value.trim() ? 'Write a reason to say no.' : '', reasons);
					explain(reasons.join(' '));
				};
				break;
			}
			case 'questions': {
				const answers = new Map<string, { picked: () => string[]; other: () => string | null; ok: () => boolean }>();
				for (const q of i.questions) {
					const set = el('fieldset', 'p67-ask-question');
					set.append(el('legend', '', q.prompt + (q.required ? '' : ' (optional)')));
					if (q.help) set.append(theirs(q.help, 'p67-ask-help'));
					const inputs: [Choice, HTMLInputElement][] = [];
					// The question's own "in your own words" option, or Paperclip's "Other" box beside the options.
					let words: HTMLInputElement | null = null;
					for (const o of q.options) {
						const box = el('input');
						box.type = q.multi ? 'checkbox' : 'radio';
						box.name = `p67-q-${i.id}-${q.id}`;
						const label = el('label', 'p67-ask-option');
						label.append(box, document.createTextNode(` ${o.label}`));
						if (o.description) label.append(el('small', '', ` ${o.description}`));
						set.append(label);
						inputs.push([o, box]);
						if (o.freeText) {
							words = wordsBox(`${o.label}: in your own words`);
							words.hidden = true;
							words.addEventListener('input', () => check());
							set.append(words);
						}
						box.addEventListener('change', () => {
							if (!q.other && words) words.hidden = !inputs.some(([c, b]) => c.freeText && b.checked);
							check();
						});
					}
					if (q.other) {
						// Paperclip's "Other": a box behind a button, so a long form is not a wall of empty boxes.
						const box = wordsBox('Other: in your own words');
						box.hidden = true;
						box.addEventListener('input', () => check());
						const toggle = el('button', 'p67-ask-clear', 'Other…');
						toggle.type = 'button';
						toggle.setAttribute('aria-expanded', 'false');
						toggle.addEventListener('click', () => {
							box.hidden = !box.hidden;
							toggle.setAttribute('aria-expanded', String(!box.hidden));
							setText(toggle, box.hidden ? 'Other…' : 'No other');
							if (!box.hidden) box.focus();
							check();
						});
						set.append(toggle, box);
						words = box;
					}
					if (!q.required && !q.multi) {
						// A picked radio cannot be cleared by clicking it again.
						const clear = el('button', 'p67-ask-clear', 'Clear the choice');
						clear.type = 'button';
						clear.setAttribute('aria-label', `Clear the answer to: ${q.prompt}`);
						clear.addEventListener('click', () => { for (const [, b] of inputs) b.checked = false; if (words && !q.other) words.hidden = true; check(); });
						set.append(clear);
					}
					const own = words;
					const typed = (): string | null => (own && !own.hidden ? own.value.trim() || null : null);
					answers.set(q.id, {
						picked: () => inputs.filter(([, b]) => b.checked).map(([c]) => c.id),
						other: typed,
						ok: () => {
							const picked = inputs.filter(([, b]) => b.checked);
							if (picked.some(([c]) => c.freeText) && !typed()) return false;
							return !q.required || picked.length > 0 || (q.other && !!typed());
						},
					});
					node.append(set);
				}
				const go = createStamp('ОТВЕТИТЬ', i.submitLabel ? `${i.submitLabel}: hold` : 'Answer: hold', 'green', () => void send({
					kind: 'respond',
					answers: i.questions.map((q) => ({ questionId: q.id, optionIds: answers.get(q.id)!.picked(), otherText: answers.get(q.id)!.other() })),
				}, 'Answered.'));
				node.append(stampRow([go]));
				check = () => {
					if (busy || done) return;
					const reasons: string[] = [];
					lock(go, i.questions.every((q) => answers.get(q.id)!.ok()) ? '' : 'Answer every question not marked optional, and fill in any "own words" you picked.', reasons);
					explain(reasons.join(' '));
				};
				break;
			}
			case 'tasks': {
				const boxes = new Map<string, HTMLInputElement>();
				const parentOf = new Map(i.tasks.map((t) => [t.key, t.parentKey]));
				const list = el('div', 'p67-ask-options');
				for (const t of i.tasks) {
					const whom = t.assigneeAgentId ? d.nameOf(t.assigneeAgentId) ?? 'a comrade not on the roster' : null;
					const row = tick({ id: t.key, label: t.title, description: whom ? `For ${whom}.` : null, freeText: false }, true, boxes, () => {});
					// Indented once per level of parent (a loop in the parents stops at six).
					let depth = 0;
					for (let p = t.parentKey; p && depth < 6; p = parentOf.get(p) ?? null) depth++;
					row.style.marginLeft = `${depth * 18}px`;
					const more = details(t.description);
					if (more) row.append(more);
					list.append(row);
				}
				/**
				 * Every task under a task, however deep.
				 *
				 * @param key Task.
				 * @returns Keys below it.
				 */
				const below = (key: string): string[] => {
					const out: string[] = [];
					const todo = [key];
					while (todo.length) {
						const k = todo.pop()!;
						for (const t of i.tasks) if (t.parentKey === k && !out.includes(t.key)) { out.push(t.key); todo.push(t.key); }
					}
					return out;
				};
				// A sub-task needs every task above it: ticking one ticks them all, and clearing one clears everything under it.
				for (const t of i.tasks) {
					boxes.get(t.key)!.addEventListener('change', () => {
						if (boxes.get(t.key)!.checked) {
							const seen = new Set<string>();
							for (let p = t.parentKey; p && !seen.has(p); p = parentOf.get(p) ?? null) { seen.add(p); const b = boxes.get(p); if (b) b.checked = true; }
						} else for (const k of below(t.key)) boxes.get(k)!.checked = false;
						check();
					});
				}
				node.append(list);
				const take = createStamp('ПРИНЯТЬ', 'Create the ticked tasks: hold', 'green', () => void send({ kind: 'accept', selectedClientKeys: [...boxes].filter(([, b]) => b.checked).map(([k]) => k) }, 'Accepted: the ticked tasks are being created.'));
				const refuse = createStamp('ОТКЛОНИТЬ', 'Decline them all: hold', 'red', () => void send({ kind: 'reject' }, 'Declined.'));
				node.append(stampRow([take, refuse]));
				check = () => {
					if (busy || done) return;
					const reasons: string[] = [];
					lock(take, [...boxes.values()].some((b) => b.checked) ? '' : 'Tick at least one task, or decline them all.', reasons);
					lock(refuse, '', reasons);
					explain(reasons.join(' '));
				};
				break;
			}
			case 'verdicts': {
				node.append(theirs(i.prompt));
				const more = details(i.details);
				if (more) node.append(more);
				const chosen = new Map<string, VerdictValue>();
				const reasons = new Map<string, HTMLTextAreaElement>();
				const list = el('div', 'p67-ask-items');
				// Items decided in Paperclip meanwhile are shown as such: Paperclip ignores a second verdict on them.
				const open = i.items.filter((item) => !item.decided);
				for (const item of i.items.filter((x) => x.decided)) {
					const row = el('div', 'p67-ask-item');
					row.append(el('span', 'p67-ask-item-label', item.label), el('small', '', `Decided already in Paperclip: ${VERDICT_WORDS[item.decided!].label.toLowerCase()}.`));
					list.append(row);
				}
				for (const item of open) {
					const row = el('div', 'p67-ask-item');
					row.append(el('span', 'p67-ask-item-label', item.label));
					const buttons = el('span', 'p67-ask-verdict');
					buttons.setAttribute('role', 'group');
					buttons.setAttribute('aria-label', `Verdict on ${item.label}`);
					row.append(buttons);
					if (item.description) row.append(el('small', '', item.description));
					// What the item points at, as the comrade gave it: the owner judges the thing, not only its label.
					const preview = details(item.preview, 'What it is');
					if (preview) row.append(preview);
					if (item.href) row.append(el('small', 'p67-ask-href', item.href));
					const reason = reasonBox(`Why, for ${item.label}`);
					reason.hidden = true;
					reason.addEventListener('input', () => check());
					reasons.set(item.id, reason);
					for (const v of i.verdicts) {
						const b = el('button', `p67-ask-v p67-ask-v-${v}`, VERDICT_WORDS[v].mark);
						b.type = 'button';
						b.title = VERDICT_WORDS[v].label;
						b.setAttribute('aria-pressed', 'false');
						b.setAttribute('aria-label', `${VERDICT_WORDS[v].label} ${item.label}`);
						b.addEventListener('click', () => {
							chosen.set(item.id, v);
							for (const x of Array.from(buttons.children)) x.setAttribute('aria-pressed', String(x === b));
							reason.hidden = !i.reasonOn.includes(v);
							check();
						});
						buttons.append(b);
					}
					row.append(reason);
					list.append(row);
				}
				node.append(list);
				const go = createStamp('ВЕРДИКТ', 'Send every verdict: hold', 'amber', () => void send({
					kind: 'verdicts',
					// A reason typed for one verdict is not sent with another that asks for none.
					verdicts: open.map((item) => ({ id: item.id, verdict: chosen.get(item.id)!, reason: i.reasonOn.includes(chosen.get(item.id)!) ? reasons.get(item.id)!.value.trim() || null : null })),
				}, 'Verdicts sent.'));
				node.append(stampRow([go]));
				check = () => {
					if (busy || done) return;
					const missing = open.filter((item) => !chosen.has(item.id)).length;
					const unexplained = open.some((item) => i.reasonOn.includes(chosen.get(item.id)!) && !reasons.get(item.id)!.value.trim());
					const out: string[] = [];
					lock(go, !open.length ? 'Every item is decided already.' : missing ? `Give a verdict on every item (${missing} left).` : unexplained ? 'Give a reason where one is asked for.' : '', out);
					explain(out.join(' '));
				};
				break;
			}
			case 'connect': {
				node.append(para(`${who} needs access to ${i.service}. Connecting an account happens in Paperclip, so no password or key ever passes through the plant.`));
				const a = openLink('Open in Paperclip');
				if (a) node.append(a);
				break;
			}
			case 'unknown': {
				node.append(para(`${who} is asking something the plant cannot show here (${i.rawKind.replace(/_/g, ' ')}). Answer it in Paperclip.`));
				const a = openLink('Open in Paperclip');
				if (a) node.append(a);
				break;
			}
		}
		if (stamps.length) {
			node.append(why);
			if (i.wakes) node.append(el('p', 'p67-ask-wake', i.wakes === 'yes' ? `A yes wakes ${who}: it starts a run.` : `Answering wakes ${who}: it starts a run.`));
		}
		node.append(status);
		// Every slip offers Paperclip's own view, for a question the owner would rather answer there.
		if (!linked) { const a = openLink('See it in Paperclip'); if (a) node.append(a); }
		check();
		return { node, retire: () => { retired = true; } };
	}

	return {
		el: root,
		show(pending, from) {
			const ids = new Set(pending.map((i) => i.id));
			let gone = false;
			for (const [id, s] of slips) if (!ids.has(id)) { s.retire(); s.node.remove(); slips.delete(id); gone = true; }
			// With an answered slip gone, start from the top again rather than part-way down the next one.
			if (gone) root.scrollTop = 0;
			pending.forEach((i, k) => {
				let s = slips.get(i.id);
				// A changed question is a new slip; an unchanged one keeps what the owner ticked or typed.
				const changed = !!s && s.fingerprint !== i.fingerprint;
				if (s && changed) { s.retire(); s.node.remove(); s = undefined; }
				if (!s) { s = { ...slip(i, from, changed), fingerprint: i.fingerprint }; slips.set(i.id, s); }
				if (root.children[k] !== s.node) root.insertBefore(s.node, root.children[k] ?? null);
			});
			root.hidden = pending.length === 0;
		},
	};
}
