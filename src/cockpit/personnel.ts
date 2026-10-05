/**
 * The Personnel File tab on the name card: the comrade's record, their recent shifts, and four
 * press-and-hold board stamps (pause, resume, wake, clear error).
 *
 * The record is read when the tab shows and every REFRESH_MS while it stays open; nothing is
 * read while the card or the tab is closed, or while the browser tab is hidden. Only the newest
 * read is drawn, so a slow answer never paints over a fresher one. Which stamps are live follows
 * the roster status the plant already polls, and each stamp checks Paperclip again before it acts
 * (see boardAct). While one stamp is in flight all four are locked, so a second hold cannot race
 * it; after one works they stay locked until the roster shows the change (at most SETTLE_MS), so
 * a stale status cannot offer the same stamp again.
 */
import type { FetchLike } from '../live/http';
import { type ActResult, BOARD_ACTIONS, type BoardAction, type PersonnelFile, type Shift, boardAct, isOwnSeat, readPersonnel, stampRules } from '../live/personnel';
import { failureWords } from '../live/directives';
import type { AgentState } from '../live/types';
import { row } from './card';
import { el, setText } from './dom';
import { type Stamp, createStamp } from './stamp';
import { agoWords, dateWords, dollars } from './words';

/** Each stamp's plain name, for the line saying why it is locked. */
const PLAIN: Record<BoardAction, string> = { pause: 'Pause', resume: 'Resume', wake: 'Wake', clear: 'Clear error' };

/** How often an open Personnel File is read again. */
export const REFRESH_MS = 10_000;

/** Longest the stamps wait, after one worked, for the roster to show the change. */
export const SETTLE_MS = 30_000;

/** How long a stamp's result sentence stays on the file. */
export const RESULT_MS = 60_000;

/** Each stamp's word, the line under it, and its ink. The cockpit drops the same word over the comrade. */
export const BOARD_STAMPS: Record<BoardAction, { word: string; hint: string; tone: 'green' | 'amber' }> = {
	pause: { word: 'ПАУЗА', hint: 'Hold to pause. It stops any shift in progress.', tone: 'amber' },
	resume: { word: 'ВПЕРЁД', hint: 'Hold to resume.', tone: 'green' },
	wake: { word: 'ПОДЪЁМ', hint: 'Hold to wake them now.', tone: 'green' },
	clear: { word: 'ИСПРАВЛЕНО', hint: 'Hold to clear the error.', tone: 'amber' },
};

export interface PersonnelDeps {
	fetchImpl: FetchLike;
	companyId: () => string | null;
	/** A roster name for an agent id, or null when they are not on the roster. */
	nameOf: (id: string) => string | null;
	/** A stamp worked on this comrade. */
	onActed?(agentId: string, action: BoardAction): void;
	/** Clock, injectable for tests. */
	now?: () => number;
	/** Whether the browser tab is hidden; reads are skipped then. Injectable for tests. */
	isHidden?: () => boolean;
}

export interface Personnel {
	el: HTMLElement;
	/** The comrade whose card is open, and whether this tab is the one showing. */
	show(agent: AgentState | null, visible: boolean): void;
	/** A fresh roster entry for the comrade shown (or undefined when they left). */
	update(agent: AgentState | undefined): void;
	/** True while a stamp is being applied. */
	readonly busy: boolean;
}

/**
 * The budget line.
 *
 * @param f File.
 * @returns Words, and the share spent (0 to 1) when there is a budget, else null.
 */
export function budgetWords(f: PersonnelFile): { words: string; share: number | null } {
	const spent = f.spentMonthlyCents;
	if (spent === null) return { words: f.budgetMonthlyCents ? `Paperclip did not say what they have spent of ${dollars(f.budgetMonthlyCents)} this month.` : 'Paperclip did not say what they have spent this month.', share: null };
	if (!f.budgetMonthlyCents) return { words: `${dollars(spent)} spent this month, with no monthly budget set.`, share: null };
	const over = spent > f.budgetMonthlyCents ? ', which is over budget' : '';
	return { words: `${dollars(spent)} of ${dollars(f.budgetMonthlyCents)} this month${over}.`, share: Math.min(1, spent / f.budgetMonthlyCents) };
}

