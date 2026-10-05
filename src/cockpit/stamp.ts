/**
 * A press-and-hold rubber stamp: a button that only fires after being held for HOLD_MS, with a
 * bar filling underneath. Letting go early (pointer or key) cancels it, so a stray click never
 * terminates anyone. Space or Enter held on the focused stamp works the same way.
 *
 * A fired stamp also dispatches a bubbling STAMP_EVENT, so the cockpit can make the thud
 * without every window knowing about sound.
 */

/** Event a stamp dispatches (bubbling) when its hold completes. */
export const STAMP_EVENT = 'p67-stamp';

/** How long a stamp must be held down. */
export const HOLD_MS = 1_000;

export interface Stamp {
	el: HTMLButtonElement;
	/** Enable or disable, with a sentence saying why it is disabled. */
	set(enabled: boolean, why?: string): void;
}

/**
 * Build a stamp.
 *
 * @param word The stamp's word, e.g. ВИНОВЕН.
 * @param hint The line under it, e.g. "Guilty: hold to terminate".
 * @param tone Red, green or amber ink.
 * @param onFire Called once the hold completes.
 * @param now Clock, injectable for tests.
 * @returns Stamp.
 */
export function createStamp(word: string, hint: string, tone: 'red' | 'green' | 'amber', onFire: () => void, now: () => number = () => performance.now()): Stamp {
	const el = document.createElement('button');
	el.type = 'button';
	el.className = `p67-stamp p67-${tone}`;
	const w = document.createElement('span');
	w.className = 'p67-stamp-word';
	w.textContent = word;
	const h = document.createElement('small');
	h.textContent = hint;
	const bar = document.createElement('span');
	bar.className = 'p67-hold';
	el.append(w, h, bar);
	el.setAttribute('aria-label', `${word}. ${hint}.`);
	let start: number | null = null;
	let raf = 0;

	/** Stop holding without firing. */
	const cancel = (): void => {
		start = null;
		cancelAnimationFrame(raf);
		bar.style.width = '0';
	};
	/** Fill the bar and fire when full. */
	const frame = (): void => {
		if (start === null) return;
		const k = Math.min(1, (now() - start) / HOLD_MS);
		bar.style.width = `${Math.round(k * 100)}%`;
		if (k < 1) { raf = requestAnimationFrame(frame); return; }
		cancel();
		el.classList.add('p67-slam');
		setTimeout(() => el.classList.remove('p67-slam'), 400);
		onFire();
		// After the decision, and guarded: a sound must never stand in the way of a stamp.
		try {
			const Ev = el.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
			el.dispatchEvent(new Ev(STAMP_EVENT, { bubbles: true }));
		} catch { /* No thud, nothing else lost. */ }
	};
	/** Start holding. */
	const begin = (): void => {
		if (el.disabled || start !== null) return;
		start = now();
		raf = requestAnimationFrame(frame);
	};

	el.addEventListener('pointerdown', (e) => { if (e.button === 0) { e.preventDefault(); begin(); } });
	for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) el.addEventListener(ev, cancel);
	el.addEventListener('keydown', (e) => {
		if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); }
		e.stopPropagation();
	});
	el.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') cancel(); });
	// A plain click does nothing: only a completed hold counts.
	el.addEventListener('click', (e) => e.preventDefault());

	return {
		el,
		set(enabled, why) {
			el.disabled = !enabled;
			el.title = enabled ? '' : why ?? '';
			if (!enabled) cancel();
		},
	};
}
