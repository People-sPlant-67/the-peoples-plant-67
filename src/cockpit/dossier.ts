/**
 * Dossiers: every pending approval that is neither a tribunal referral nor a hire. Its filer
 * (or the Company Lead, when the filer is not on the roster) carries a red "!", and their name
 * card lists it under "Dossiers (n)". Picking one opens the dossier window: the type, who filed
 * it and when, and three press-and-hold stamps that stay locked until the dossier is opened:
 *
 * - ОДОБРЕНО approves it.
 * - ОТКАЗАНО refuses it; a reason is required.
 * - НА ДОРАБОТКУ sends it back for changes; a note is required.
 *
 * "Filed by" comes from Paperclip's activity record, not the requester the caller names. Before
 * any stamp acts, the approval is read again: if someone has decided it meanwhile, or its content
 * no longer matches what the owner read (CHANGED), the window says so and nothing is sent.
 * ОДОБРЕНО stays locked while anything is not shown in full (CUT_WHY), and a payload shaped like
 * a tribunal referral locks every stamp (its `blocked` sentence). A failure keeps the owner's
 * note and says why. While a decision is in flight the window cannot be closed or replaced.
 * Afterwards the carrier's card says in a sentence what was decided, for DONE_MS. Every word
 * from Paperclip is shown with textContent only.
 */
import { type Failure, type OtherApproval, approvalOrigin, approve, dossierKey, readDossier, reject, requestRevision } from '../live/approvals';
import { failureWords } from '../live/directives';
import type { FetchLike } from '../live/http';
import { dossierHolder } from '../live/placement';
import type { Snapshot } from '../live/types';
import { el, setText } from './dom';
import { dateWords } from './words';
import { type Stamp, createStamp } from './stamp';
import { HIRE_NOTE } from './verdict';

/** Note sent with an approval when the owner wrote none. */
export const DOSSIER_NOTE = HIRE_NOTE;

/** What the owner decided. */
export type DossierVerdict = 'approved' | 'refused' | 'revision';

/** Each decision's stamp: its word, the line under it, and its ink. The cockpit drops the same word over the carrier. */
export const DOSSIER_STAMPS: Record<DossierVerdict, { word: string; hint: string; tone: 'red' | 'green' | 'amber' }> = {
	approved: { word: 'ОДОБРЕНО', hint: 'Approve: hold', tone: 'green' },
	refused: { word: 'ОТКАЗАНО', hint: 'Refuse: hold, reason needed', tone: 'red' },
	revision: { word: 'НА ДОРАБОТКУ', hint: 'Send back: hold, note needed', tone: 'amber' },
};

/** How long the card says what was just decided. */
export const DONE_MS = 10_000;

/** A sentence for an approval whose content changed after the owner opened it. */
export const CHANGED = 'Nothing was sent: this approval changed in Paperclip after you opened it. Close this window and open the dossier again to read the new version.';

/** Why ОДОБРЕНО stays locked when the dossier is not shown in full. */
export const CUT_WHY = 'Part of this dossier is too long to show here, so approve it in the dashboard, where you can read all of it. You can still refuse it or send it back from here.';

/** A sentence for a request-revision call Paperclip did not recognise. */
export const REVISION_404 = 'Paperclip did not recognise the request for changes, so nothing was changed. This plant may be using the wrong address for it; send it back from the dashboard instead.';

export interface DossierDeps {
	fetchImpl: FetchLike;
	/** The board user's id as the chat learned it, to say "by you"; null when unknown. */
	me?: () => string | null;
	/** A dossier was decided here. */
	onDecided?(o: OtherApproval, verdict: DossierVerdict, holder: string | null): void;
	/** A stamp found the approval already decided elsewhere. */
	onStale?(o: OtherApproval): void;
}

