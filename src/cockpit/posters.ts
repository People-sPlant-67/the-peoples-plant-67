/**
 * The posters: what waits on the owner, pinned in the top-left corner, one poster per
 * kind with a count: a tribunal, a hire at the desk, a dossier, a question from a comrade. A kind
 * that newly appears unrolls as a big ВНИМАНИЕ poster first (with a paper rustle), then sits in the
 * stack. Clicking a poster goes to the first case and opens it; clicking again moves to the next.
 * A poster goes when nothing of its kind waits.
 */
import { el, setText } from './dom';

export type PosterKind = 'tribunal' | 'hire' | 'dossier' | 'question';

/** Most important first: the stack's order. */
export const POSTER_ORDER: readonly PosterKind[] = ['tribunal', 'hire', 'dossier', 'question'];
/** Each kind's heading, in the plant's Russian. */
export const POSTER_TITLES: Record<PosterKind, string> = { tribunal: 'ТРИБУНАЛ', hire: 'КАДРЫ', dossier: 'ДОСЬЕ', question: 'ВОПРОС' };
/** How long a new poster stays unrolled before it joins the stack (ms). */
export const UNROLL_MS = 4000;
/** For this long after the first update, arrivals are what was already waiting: pinned without unrolling (ms). */
export const SETTLE_MS = 6000;

/** What waits, as the cockpit counts it. */
export interface Waiting {
	/** Tribunals awaiting a verdict, and whether one of them is a guilty verdict left unfinished. */
	tribunals: number;
	unfinished: boolean;
	/** Newcomers waiting at the desk to be hired. */
	hires: number;
	/** Dossiers a comrade carries, and approvals nobody on the roster can carry. */
	dossiers: number;
	stray: number;
	/** Questions from comrades, and who asked when only one comrade has. */
	questions: number;
	askedBy: string | null;
}

/** One poster's content. */
export interface Poster {
	kind: PosterKind;
	title: string;
	count: number;
	/** A sentence saying what waits. */
	text: string;
	/** False when there is nowhere in the plant to go for it (approvals nobody carries). */
	goes: boolean;
}

/**
 * "1 thing" or "3 things".
 *
 * @param n Count.
 * @param one Singular.
 * @param many Plural.
 * @returns Words.
 */
const count = (n: number, one: string, many: string): string => (n === 1 ? one : `${n} ${many}`);

/**
 * The posters for what waits, in order. Kinds with nothing waiting get none.
 *
 * @param w What waits.
 * @returns Posters.
 */
export function postersFor(w: Waiting): Poster[] {
	const out: Poster[] = [];
	if (w.tribunals > 0) {
		out.push({ kind: 'tribunal', title: POSTER_TITLES.tribunal, count: w.tribunals, goes: true, text: w.unfinished ? 'A guilty verdict needs finishing.' : `${count(w.tribunals, 'A tribunal awaits', 'tribunals await')} your verdict.` });
	}
	if (w.hires > 0) {
		out.push({ kind: 'hire', title: POSTER_TITLES.hire, count: w.hires, goes: true, text: `${count(w.hires, 'A new comrade waits', 'new comrades wait')} at the desk to be hired.` });
	}
	if (w.dossiers > 0 || w.stray > 0) {
		const stray = w.stray === 0 ? ''
			: w.dossiers === 0
				? `${count(w.stray, 'An approval has', 'approvals have')} nobody on the roster to carry ${w.stray === 1 ? 'it' : 'them'}; decide ${w.stray === 1 ? 'it' : 'them'} in Paperclip.`
				: ` ${w.stray === 1 ? 'One more has' : `${w.stray} more have`} nobody to carry ${w.stray === 1 ? 'it' : 'them'}; decide ${w.stray === 1 ? 'it' : 'them'} in Paperclip.`;
		const carried = w.dossiers === 0 ? '' : `${count(w.dossiers, 'A dossier awaits', 'dossiers await')} your stamp.`;
		out.push({ kind: 'dossier', title: POSTER_TITLES.dossier, count: w.dossiers + w.stray, goes: w.dossiers > 0, text: carried + stray });
	}
	if (w.questions > 0) {
		const text = w.askedBy
			? `${w.askedBy} has ${w.questions === 1 ? 'a question' : `${w.questions} questions`} for you.`
			: `${count(w.questions, 'A question awaits', 'questions await')} your answer.`;
		out.push({ kind: 'question', title: POSTER_TITLES.question, count: w.questions, goes: true, text });
	}
	return out;
}

export interface PosterDeps {
	/**
	 * Go to a case of a kind and open it.
	 *
	 * @param kind Kind.
	 * @param k Which case, counting from 0 (wraps).
	 */
	go(kind: PosterKind, k: number): void;
	/** A new poster unrolls: the paper rustle. */
	rustle(): void;
}

export interface Posters {
	/** The stack, for the cockpit root. */
	el: HTMLElement;
	/**
	 * Show what waits now. For SETTLE_MS after the first call, arrivals are pinned without
	 * unrolling: they were already waiting when the plant opened.
	 *
	 * @param list Posters, in order.
	 * @param quiet Kinds whose arrival now is not news either (their first count was only just read).
	 */
	update(list: Poster[], quiet?: PosterKind[]): void;
	/** Let time pass: an unrolled poster joins the stack after UNROLL_MS. */
	tick(dt: number): void;
	/** The kind unrolled now, or null. */
	readonly unrolled: PosterKind | null;
	/** The pinned poster for a kind (scripted checks). */
	poster(kind: PosterKind): HTMLButtonElement | null;
}