/**
 * A shift's status in words, and whether it went wrong.
 *
 * @param s Shift.
 * @returns Words and tone.
 */
export function shiftWords(s: Shift): { words: string; bad: boolean } {
	switch (s.status) {
		case 'succeeded': return { words: 'Finished', bad: false };
		case 'running': return { words: 'On shift now', bad: false };
		case 'queued': return { words: 'Waiting to start', bad: false };
		case 'failed': return { words: s.error ? `Failed: ${s.error}` : 'Failed', bad: true };
		case 'timed_out': return { words: 'Timed out', bad: true };
		case 'cancelled': return { words: 'Cancelled', bad: false };
		case 'interrupted': return { words: 'Interrupted', bad: true };
		default: return { words: `"${s.status}"`, bad: false };
	}
}

/**
 * How long a shift lasted, or has lasted so far.
 *
 * @param s Shift.
 * @param now Now, epoch ms.
 * @returns "6 min", "1 h 5 min", or "" when unknown.
 */
export function shiftLength(s: Shift, now: number): string {
	const a = s.startedAt ? Date.parse(s.startedAt) : NaN;
	const b = s.finishedAt ? Date.parse(s.finishedAt) : s.status === 'running' ? now : NaN;
	if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '';
	const min = Math.round((b - a) / 60_000);
	if (min < 1) return 'under 1 min';
	return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * Build the Personnel File pane.
 *
 * @param d Dependencies.
 * @returns Personnel.
 */
export function createPersonnel(d: PersonnelDeps): Personnel {
	const now = d.now ?? Date.now;
	const isHidden = d.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
	const box = el('div', 'p67-file');
	// The card is a polite live region; this pane refreshes every few seconds and must not be
	// read out each time. Only the result line (role=status) speaks.
	box.setAttribute('aria-live', 'off');
	const loading = el('p', 'p67-file-note');
	const record = el('div');
	const reports = row('Reports to');
	const beat = row('Last heartbeat');
	const since = row('Paused since');
	const budget = row('Budget');
	const bar = el('div', 'p67-budget-bar');
	const fill = el('span');
	bar.append(fill);
	record.append(reports.row, beat.row, since.row, budget.row, bar);
	const shiftsHead = el('h3', '', 'Recent shifts');
	const shifts = el('ul', 'p67-shifts');
	const stampsHead = el('h3', '', 'Board stamps');
	const papers = el('div', 'p67-file-papers');
	const warn = el('p', 'p67-file-warn', 'They are on a shift now. ПАУЗА stops that shift.');
	const row1 = el('div', 'p67-stamps p67-two');
	const row2 = el('div', 'p67-stamps p67-two');
	const why = el('p', 'p67-file-why');
	const result = el('p', 'p67-file-result');
	result.setAttribute('role', 'status');
	// Focus moves here when a stamp fires, because the stamp itself is disabled while it acts.
	result.tabIndex = -1;
	papers.append(warn, row1, row2, why);
	// The stamps come before the shift list: they are what the owner came to the tab for.
	box.append(loading, record, stampsHead, papers, result, shiftsHead, shifts);

	let agent: AgentState | null = null;
	let visible = false;
	/** The comrade a stamp is acting on right now, or null. */
	let acting: { id: string; name: string } | null = null;
	/** After a stamp worked: stay locked while the roster still shows this status. */
	let settling: { id: string; status: string; until: number } | null = null;
	/** Bumped for every read and on a change of comrade; only the newest read is drawn. */
	let seq = 0;
	let timer: ReturnType<typeof setInterval> | undefined;
	let resultTimer: ReturnType<typeof setTimeout> | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	let lastFile: PersonnelFile | null = null;
	let shiftsKey = '';

	const stamps = {} as Record<BoardAction, Stamp>;
	for (const a of BOARD_ACTIONS) {
		const s = BOARD_STAMPS[a];
		stamps[a] = createStamp(s.word, s.hint, s.tone, () => void act(a));
		(a === 'pause' || a === 'resume' ? row1 : row2).append(stamps[a].el);
	}

	/**
	 * Lock or unlock the stamps from the comrade's roster status, and say why any are locked.
	 */
	const paintStamps = (): void => {
		if (!agent) return;
		// The settle lock belongs to the comrade stamped; it survives looking at someone else, and
		// ends when their status moves on or SETTLE_MS passes.
		if (settling && (settling.until <= now() || (settling.id === agent.id && settling.status !== agent.status))) settling = null;
		const hold = acting
			? acting.id === agent.id ? 'Applying the stamp…' : `A stamp on ${acting.name} is still being applied.`
			: settling?.id === agent.id ? 'Waiting for Paperclip to show the change.' : null;
		const rules = stampRules(agent);
		for (const a of BOARD_ACTIONS) {
			const off = hold ?? rules[a];
			stamps[a].set(off === null, off ?? undefined);
		}
		warn.hidden = agent.status !== 'running' || rules.pause !== null;
		if (hold) { setText(why, hold); return; }
		const locked = BOARD_ACTIONS.filter((a) => rules[a] !== null);
		// One reason covering all four (the seat, a terminated comrade) is said once; otherwise
		// each locked stamp is named with its own reason.
		setText(why, locked.length === 4 && new Set(locked.map((a) => rules[a])).size === 1
			? rules.pause ?? ''
			: locked.map((a) => { const w = rules[a] ?? ''; return `${PLAIN[a]}: ${w.charAt(0).toLowerCase()}${w.slice(1)}`; }).join(' '));
	};

	/**
	 * Draw the record.
	 *
	 * @param f File.
	 */
	const paintFile = (f: PersonnelFile): void => {
		record.hidden = false;
		// The owner's own seat is the owner: no shift log or budget on show, just who they answer to.
		const seat = !!agent && isOwnSeat(agent);
		budget.row.hidden = seat;
		shiftsHead.hidden = seat;
		shifts.hidden = seat;
		const boss = f.reportsTo ? d.nameOf(f.reportsTo) : null;
		setText(reports.value, !f.reportsTo ? 'Nobody: they answer to the board.' : boss ? `${boss}.` : 'Someone who is not on the roster.');
		setText(beat.value, agoWords(f.lastHeartbeatAt, now()));
		since.row.hidden = !(agent?.status === 'paused' && f.pausedAt);
		setText(since.value, dateWords(f.pausedAt) ? `${dateWords(f.pausedAt)}.` : '');
		const b = budgetWords(f);
		setText(budget.value, b.words);
		bar.hidden = seat || b.share === null;
		fill.style.width = `${Math.round((b.share ?? 0) * 100)}%`;
		fill.classList.toggle('p67-over', (b.share ?? 0) >= 0.9);
		// Rebuild the list only when it changed, so a refresh never wipes a selection.
		const key = JSON.stringify(f.shifts) + (f.shifts?.some((s) => s.status === 'running') ? Math.floor(now() / 60_000) : '');
		if (key === shiftsKey) return;
		shiftsKey = key;
		shifts.replaceChildren();
		if (!f.shifts) shifts.append(el('li', 'p67-file-note', 'The plant could not read their recent shifts.'));
		else if (!f.shifts.length) shifts.append(el('li', 'p67-file-note', 'No shifts on record yet.'));
		for (const s of f.shifts ?? []) {
			const w = shiftWords(s);
			const li = el('li');
			li.append(
				el('span', 'p67-shift-when', dateWords(s.startedAt) ?? 'Not started'),
				el('span', w.bad ? 'p67-shift-bad' : 'p67-shift-ok', w.words),
				el('span', 'p67-shift-len', shiftLength(s, now())),
			);
			shifts.append(li);
		}
	};

	/**
	 * Read the file for the comrade shown, if the tab is showing and the browser tab is not hidden.
	 */
	const load = async (): Promise<void> => {
		const cid = d.companyId();
		if (!agent || !visible || !cid || isHidden()) return;
		const mine = ++seq;
		const r = await readPersonnel(d.fetchImpl, cid, agent.id);
		if (mine !== seq) return;
		if (!r.ok) {
			// Keep the last good record on screen; say it may be out of date.
			setText(loading, failureWords(r, lastFile ? 'The plant could not refresh this file' : 'The plant could not read this file'));
			loading.hidden = false;
			return;
		}
		loading.hidden = true;
		lastFile = r.file;
		paintFile(r.file);
	};

	/** Start or stop the refresh, depending on whether a comrade is showing. */
	const schedule = (): void => {
		clearInterval(timer);
		timer = undefined;
		if (agent && visible) {
			void load();
			timer = setInterval(() => void load(), REFRESH_MS);
		}
	};
	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!isHidden()) void load(); });

	/**
	 * Show a stamp's result, for RESULT_MS.
	 *
	 * @param r Result.
	 */
	const say = (r: ActResult): void => {
		// Cleared first, so the same sentence twice is still announced.
		setText(result, '');
		setText(result, r.words);
		result.className = `p67-file-result ${r.ok ? 'p67-file-ok' : 'p67-file-fail'}`;
		clearTimeout(resultTimer);
		resultTimer = setTimeout(() => setText(result, ''), RESULT_MS);
	};

	/**
	 * Apply a stamp.
	 *
	 * @param a The stamp.
	 */
	async function act(a: BoardAction): Promise<void> {
		if (!agent || acting) return;
		const { id, name, status } = agent;
		// The stamp is about to be disabled, which would drop focus to the page: keep it in the file.
		if (box.contains(document.activeElement)) result.focus();
		acting = { id, name };
		paintStamps();
		let r: ActResult;
		try {
			r = await boardAct(d.fetchImpl, id, a);
		} catch {
			r = { ok: false, words: 'Nothing changed, because something went wrong in the plant.' };
		}
		acting = null;
		if (r.ok) {
			settling = { id, status, until: now() + SETTLE_MS };
			clearTimeout(settleTimer);
			settleTimer = setTimeout(paintStamps, SETTLE_MS);
			d.onActed?.(id, a);
		}
		// Whoever is shown now gets their stamps back, even if the owner moved on meanwhile.
		paintStamps();
		// The result belongs to the comrade it acted on: another comrade's file does not get it.
		if (agent?.id !== id) return;
		say(r);
		void load();
	}

	return {
		el: box,
		get busy() { return acting !== null; },
		show(next, vis) {
			const changed = (next?.id ?? null) !== (agent?.id ?? null);
			agent = next;
			visible = vis && next !== null;
			if (changed) {
				seq++;
				lastFile = null;
				shiftsKey = '';
				clearTimeout(resultTimer);
				setText(result, '');
				setText(loading, 'Reading the file from Paperclip…');
				loading.hidden = false;
				record.hidden = true;
				since.row.hidden = true;
				bar.hidden = true;
				shifts.replaceChildren();
				// A hold begun on the last comrade must not land on this one.
				for (const a of BOARD_ACTIONS) stamps[a].set(false);
			}
			paintStamps();
			schedule();
		},
		update(next) {
			if (!agent) return;
			if (!next || next.id !== agent.id) return;
			const was = agent.status;
			agent = next;
			paintStamps();
			// A status change (a stamp here, or anyone elsewhere) is worth an early re-read.
			if (was !== next.status && visible) void load();
		},
	};
}