export interface Dossiers {
	/** The "Dossiers (n)" section, for the name card. */
	section: HTMLElement;
	/** The dossier window, for the cockpit root. */
	el: HTMLElement;
	/** Take in a good snapshot: who carries which dossier. */
	update(s: Snapshot): void;
	/** The comrade whose card is open (null when closed): their dossiers are listed. */
	show(agentId: string | null): void;
	/** Open the window for a dossier by approval id. Ignored while a decision is in flight. */
	openDossier(approvalId: string): void;
	/** Close the window, unless a decision is in flight. */
	hide(): void;
	/** Close the window if open. Returns true when it was. */
	escape(): boolean;
	readonly open: boolean;
	/** The approval being decided right now, or null. */
	readonly deciding: string | null;
	/** Dossiers nobody on the roster can carry (no filer, no Company Lead). */
	unrouted(): number;
	/** Pending dossiers by carrier, decided ones left out. */
	carried(agentId: string): OtherApproval[];
}

/**
 * The sentence for an approval someone else decided first.
 *
 * @param st Paperclip's copy of it.
 * @param me The board user's id, if known.
 * @returns Sentence.
 */
export function staleWords(st: { status: string; decidedBy: string | null; decidedAt: string | null }, me: string | null): string {
	const what: Record<string, string> = { approved: 'approved', rejected: 'refused', revision_requested: 'sent back for changes', cancelled: 'withdrawn' };
	const words = what[st.status] ?? `marked "${st.status || 'unknown'}"`;
	// The board user's id is learned from the first chat send, so before that nobody is "you".
	const by = !st.decidedBy ? '' : !me ? ' by a board member' : st.decidedBy === me ? ' by you' : ' by another board member';
	const at = dateWords(st.decidedAt);
	return `Nothing was sent: this approval was already ${words}${by}${at ? ` (${at})` : ''}. Paperclip's decision stands.`;
}

/**
 * Create the dossier section and window.
 *
 * @param d Dependencies.
 * @returns Dossiers.
 */
