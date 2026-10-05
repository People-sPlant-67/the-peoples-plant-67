/**
 * Pravda on screen: the front page printed when the owner comes back after AWAY_MS or more (on
 * opening the plant, or on returning to a tab left in the background) and there is news, and
 * the paper on the director's desk to read it again (it was a top-bar button).
 *
 * The last visit is remembered per company in the browser. Good snapshots move it on, at most
 * once a minute, but never while a print for the absence is pending or after one failed: the
 * news is not written off until the owner has seen it. While that print is pending or the paper
 * is open, `holding` is true and the cockpit holds the ceremonies, so the replay of departures
 * and arrivals plays after the paper is put down.
 */
import { AWAY_MS, type Feed, type PressContext, gapWords, readFeed, setEdition } from '../live/pravda';
import { failureWords } from '../live/directives';
import { type FetchLike, UUID } from '../live/http';
import type { Snapshot } from '../live/types';
import type { Portrait } from '../art/archetypes';
import { ownerPortrait } from '../world/zones';
import { bitmapCanvas, el, setText } from './dom';
import { readRoster } from './remembered';
import { agoWords, dateWords } from './words';

/** localStorage key for the last visit, per company. */
export const SEEN_KEY = 'plant67.lastSeen';

/** How often the last visit is moved on while the plant is open. */
const SEEN_EVERY_MS = 60_000;

/** The paper's label in the plant: ready, printing, or with news not yet read. */
export const WORDS = {
	ready: 'Pravda: what happened since your last visit',
	printing: 'Pravda: printing…',
	unread: 'Pravda: news you have not read yet',
} as const;

/** On a first visit (no last visit known), the paper covers this far back. */
const FIRST_WINDOW_MS = 24 * 3_600_000;

export interface PravdaDeps {
	fetchImpl: FetchLike;
	/** Issues the owner sent from the plant. */
	sent(): Set<string>;
	/** Clock, injectable for tests. */
	now?: () => number;
	/** Whether the browser tab is hidden. Injectable for tests. */
	isHidden?: () => boolean;
}

export interface Pravda {
	/** The paper, for the cockpit root. */
	el: HTMLElement;
	/** Print the paper now, covering the last absence (the paper on the desk was clicked). */
	read(): void;
	/** What the paper on the desk says about itself: its label in the plant. */
	readonly words: string;
	readonly open: boolean;
	/** True while the paper is open or a print for the absence is on its way: hold the ceremonies. */
	readonly holding: boolean;
	/** The first good snapshot: print if the owner was away long enough. */
	start(s: Snapshot): void;
	/** Every good snapshot: remember this as the last visit (at most once a minute). */
	seen(s: Snapshot): void;
	/** The browser tab was hidden or came back into view. */
	onVisible(): void;
	/**
	 * The owner's portrait and how they are addressed, for the paper's lead.
	 *
	 * @param inside The portrait's inside, or null for the Chairman.
	 * @param caption How the owner is addressed.
	 */
	setOwner(inside: Portrait | null, caption: string): void;
	/** Close the paper if open. Returns true when it was. */
	escape(): boolean;
}

/**
 * The stored last visits, by company.
 *
 * @returns Map of company id to epoch ms (unchecked values).
 */
function readSeen(): Record<string, unknown> {
	try {
		const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null');
		return v && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : {};
	} catch { return {}; }
}

/**
 * Build Pravda.
 *
 * @param d Dependencies.
 * @returns Pravda.
 */
