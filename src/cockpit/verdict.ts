/**
 * The board's windows: the verdict window for a tribunal and the papers window for a hire.
 * Both use press-and-hold stamps (stamp.ts) and never act blind.
 *
 * Tribunal: ВИНОВЕН stays locked until the case has been checked (the report is really the
 * Director's, the accused is on the roster) and the report has been opened. It approves the
 * referral and then terminates the agent: approval first, so the decision is always on record;
 * a failed termination can be retried without approving twice, even after a reload. ПОМИЛОВАН
 * needs a written reason and rejects the referral with it.
 *
 * Hire: ОДОБРЕНО approves the hire; ОТКАЗАНО needs a reason and rejects it.
 *
 * While a decision is in flight the window cannot be replaced or closed, so its outcome is
 * always seen. Every word from Paperclip is shown with textContent only.
 */
import { issueHref } from './links';
import { type Failure, type HireRequest, type TribunalCase, approvalState, approve, reject, terminate } from '../live/approvals';
import { failureWords } from '../live/directives';
import { UUID, type FetchLike, request } from '../live/http';
import { el, setText } from './dom';
import { type Stamp, createStamp } from './stamp';

/** Note written on a guilty verdict. */
export const GUILTY_NOTE = "Guilty. Verdict of the board, given in The People's Plant #67.";
/** Note written on an approved hire. */
export const HIRE_NOTE = "Approved by the board in The People's Plant #67.";
/** localStorage key for guilty verdicts recorded but not yet carried out. */
export const UNFINISHED_KEY = 'plant67.unfinished';
/** localStorage key for verdicts the owner chose to leave unfinished. */
export const LEFT_KEY = 'plant67.leftAlone';
/** localStorage key for unfinished verdicts that were given in the dashboard. */
export const ADOPTED_KEY = 'plant67.adopted';

/** The accused as the roster knows them: the window names whoever will actually be terminated. */
export interface Accused {
	name: string;
	title: string | null;
}

export interface Board {
	el: HTMLElement;
	readonly open: boolean;
	/**
	 * Show the verdict window for a case. Ignored while a decision is in flight.
	 *
	 * @param c The case.
	 * @param who The accused from the roster (the payload's name is only mentioned if it differs).
	 * @param check Resolves to a sentence saying why the case cannot be decided, or null when it can.
	 */
	showTribunal(c: TribunalCase, who: Accused, check: () => Promise<string | null>): void;
	/** Show the papers window for a hire. Ignored while a decision is in flight. */
	showHire(h: HireRequest): void;
	hide(): void;
	/** The approval being decided here right now (so the scene keeps waiting), or null. */
	readonly deciding: string | null;
	/** True for a guilty verdict recorded in Paperclip whose termination has not gone through yet. */
	unfinished(approvalId: string): boolean;
	/** Those cases, kept across reloads. */
	unfinishedCases(): TribunalCase[];
	/** Drop an unfinished case (its agent is gone, so there is nothing left to finish). */
	forget(approvalId: string): void;
	/** Take on a guilty verdict given elsewhere (the dashboard) whose termination never happened. */
	adopt(c: TribunalCase): void;
}

export interface BoardDeps {
	fetchImpl: FetchLike;
	/** A verdict was carried out in full. */
	onTribunal(approvalId: string, verdict: 'guilty' | 'pardoned'): void;
	/** A hire was decided. */
	onHire(approvalId: string, verdict: 'approved' | 'refused'): void;
	/** A verdict window closed without a verdict (so the court can rise). */
	onClose?(approvalId: string): void;
	/**
	 * Asked just before a guilty verdict is recorded and carried out: a sentence to refuse it
	 * (the accused is the owner's own seat), or null to go ahead.
	 */
	refuse?(agentId: string): string | null;
}

/**
 * The Director's report as plain words, for a host with no issue page to open.
 *
 * @param f Fetch.
 * @param issueId The report's issue id.
 * @returns Whether it was read, and its title and description or a sentence saying why not.
 */
async function readReport(f: FetchLike, issueId: string): Promise<{ ok: boolean; words: string }> {
	if (!UUID.test(issueId)) return { ok: false, words: 'The report could not be found.' };
	const got = await request(f, 'GET', `/api/issues/${issueId}`);
	if (!got.ok || !got.body || typeof got.body !== 'object') return { ok: false, words: 'The report could not be read just now. Try again in a moment.' };
	const b = got.body as Record<string, unknown>;
	const words = [b.title, b.description].filter((x): x is string => typeof x === 'string' && x.trim() !== '').join('\n\n');
	return { ok: true, words: words || 'The report is empty.' };
}