/**
 * Build the posters.
 *
 * @param d Dependencies.
 * @returns Posters.
 */
export function createPosters(d: PosterDeps): Posters {
	const stack = el('section', 'p67-posters');
	stack.setAttribute('aria-label', 'Waiting for you');
	// The big poster, unrolled above the stack while a new kind arrives.
	const herald = el('button', 'p67-poster p67-herald');
	herald.type = 'button';
	herald.hidden = true;
	const heraldRays = el('span', 'p67-herald-rays', '★');
	heraldRays.setAttribute('aria-hidden', 'true');
	const heraldHead = el('span', 'p67-poster-head p67-herald-head', 'ВНИМАНИЕ');
	const heraldText = el('span', 'p67-poster-text');
	const heraldHint = el('span', 'p67-herald-hint', 'Click to go there.');
	herald.append(heraldRays, heraldHead, heraldText, heraldHint);
	// Read aloud when a poster arrives; the posters themselves are buttons with their own words.
	const said = el('p', 'p67-sr');
	said.setAttribute('aria-live', 'polite');
	const pinned = el('div', 'p67-poster-stack');
	stack.append(herald, pinned, said);

	const shown = new Map<PosterKind, { b: HTMLButtonElement; head: HTMLElement; n: HTMLElement; text: HTMLElement; next: number; p: Poster }>();
	/** Time since the first update (ms), or null before it. */
	let age: number | null = null;
	let unrolled: PosterKind | null = null;
	let unrolledFor = 0;

	/**
	 * Go to the next case of a kind.
	 *
	 * @param kind Kind.
	 */
	const go = (kind: PosterKind): void => {
		const s = shown.get(kind);
		if (!s || !s.p.goes) return;
		const k = s.next % s.p.count;
		s.next = k + 1;
		d.go(kind, k);
	};
	herald.addEventListener('click', () => { if (unrolled) { const k = unrolled; roll(); go(k); } });

	/** Put the unrolled poster away. */
	const roll = (): void => {
		unrolled = null;
		herald.hidden = true;
	};

	return {
		el: stack,
		update(list, quiet = []) {
			age ??= 0;
			const settling = age < SETTLE_MS;
			const kinds = new Set(list.map((p) => p.kind));
			for (const [kind, s] of shown) if (!kinds.has(kind)) { s.b.remove(); shown.delete(kind); }
			if (unrolled && !kinds.has(unrolled)) roll();
			const arrived: Poster[] = [];
			for (const p of list) {
				let s = shown.get(p.kind);
				if (!s) {
					const b = el('button', `p67-poster p67-poster-${p.kind}`);
					b.type = 'button';
					const head = el('span', 'p67-poster-head');
					const star = el('i', '', '★');
					star.setAttribute('aria-hidden', 'true');
					const n = el('em');
					head.append(star, document.createTextNode(` ${p.title} `), n);
					const text = el('span', 'p67-poster-text');
					b.append(head, text);
					b.addEventListener('click', () => go(p.kind));
					s = { b, head, n, text, next: 0, p };
					shown.set(p.kind, s);
					if (!settling && !quiet.includes(p.kind)) arrived.push(p);
				}
				s.p = p;
				if (s.next >= p.count) s.next = 0;
				setText(s.n, String(p.count));
				setText(s.text, p.text);
				s.b.setAttribute('aria-label', `${p.text}${p.goes ? ' Go there.' : ''}`);
				s.b.classList.toggle('p67-poster-still', !p.goes);
			}
			// The stack in order, whatever order the kinds arrived in.
			// Only when it changed: putting a focused poster back would lose the focus.
			const order = POSTER_ORDER.flatMap((k) => (shown.get(k) ? [shown.get(k)!.b] : []));
			if (order.length !== pinned.children.length || order.some((b, i) => pinned.children[i] !== b)) pinned.replaceChildren(...order);
			if (arrived.length) {
				const p = arrived[0];
				unrolled = p.kind;
				unrolledFor = 0;
				setText(heraldText, p.text);
				// Approvals nobody carries have nowhere in the plant to go: no promise to take you there.
				heraldHint.hidden = !p.goes;
				herald.setAttribute('aria-label', `${p.text}${p.goes ? ' Go there.' : ''}`);
				herald.hidden = false;
				// Restart the unrolling, even when the herald was already showing another.
				herald.classList.remove('p67-herald-in');
				void herald.offsetWidth;
				herald.classList.add('p67-herald-in');
				setText(said, arrived.map((a) => a.text).join(' '));
				d.rustle();
			}
		},
		tick(dt) {
			if (age !== null) age += dt;
			if (!unrolled) return;
			unrolledFor += dt;
			if (unrolledFor >= UNROLL_MS) roll();
		},
		get unrolled() { return unrolled; },
		poster: (kind) => shown.get(kind)?.b ?? null,
	};
}