export function createPravda(d: PravdaDeps): Pravda {
	const now = d.now ?? Date.now;
	const isHidden = d.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
	// Read now, before the ceremonies save the first snapshot's roster over it.
	const remembered = readRoster();

	const box = el('div', 'p67-overlay p67-pravda-back');
	box.hidden = true;
	const paper = el('section', 'p67-pravda');
	paper.setAttribute('role', 'dialog');
	paper.setAttribute('aria-modal', 'true');
	paper.setAttribute('aria-label', 'Pravda: what happened while you were away');
	paper.tabIndex = -1;
	const mast = el('div', 'p67-pravda-mast');
	mast.append(el('b', '', 'ПРАВДА'), el('small', '', "Organ of the Board of the People's Plant #67"));
	const dateline = el('div', 'p67-pravda-dateline');
	const edDate = el('span');
	const edSince = el('span');
	dateline.append(edDate, edSince);
	const lead = el('div', 'p67-pravda-lead');
	const figure = el('figure', 'p67-pravda-figure');
	/**
	 * The owner's portrait as a canvas for the lead.
	 *
	 * @param inside Portrait inside, or null for the Chairman.
	 * @returns Canvas.
	 */
	const portraitOf = (inside: Portrait | null): HTMLCanvasElement => {
		const c = bitmapCanvas(ownerPortrait(inside ?? undefined).b, 3);
		c.className = 'p67-pravda-portrait';
		// The caption names it; the pixels add nothing for a screen reader.
		c.setAttribute('aria-hidden', 'true');
		return c;
	};
	let portrait = portraitOf(null);
	const caption = el('figcaption', '', 'The Chairman');
	figure.append(portrait, caption);
	const leadText = el('div');
	const leadHead = el('h2');
	const leadBody = el('p');
	leadText.append(leadHead, leadBody);
	lead.append(figure, leadText);
	const briefs = el('div', 'p67-pravda-briefs');
	const inBrief = el('p', 'p67-pravda-inbrief');
	const note = el('p', 'p67-pravda-note');
	const foot = el('div', 'p67-pravda-foot');
	const close = el('button', 'p67-pravda-close', 'Close the paper');
	close.type = 'button';
	foot.append(el('span', '', 'The editors print only what Paperclip recorded.'), close);
	paper.append(mast, dateline, lead, briefs, inBrief, note, foot);
	box.append(paper);
	/** The paper's state, for its label. */
	let words: string = WORDS.ready;

	let companyId: string | null = null;
	/** The last visit the paper covers from: set on opening, and again on each return. */
	let since: number | null = null;
	let names = new Map<string, string>();
	let last: Snapshot | null = null;
	let savedAt = 0;
	/** A print for the absence is on its way. */
	let pending = false;
	/** The print for the absence failed: keep the last visit where it was. */
	let unread = false;
	let printing = false;
	// A tab opened in the background counts as hidden from the start.
	let hiddenAt: number | null = isHidden() ? now() : null;
	let restoreFocus: HTMLElement | null = null;

	/**
	 * The stored last visit for the company, if it is a believable time.
	 *
	 * @returns Epoch ms or null.
	 */
	const storedSeen = (): number | null => {
		const at = companyId ? readSeen()[companyId] : null;
		return typeof at === 'number' && at > 0 && at <= now() ? at : null;
	};

	/**
	 * The plant as it stands, for the paper.
	 *
	 * @returns Context.
	 */
	const context = (): PressContext => {
		const s = last;
		return {
			nameOf: (id) => s?.agents.find((a) => a.id === id)?.name ?? names.get(id) ?? null,
			statusOf: (id) => s?.agents.find((a) => a.id === id)?.status ?? null,
			sent: d.sent(),
			inError: (s?.agents ?? []).filter((a) => a.status === 'error').map((a) => a.name),
			dossiers: s?.approvals?.others.length ?? 0,
			tribunals: s?.approvals?.tribunals.length ?? 0,
			hires: s?.approvals?.hires.length ?? 0,
		};
	};

	/**
	 * Words for a moment.
	 *
	 * @param ms Epoch ms.
	 * @returns "28 Sept, 14:02".
	 */
	const when = (ms: number): string => dateWords(new Date(ms).toISOString()) ?? 'an earlier date';

	/**
	 * Show the paper.
	 *
	 * @param from Epoch ms the paper covers from.
	 * @param feed The feed, or null when it could not be read.
	 * @param failed The failure sentence, when the feed could not be read.
	 */
	const show = (from: number, feed: Feed | null, failed = ''): void => {
		const e = feed ? setEdition(feed, context()) : null;
		const t = new Date(now());
		const part = t.getHours() < 12 ? 'Morning' : t.getHours() < 18 ? 'Afternoon' : 'Evening';
		setText(edDate, `${t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${part} edition`);
		const ago = agoWords(new Date(from).toISOString(), now()).replace(/\.$/, '');
		setText(edSince, `Since ${when(from)} (${ago.charAt(0).toLowerCase()}${ago.slice(1)})`);
		setText(leadHead, failed ? 'The presses have stopped' : e?.lead.head ?? 'A quiet shift at the plant');
		setText(leadBody, failed || (e?.lead.body ?? 'Nothing worth printing has happened since then.'));
		briefs.replaceChildren();
		for (const b of e?.briefs ?? []) {
			const s = el('div');
			s.append(el('h3', '', b.head), el('p', '', b.body));
			briefs.append(s);
		}
		briefs.hidden = !e?.briefs.length;
		setText(inBrief, e?.inBrief ? `In brief: ${e.inBrief}` : '');
		inBrief.hidden = !e?.inBrief;
		const gap = feed ? gapWords(feed, when) : '';
		setText(note, gap);
		note.hidden = !gap;
		if (box.hidden) restoreFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
		box.hidden = false;
		paper.focus();
	};

	/**
	 * Read the feed and print.
	 *
	 * @param from Epoch ms to cover from.
	 * @param onDemand On demand (the paper on the desk): always show something. For an absence: only when there is news.
	 */
	const print = async (from: number, onDemand: boolean): Promise<void> => {
		if (!companyId || printing) return;
		printing = true;
		words = WORDS.printing;
		let r: Awaited<ReturnType<typeof readFeed>>;
		try {
			r = await readFeed(d.fetchImpl, companyId, from);
		} catch {
			r = { ok: false, session: 'unreachable', status: 0, detail: null };
		}
		printing = false;
		if (!onDemand) pending = false;
		if (!r.ok) {
			// The news is still owed: the label says so and the paper covers the whole absence.
			if (!onDemand) unread = true;
			words = unread ? WORDS.unread : WORDS.ready;
			if (onDemand) show(from, null, failureWords(r, 'Pravda could not be printed'));
			return;
		}
		unread = false;
		words = WORDS.ready;
		if (onDemand || setEdition(r.feed, context())) show(from, r.feed);
	};

	/**
	 * Print for an absence that started at the stored last visit, if it was long enough.
	 */
	const printForAbsence = (): void => {
		const at = storedSeen();
		if (at === null || now() - at < AWAY_MS || printing) return;
		since = at;
		pending = true;
		void print(at, false);
	};

	/** Close the paper. */
	const hide = (): void => {
		if (box.hidden) return;
		box.hidden = true;
		restoreFocus?.focus();
	};
	close.addEventListener('click', hide);
	box.addEventListener('click', (e) => { if (e.target === box) hide(); });
	paper.addEventListener('keydown', (e) => {
		// Keys stay in the paper: the cockpit's own keys would pan the plant behind it.
		e.stopPropagation();
		if (e.key === 'Escape') { hide(); return; }
		// A modal: Tab moves between the paper and its close button only.
		if (e.key === 'Tab') {
			e.preventDefault();
			(document.activeElement === close ? paper : close).focus();
		}
	});
	/** Print the paper on demand. */
	const read = (): void => {
		if (!companyId) return;
		void print(since ?? now() - FIRST_WINDOW_MS, true);
	};

	return {
		el: box,
		read,
		setOwner(inside, words) {
			const next = portraitOf(inside);
			portrait.replaceWith(next);
			portrait = next;
			setText(caption, words);
		},
		get words() { return words; },
		get open() { return !box.hidden; },
		get holding() { return !box.hidden || pending; },
		start(s) {
			if (s.session !== 'ok' || !s.companyId || !UUID.test(s.companyId)) return;
			companyId = s.companyId;
			last = s;
			if (remembered && remembered.companyId === s.companyId) names = new Map(remembered.agents.map((k) => [k.id, k.name]));
			since = storedSeen();
			printForAbsence();
		},
		seen(s) {
			if (s.session !== 'ok' || !s.companyId || s.companyId !== companyId) return;
			last = s;
			if (pending || unread || now() - savedAt < SEEN_EVERY_MS) return;
			savedAt = now();
			const map = readSeen();
			map[s.companyId] = now();
			try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch { /* The next visit prints nothing: no harm. */ }
		},
		onVisible() {
			if (isHidden()) { hiddenAt ??= now(); return; }
			const away = hiddenAt !== null && now() - hiddenAt >= AWAY_MS;
			hiddenAt = null;
			// The poller skips a hidden tab, so the stored last visit is still from before it was hidden.
			// Not over a paper still unread: that one covers from further back.
			if (away && companyId && !pending && box.hidden) printForAbsence();
		},
		escape() {
			if (box.hidden) return false;
			hide();
			return true;
		},
	};
}