/**
 * Read the unfinished verdicts from storage, keeping only well-formed ones.
 *
 * @returns Cases by approval id.
 */
function loadUnfinished(): Map<string, TribunalCase> {
	try {
		const raw = JSON.parse(localStorage.getItem(UNFINISHED_KEY) ?? '[]') as unknown;
		if (!Array.isArray(raw)) return new Map();
		const ok = raw.filter((c): c is TribunalCase => !!c && typeof c === 'object' && UUID.test(String(c.approvalId)) && UUID.test(String(c.agentId))
			&& typeof c.agentName === 'string' && typeof c.charge === 'string' && Array.isArray(c.strikeList));
		return new Map(ok.map((c) => [c.approvalId, c]));
	} catch { return new Map(); }
}

/**
 * Build the board's window (hidden until a case or hire is shown).
 *
 * @param d Dependencies.
 * @returns Board.
 */
export function createBoard(d: BoardDeps): Board {
	const root = el('section', 'p67-board');
	root.hidden = true;
	root.setAttribute('role', 'dialog');
	root.setAttribute('aria-label', "The board's decision");
	let deciding: string | null = null;
	const pending = loadUnfinished();
	/** Unfinished verdicts given in the dashboard rather than stamped here. */
	const adopted = new Set<string>();
	try { const raw = JSON.parse(localStorage.getItem(ADOPTED_KEY) ?? '[]') as unknown; if (Array.isArray(raw)) for (const x of raw) if (typeof x === 'string') adopted.add(x); } catch { /* None. */ }
	let leftAlone: string[] = [];
	try { const raw = JSON.parse(localStorage.getItem(LEFT_KEY) ?? '[]') as unknown; if (Array.isArray(raw)) leftAlone = raw.filter((x): x is string => typeof x === 'string'); } catch { /* None left alone. */ }
	/** Write the unfinished verdicts back. */
	const keep = (): void => {
		try {
			localStorage.setItem(UNFINISHED_KEY, JSON.stringify([...pending.values()]));
			localStorage.setItem(ADOPTED_KEY, JSON.stringify([...adopted].filter((id) => pending.has(id))));
		} catch { /* Kept for this page only. */ }
	};
	let waitNote: HTMLElement | null = null;
	/** The case whose window is open, until it is decided. */
	let showing: string | null = null;

	/** Close the window, unless a decision is in flight (then say so). */
	const hide = (): void => {
		if (deciding) { if (waitNote) waitNote.textContent = 'Waiting for Paperclip to answer. The window closes by itself once it does.'; return; }
		root.hidden = true;
		root.replaceChildren();
		const was = showing;
		showing = null;
		if (was) d.onClose?.(was);
	};

	/**
	 * The frame both windows share: heading, name, subtitle and a close button.
	 *
	 * @param head Small heading.
	 * @param name Big name.
	 * @param sub Subtitle.
	 * @returns The body element to fill.
	 */
	const frame = (head: string, name: string, sub: string): HTMLElement => {
		root.replaceChildren();
		const close = el('button', 'p67-close', '×');
		close.type = 'button';
		close.setAttribute('aria-label', 'Close without deciding');
		close.addEventListener('click', hide);
		const body = el('div');
		root.append(close, el('div', 'p67-board-head', head), el('h2', '', name), el('p', 'p67-board-sub', sub), body);
		root.hidden = false;
		return body;
	};

	/**
	 * A stamp row plus the reason box, the note and the error line.
	 *
	 * @param body Where to put them.
	 * @param reasonPrompt Placeholder for the reason box.
	 * @returns Parts.
	 */
	const controls = (body: HTMLElement, reasonPrompt: string) => {
		// Why the stamps are locked, right above them, so it can never be missed.
		const lock = el('p', 'p67-lock');
		lock.setAttribute('role', 'status');
		lock.hidden = true;
		const row = el('div', 'p67-stamps');
		const reason = el('textarea', 'p67-reason');
		reason.placeholder = reasonPrompt;
		reason.rows = 2;
		reason.addEventListener('keydown', (e) => e.stopPropagation());
		const note = el('p', 'p67-board-note');
		const error = el('p', 'p67-chat-error');
		error.setAttribute('role', 'alert');
		body.append(lock, row, reason, note, error);
		waitNote = note;
		return { lock, row, reason, note, error };
	};

	return {
		el: root,
		get open() { return !root.hidden; },
		get deciding() { return deciding; },
		hide,
		unfinished: (id) => pending.has(id),
		unfinishedCases: () => [...pending.values()],
		forget(id) { if (pending.delete(id)) keep(); },
		adopt(c) {
			if (pending.has(c.approvalId) || leftAlone.includes(c.approvalId)) return;
			pending.set(c.approvalId, c);
			adopted.add(c.approvalId);
			keep();
		},
		showTribunal(c, who, check) {
			if (deciding) return;
			let body0: string;
			if (showing && showing !== c.approvalId) hide();
			showing = c.approvalId;
			const renamed = c.agentName.trim().toLowerCase() !== who.name.trim().toLowerCase();
			if (adopted.has(c.approvalId)) body0 = `Found guilty in the Paperclip dashboard${c.decidedAt ? ` on ${new Date(c.decidedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}, but not yet terminated.`;
			else body0 = '';
			const body = frame("THE PEOPLE'S COURT · PALACE OF CULTURE", who.name,
				`${who.title ?? 'Comrade'} · referred by the Director of Operational Hygiene${c.probation ? ' · on probation' : ''}${renamed ? ` · the referral calls them "${c.agentName}"` : ''}`);
			if (body0) body.append(el('p', 'p67-board-sub', body0));
			body.append(el('blockquote', 'p67-charge', c.charge));
			const table = el('table', 'p67-strikes');
			for (const s of c.strikeList) {
				const tr = el('tr');
				tr.append(el('td', '', s.date), el('td', s.serious ? 'p67-serious' : '', s.serious ? `${s.finding} Serious.` : s.finding));
				table.append(tr);
			}
			if (!c.strikeList.length) {
				const tr = el('tr');
				tr.append(el('td', '', `${c.strikes} live strikes; the Director listed no details here.`));
				table.append(tr);
			}
			body.append(table);
			let recorded = pending.has(c.approvalId);
			// A verdict stamped here only needs finishing: its report was read when it was given. One
			// given in the dashboard (adopted) is read again here before the plant carries it out.
			let read = recorded && !adopted.has(c.approvalId);
			let problem: string | null = 'Checking the referral with Paperclip…';
			let busy = false;
			if (c.reportIssueId) {
				const href = issueHref(c.reportIssueId);
				// Any way of opening it counts: a click, a middle-click, the keyboard.
				const opened = (): void => { read = true; refresh(); };
				if (href) {
					const a = el('a', 'p67-report', "Read the Director's report (opens in Paperclip)");
					a.href = href;
					a.target = '_blank';
					a.rel = 'noopener';
					a.addEventListener('click', opened);
					a.addEventListener('auxclick', opened);
					body.append(a);
				} else {
					// No page to open: read the report here instead.
					const show = el('button', 'p67-link', "Read the Director's report");
					show.type = 'button';
					const text = el('div', 'p67-report-text');
					text.hidden = true;
					show.addEventListener('click', () => {
						show.disabled = true;
						void readReport(d.fetchImpl, c.reportIssueId!).then((r) => {
							setText(text, r.words);
							text.hidden = false;
							// Only a report actually read unlocks the stamps; a failed read can be tried again.
							if (r.ok) { show.hidden = true; opened(); } else show.disabled = false;
						});
					});
					body.append(show, text);
				}
			}
			const guilty: Stamp = createStamp('ВИНОВЕН', recorded ? 'Guilty: hold to finish the termination' : 'Guilty: hold to terminate', 'red', () => void convict());
			const pardon: Stamp = createStamp('ПОМИЛОВАН', 'Pardon: hold, reason needed', 'green', () => void acquit());
			const { lock, row, reason, note, error } = controls(body, 'Why is this comrade pardoned? Your reason goes to the Director and into the ledger.');
			row.append(guilty.el, pardon.el);
			if (recorded) {
				// A verdict given elsewhere may have been left on purpose: the owner can stop the reminder.
				const leave = el('button', 'p67-link', 'Leave this comrade alive. The guilty verdict stays on record in Paperclip; the plant stops asking.');
				leave.type = 'button';
				leave.addEventListener('click', () => {
					if (deciding) return;
					pending.delete(c.approvalId);
					keep();
					leftAlone = [...leftAlone, c.approvalId].slice(-1000);
					try { localStorage.setItem(LEFT_KEY, JSON.stringify(leftAlone)); } catch { /* Forgotten on reload, then asked again. */ }
					hide();
				});
				body.append(leave);
			}

			/** Lock or unlock the stamps and say why. */
			const refresh = (): void => {
				// The lock line gives the reason; the note under the stamps only ever adds what the lock does not say.
				const why = busy ? 'Waiting for Paperclip.' : problem ?? (!read ? 'Open the report first.' : '');
				lock.textContent = why ? `Locked: ${why}` : '';
				lock.hidden = !why;
				guilty.set(!why, why);
				pardon.set(!why && !recorded && !!reason.value.trim(), why || (recorded ? 'The guilty verdict is already recorded.' : 'Write the reason first.'));
				reason.hidden = recorded;
				note.textContent = recorded && !problem
					? 'The guilty verdict is recorded in Paperclip, but the termination has not gone through yet. Hold ВИНОВЕН to finish it.'
					: 'Guilty terminates the agent in Paperclip and cannot be undone.';
			};
			reason.addEventListener('input', refresh);
			void check().then((p) => { problem = p; refresh(); }, () => { problem = 'The plant could not check this referral with Paperclip. Close the window and open it again.'; refresh(); });

			/**
			 * Show a failure and unlock again.
			 *
			 * @param r Failure.
			 * @param what What did not happen.
			 */
			const failed = (r: Failure, what: string): void => {
				error.textContent = failureWords({ ...r }, what);
				busy = false; deciding = null; refresh();
			};

			/** Guilty: record it, then terminate. */
			const convict = async (): Promise<void> => {
				const no = d.refuse?.(c.agentId);
				if (no) { error.textContent = no; return; }
				busy = true; deciding = c.approvalId; error.textContent = ''; refresh();
				if (!recorded) {
					const a = await approve(d.fetchImpl, c.approvalId, GUILTY_NOTE);
					if (!a.ok) {
						// No answer at all (a timeout, the network): Paperclip may have recorded it anyway.
						// Ask before deciding, so a verdict is never left half done without the plant knowing.
						const unanswered = a.status === 0 && !a.detail;
						const st = unanswered ? await approvalState(d.fetchImpl, c.approvalId) : null;
						if (!(st && st.status === 'approved' && st.agentId === c.agentId && st.tribunal)) {
							failed(a, unanswered ? 'The verdict may not have been recorded' : 'The verdict was not recorded');
							return;
						}
					}
					recorded = true;
					pending.set(c.approvalId, c);
					keep();
				}
				const t = await terminate(d.fetchImpl, c.agentId);
				if (!t.ok) { failed(t, 'The termination did not go through'); return; }
				pending.delete(c.approvalId);
				keep();
				busy = false; deciding = null;
				showing = null;
				d.onTribunal(c.approvalId, 'guilty');
				hide();
			};

			/** Pardon: reject with the reason. */
			const acquit = async (): Promise<void> => {
				busy = true; deciding = c.approvalId; error.textContent = ''; refresh();
				const r = await reject(d.fetchImpl, c.approvalId, reason.value);
				if (!r.ok) { failed(r, 'The pardon was not recorded'); return; }
				busy = false; deciding = null;
				showing = null;
				d.onTribunal(c.approvalId, 'pardoned');
				hide();
			};
			refresh();
		},
		showHire(h) {
			if (deciding) return;
			if (showing) hide();
			const body = frame('RECRUITMENT OFFICE · PAPERS FOR APPROVAL', h.name, [h.title, h.role].filter(Boolean).join(' · ') || 'No title on the papers.');
			if (h.replaces) body.append(el('p', 'p67-board-sub', `Replaces ${h.replaces}.`));
			if (h.rule) body.append(el('blockquote', 'p67-charge', `Hired under the rule: ${h.rule}`));
			if (h.about) body.append(el('blockquote', 'p67-charge', h.about));
			let busy = false;
			const yes = createStamp('ОДОБРЕНО', 'Approve: hold to hire', 'green', () => void decide(true));
			const no = createStamp('ОТКАЗАНО', 'Refuse: hold, reason needed', 'red', () => void decide(false));
			const { row, reason, note, error } = controls(body, 'Why is this hire refused? Your reason goes back to whoever asked for it.');
			row.append(yes.el, no.el);
			note.textContent = 'Approving lets this comrade start work. Refusing sends them back on the train.';

			/** Lock or unlock the stamps. */
			const refresh = (): void => {
				yes.set(!busy, 'Waiting for Paperclip.');
				no.set(!busy && !!reason.value.trim(), busy ? 'Waiting for Paperclip.' : 'Write the reason first.');
			};
			reason.addEventListener('input', refresh);

			/**
			 * Approve or refuse.
			 *
			 * @param ok True to approve.
			 */
			const decide = async (ok: boolean): Promise<void> => {
				busy = true; deciding = h.approvalId; error.textContent = ''; refresh();
				const r = ok ? await approve(d.fetchImpl, h.approvalId, HIRE_NOTE) : await reject(d.fetchImpl, h.approvalId, reason.value);
				busy = false; deciding = null;
				if (!r.ok) { error.textContent = failureWords(r, ok ? 'The hire was not approved' : 'The refusal was not recorded'); refresh(); return; }
				d.onHire(h.approvalId, ok ? 'approved' : 'refused');
				hide();
			};
			refresh();
		},
	};
}