export function createDossiers(d: DossierDeps): Dossiers {
	const section = el('div', 'p67-dossiers');
	section.hidden = true;
	const win = el('section', 'p67-board p67-dossier');
	win.hidden = true;
	win.setAttribute('role', 'dialog');
	win.setAttribute('aria-label', 'A dossier for the board');
	win.tabIndex = -1;
	// Capture: the stamps and the reason box keep their keys to themselves, but Escape still closes.
	win.addEventListener('keydown', (e) => {
		if (e.key !== 'Escape') return;
		e.stopPropagation();
		e.preventDefault();
		const was = showing;
		hide();
		// Back to the button that opened it, for keyboard users.
		if (!showing && was) section.querySelector<HTMLElement>(`[data-approval="${was}"]`)?.focus();
	}, true);

	let last: Snapshot | null = null;
	/** Pending dossiers and who carries each. */
	let all: { o: OtherApproval; holder: string | null; filer: boolean }[] = [];
	/** Decided here, left out until Paperclip drops them from the pending list. */
	const decided = new Set<string>();
	let card: string | null = null;
	let showing: string | null = null;
	let deciding: string | null = null;
	/** Refresh the open window (set while it is open). */
	let refreshWindow: (() => void) | null = null;
	/** Lock the open window's stamps, so a hold already under way is cancelled (set while open). */
	let disarm: (() => void) | null = null;
	let waitNote: HTMLElement | null = null;
	/** Reasons typed but not yet sent, by approval, so closing the window never loses one. */
	const drafts = new Map<string, string>();
	/** What the owner just decided, shown on the carrier's card for a while so it is never missed. */
	let done: { holder: string | null; text: string; until: number } | null = null;

	/**
	 * A comrade's name, or null when not on the roster.
	 *
	 * @param id Agent id.
	 * @returns Name or null.
	 */
	const nameOf = (id: string | null): string | null => (id ? last?.agents.find((a) => a.id === id)?.name ?? null : null);

	/**
	 * Dossiers carried by a comrade, oldest first.
	 *
	 * @param id Agent id.
	 * @returns Dossiers.
	 */
	const carried = (id: string): OtherApproval[] => all.filter((x) => x.holder === id && !decided.has(x.o.approvalId)).map((x) => x.o);

	/** Redraw the card's list for the comrade whose card is open. */
	const drawSection = (): void => {
		const list = card ? carried(card) : [];
		if (done && Date.now() > done.until) done = null;
		const doneLine = done && done.holder === card ? el('p', 'p67-dossier-done', done.text) : null;
		doneLine?.setAttribute('role', 'status');
		section.hidden = !list.length && !doneLine;
		if (!list.length) { section.replaceChildren(...(doneLine ? [doneLine] : [])); return; }
		const head = el('h3', '', `Dossiers (${list.length})`);
		const ul = el('ul');
		for (const o of list) {
			const filed = dateWords(o.createdAt);
			const b = el('button', 'p67-dossier-pick', `${o.typeLabel}${filed ? `, filed ${filed}` : ''}`);
			b.type = 'button';
			b.dataset.approval = o.approvalId;
			b.addEventListener('click', () => openDossier(o.approvalId));
			const li = el('li');
			li.append(b);
			ul.append(li);
		}
		const hint = el('p', 'p67-dossier-hint', list.length > 1 ? 'Pick one to open it for the board.' : 'Open it to read it and decide.');
		section.replaceChildren(...(doneLine ? [doneLine] : []), head, ul, hint);
	};

	/** Close the window, unless a decision is in flight (then say so). */
	const hide = (): void => {
		if (deciding) { if (waitNote) waitNote.textContent = 'Waiting for Paperclip to answer. The window closes by itself once it does.'; return; }
		// A removed button never hears the pointer let go, so a hold under way must be cancelled here.
		disarm?.();
		win.hidden = true;
		win.replaceChildren();
		showing = null;
		refreshWindow = null;
		disarm = null;
		waitNote = null;
	};

	/**
	 * Who filed a dossier, by Paperclip's own record (the caller can name anyone as requester, but
	 * cannot forge the activity record's actor).
	 *
	 * @param o Dossier.
	 * @param origin The record's creating actor, or null when it could not be read.
	 * @returns Sentence without a full stop.
	 */
	const filedBy = (o: OtherApproval, origin: { actorType: string; actorId: string } | null): string => {
		const named = o.requestedBy ? nameOf(o.requestedBy) ?? 'an agent not on the roster' : null;
		if (!origin) return `Paperclip could not confirm who filed this${named ? `; it names ${named} as the requester` : ''}`;
		const naming = named && o.requestedBy !== origin.actorId ? `, naming ${named} as the requester` : '';
		if (origin.actorType === 'agent') return `Filed by ${nameOf(origin.actorId) ?? 'an agent not on the roster'}${naming}`;
		if (origin.actorType === 'user') return `Filed by a board member${named ? `, naming ${named} as the requester` : ''}`;
		return `Filed by Paperclip itself${named ? `, naming ${named} as the requester` : ''}`;
	};

	/**
	 * Open the window for one dossier.
	 *
	 * @param approvalId Approval id.
	 */
	function openDossier(approvalId: string): void {
		if (deciding) return;
		const entry = all.find((x) => x.o.approvalId === approvalId && !decided.has(approvalId));
		if (!entry) return;
		if (showing) hide();
		const { o } = entry;
		showing = o.approvalId;
		win.replaceChildren();
		const close = el('button', 'p67-close', '×');
		close.type = 'button';
		close.setAttribute('aria-label', 'Close without deciding');
		close.addEventListener('click', hide);
		const shownKey = dossierKey(o);
		const filed = dateWords(o.createdAt);
		const lead = !entry.filer ? nameOf(entry.holder) : null;
		const carrier = lead ? ` ${lead}, the Company Lead, carries it to you.` : '';
		const sub = el('p', 'p67-board-sub', 'Checking with Paperclip who filed this…');
		win.append(close, el('div', 'p67-board-head', 'A DOSSIER FOR THE BOARD'), el('h2', '', o.typeLabel), sub);
		const cid = last?.companyId ?? '';
		void approvalOrigin(d.fetchImpl, cid, o.approvalId).then((origin) => {
			if (showing !== o.approvalId) return;
			setText(sub, `${filedBy(o, origin)}${filed ? `, ${filed}` : ''}.${carrier}`);
		});
		if (!o.known) {
			win.append(el('p', 'p67-warn', `The plant does not know this type of approval ("${o.type}"). Approving it does whatever Paperclip does for this type, which the plant cannot show you.`));
		}
		// The folder: closed until opened, then every field.
		const folder = el('div', 'p67-folder');
		const opener = el('button', 'p67-open-dossier', 'Open the dossier');
		opener.type = 'button';
		folder.append(opener);
		win.append(folder);
		let read = false;

		const lock = el('p', 'p67-lock');
		lock.setAttribute('role', 'status');
		lock.hidden = true;
		const row = el('div', 'p67-stamps p67-three');
		/**
		 * A stamp for one decision.
		 *
		 * @param v The decision.
		 * @returns Stamp.
		 */
		const stamp = (v: DossierVerdict): Stamp => createStamp(DOSSIER_STAMPS[v].word, DOSSIER_STAMPS[v].hint, DOSSIER_STAMPS[v].tone, () => void decide(v));
		const yes = stamp('approved'), no = stamp('refused'), back = stamp('revision');
		row.append(yes.el, no.el, back.el);
		const reason = el('textarea', 'p67-reason');
		reason.setAttribute('aria-label', 'Reason or note');
		reason.placeholder = 'Your reason for refusing, or what to change. It goes back to whoever filed this. Approving sends a standard note instead.';
		reason.rows = 2;
		reason.value = drafts.get(o.approvalId) ?? '';
		reason.addEventListener('keydown', (e) => e.stopPropagation());
		const note = el('p', 'p67-board-note');
		const error = el('p', 'p67-chat-error');
		error.setAttribute('role', 'alert');
		win.append(lock, row, reason, note, error);
		waitNote = note;
		win.hidden = false;

		let busy = false;
		/** Set when Paperclip showed it decided or changed elsewhere: the stamps stay locked. */
		let settled: string | null = null;

		/** Lock or unlock the stamps and say why. */
		const refresh = (): void => {
			const current = all.find((x) => x.o.approvalId === o.approvalId);
			const changed = !!current && dossierKey(current.o) !== shownKey;
			const why = busy ? 'Waiting for Paperclip.'
				: settled ? 'This approval has already been decided or has changed.'
					: !current ? 'This approval is no longer waiting in Paperclip.'
						: changed ? 'This approval changed in Paperclip after you opened it. Close this window and open the dossier again.'
							: o.blocked ? o.blocked
								: !read ? 'Open the dossier first. The stamps unlock once you have.' : '';
			setText(lock, why ? `Locked: ${why}` : '');
			lock.hidden = !why;
			const text = !!reason.value.trim();
			yes.set(!why && !o.cut, why || CUT_WHY);
			no.set(!why && text, why || 'Write the reason first.');
			back.set(!why && text, why || 'Write what to change first.');
			// The note that goes out is the one in the box when the stamp fired.
			reason.readOnly = busy;
			if (!busy) {
				note.textContent = settled ?? (!current ? 'Someone decided it elsewhere, or it was withdrawn. Close this window.'
					: read && o.cut && !why ? CUT_WHY
						: 'Refusing needs a reason; sending it back needs a note saying what to change.');
			}
		};
		reason.addEventListener('input', () => { drafts.set(o.approvalId, reason.value); refresh(); });
		refreshWindow = refresh;
		disarm = () => { for (const st of [yes, no, back]) st.set(false); };
		opener.focus();

		// Opening the folder shows every field and is what unlocks the stamps.
		opener.addEventListener('click', () => {
			read = true;
			const table = el('table', 'p67-strikes p67-fields');
			for (const f of o.fields) {
				const tr = el('tr');
				tr.append(el('td', '', f.label), el('td', '', f.value));
				table.append(tr);
			}
			// Everything below is the filer's own words, so a line like "Filed by" in it proves nothing.
			const parts: HTMLElement[] = o.fields.length ? [el('p', 'p67-fields-head', 'What the filer sent, word for word:'), table] : [el('p', 'p67-board-sub', 'The dossier is empty: Paperclip sent no details with it.')];
			if (o.hiddenFields) parts.push(el('p', 'p67-board-sub', `${o.hiddenFields} more ${o.hiddenFields === 1 ? 'field is' : 'fields are'} not shown here. Read them in the dashboard before deciding.`));
			folder.replaceChildren(...parts);
			refresh();
			// The button that had focus is gone; keep focus in the window so Escape and Tab still work.
			win.focus();
		});

		/**
		 * Show a failure and unlock again, keeping the note.
		 *
		 * @param text Sentence.
		 */
		const failed = (text: string): void => {
			error.textContent = text;
			busy = false; deciding = null; refresh();
		};

		/**
		 * Re-read the approval, then carry out the decision if it still waits.
		 *
		 * @param v The decision.
		 */
		const decide = async (v: DossierVerdict): Promise<void> => {
			const text = reason.value;
			busy = true; deciding = o.approvalId; error.textContent = ''; refresh();
			const st = await readDossier(d.fetchImpl, o.approvalId);
			if (!st) { failed('The plant could not check this approval with Paperclip just now, so nothing was sent. Try again in a moment.'); return; }
			const stale = st.status !== 'pending' ? staleWords(st, d.me?.() ?? null)
				// Still pending, but not what the owner read: resubmitted with a new payload, say.
				: !st.dossier || dossierKey(st.dossier) !== shownKey ? CHANGED : null;
			if (stale) {
				settled = stale;
				if (st.status !== 'pending') decided.add(o.approvalId);
				busy = false; deciding = null;
				refresh();
				drawSection();
				d.onStale?.(o);
				return;
			}
			const r: { ok: true } | Failure = v === 'approved' ? await approve(d.fetchImpl, o.approvalId, DOSSIER_NOTE)
				: v === 'refused' ? await reject(d.fetchImpl, o.approvalId, text)
					: await requestRevision(d.fetchImpl, o.approvalId, text);
			if (!r.ok) {
				const what = v === 'approved' ? 'The approval was not recorded' : v === 'refused' ? 'The refusal was not recorded' : 'The request for changes was not sent';
				failed(v === 'revision' && r.status === 404 ? REVISION_404 : failureWords(r, what));
				return;
			}
			decided.add(o.approvalId);
			drafts.delete(o.approvalId);
			busy = false; deciding = null;
			const filer = entry.filer ? nameOf(entry.holder) : null;
			done = {
				holder: entry.holder,
				text: v === 'approved' ? `Approved: ${o.typeLabel}. Paperclip has your decision.`
					: v === 'refused' ? `Refused: ${o.typeLabel}. Your reason went back to ${filer ?? 'whoever filed it'}.`
						: `Sent back for changes: ${o.typeLabel}. Your note went back to ${filer ?? 'whoever filed it'}.`,
				until: Date.now() + DONE_MS,
			};
			// Only take focus back if it was in this window (it goes with it); never out of the chat box.
			const active = document.activeElement;
			const ours = !active || active === document.body || win.contains(active);
			hide();
			drawSection();
			if (ours) (section.querySelector('button') ?? section).focus?.();
			// Redraw just after the line expires, so it goes without waiting for the next snapshot.
			setTimeout(drawSection, DONE_MS + 50);
			d.onDecided?.(o, v, entry.holder);
		};
		refresh();
	}

	return {
		section,
		el: win,
		get open() { return !win.hidden; },
		get deciding() { return deciding; },
		update(s) {
			last = s;
			const others = s.approvals?.others ?? [];
			all = others.map((o) => { const h = dossierHolder(o, s.agents); return { o, holder: h?.id ?? null, filer: !!h?.filer }; });
			// Forget decisions once Paperclip no longer lists them as pending.
			for (const id of decided) if (!others.some((o) => o.approvalId === id)) decided.delete(id);
			drawSection();
			refreshWindow?.();
		},
		show(agentId) {
			if (agentId !== card && showing && !deciding) hide();
			card = agentId;
			drawSection();
		},
		openDossier,
		hide,
		escape() {
			if (win.hidden) return false;
			hide();
			return true;
		},
		unrouted: () => all.filter((x) => !x.holder && !decided.has(x.o.approvalId)).length,
		carried,
	};
}
