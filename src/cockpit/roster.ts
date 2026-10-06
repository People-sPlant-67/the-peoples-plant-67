/**
 * Roster strip: one COMRADES chip that folds the rest away. It shows how many comrades there
 * are, how many need the owner and how many have replied, so folding hides nothing urgent.
 * Clicking it fans out one chip per comrade (with a status colour) and clicking it again draws
 * them back in. Clicking a comrade's chip glides the camera to them and opens their card.
 * Names come from Paperclip, so they are set with textContent only.
 */
import type { Comrade } from './crew';
import { comradeWords, statusColour } from './status';
import type { Host } from './host';

/** Delay between one chip and the next as they fan out (ms). */
export const FAN_STEP_MS = 30;
/** The most the whole fan's stagger may take, however big the roster (ms). */
export const FAN_MAX_MS = 300;
/** How long one chip takes to fly out or back (ms). Handed to style.ts as --p67-slide. */
export const SLIDE_MS = 320;

export interface Roster {
	el: HTMLElement;
	/** True while the comrades' chips are shown. */
	readonly open: boolean;
	/**
	 * Show or fold away the comrades' chips.
	 *
	 * @param open True to show them.
	 */
	setOpen(open: boolean): void;
	/**
	 * Sync chips with the crew.
	 *
	 * @param comrades Everyone on the roster.
	 * @param selected The comrade whose card is open.
	 * @param replies Comrades with an unread reply to a directive.
	 */
	update(comrades: Comrade[], selected: string | null, replies?: ReadonlySet<string>): void;
}

/**
 * The order the chips stand in: whoever needs the owner, then whoever has replied, then
 * everyone else, each group by name.
 *
 * @param comrades Everyone on the roster.
 * @param replies Comrades with an unread reply.
 * @returns A new, sorted list.
 */
export function rosterOrder<T extends Pick<Comrade, 'id' | 'needsYou'> & { agent: { name: string } }>(comrades: readonly T[], replies: ReadonlySet<string>): T[] {
	const rank = (c: T): number => (c.needsYou ? 0 : replies.has(c.id) ? 1 : 2);
	return [...comrades].sort((a, b) => rank(a) - rank(b) || a.agent.name.localeCompare(b.agent.name));
}

/**
 * What the COMRADES chip says to a screen reader and in its tooltip.
 *
 * @param n Comrades on the roster.
 * @param needs How many need the owner.
 * @param replied How many have an unread reply.
 * @param open True while the chips are shown.
 * @returns A sentence or two.
 */
export function rosterSummary(n: number, needs: number, replied: number, open: boolean): string {
	const who = `${n} ${n === 1 ? 'comrade' : 'comrades'}.`;
	const alerts = [
		needs ? `${needs} ${needs === 1 ? 'needs' : 'need'} you.` : '',
		replied ? `${replied} ${replied === 1 ? 'has' : 'have'} replied to a directive.` : '',
	].filter(Boolean).join(' ');
	return [who, alerts, open ? 'Click to fold them away.' : 'Click to show them.'].filter(Boolean).join(' ');
}

/**
 * Build the roster strip, folded.
 *
 * @param onPick Called with a comrade id when a chip is clicked.
 * @returns Roster.
 */
export function createRoster(onPick: (id: string) => void, host: Pick<Host, 'board'>): Roster {
	const el = document.createElement('nav');
	el.className = 'p67-roster';
	el.setAttribute('aria-label', 'Comrades');
	el.id = 'p67-roster';
	el.style.setProperty('--p67-slide', `${SLIDE_MS}ms`);
	const head = document.createElement('button');
	head.type = 'button';
	head.className = 'p67-chip p67-roster-head';
	head.setAttribute('aria-expanded', 'false');
	head.setAttribute('aria-controls', el.id);
	const emblem = document.createElement('span');
	emblem.className = 'p67-roster-emblem';
	emblem.textContent = '☭';
	emblem.setAttribute('aria-hidden', 'true');
	const label = document.createElement('span');
	const headFlag = document.createElement('span');
	headFlag.className = 'p67-flag';
	const headReply = document.createElement('span');
	headReply.className = 'p67-reply';
	const arrow = document.createElement('span');
	arrow.className = 'p67-roster-arrow';
	arrow.setAttribute('aria-hidden', 'true');
	head.append(emblem, label, headFlag, headReply, arrow);
	el.append(head);
	const chips = new Map<string, { button: HTMLButtonElement; dot: HTMLElement; name: HTMLElement; flag: HTMLElement; reply: HTMLElement }>();
	let open = false;
	/** Set while chips are flying out or back; when it fires, folded chips are hidden. */
	let flight: ReturnType<typeof setTimeout> | null = null;
	/** The last update's arguments, when it had to leave the chips' order alone mid-flight. */
	let deferred: Parameters<Roster['update']> | null = null;
	/** Last counts, for the head's words when it is toggled. */
	let counts = { n: 0, needs: 0, replied: 0 };

	/** Put the counts and the state on the COMRADES chip. */
	const face = (): void => {
		const { n, needs, replied } = counts;
		label.textContent = `COMRADES (${n})`;
		headFlag.textContent = `!${needs}`;
		headFlag.hidden = needs === 0;
		headReply.textContent = `✉\uFE0E${replied}`;
		headReply.hidden = replied === 0;
		arrow.textContent = open ? '◂' : '▸';
		const words = rosterSummary(n, needs, replied, open);
		head.title = words;
		head.setAttribute('aria-label', words);
		head.setAttribute('aria-expanded', String(open));
	};

	/**
	 * Set a CSS variable only when it changes: every write makes the browser restyle, and the
	 * roster is updated on every poll.
	 *
	 * @param node Element.
	 * @param name Variable.
	 * @param value Value.
	 */
	const setVar = (node: HTMLElement, name: string, value: string): void => {
		if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
	};

	/**
	 * The gap between one chip and the next, so a big roster still fans within FAN_MAX_MS.
	 *
	 * @returns Milliseconds.
	 */
	const step = (): number => Math.min(FAN_STEP_MS, FAN_MAX_MS / Math.max(1, chips.size));

	/** Hand the fan's pace to the CSS. */
	const pace = (): void => {
		setVar(el, '--p67-fan-step', `${step()}ms`);
		setVar(el, '--p67-fan-n', String(Math.max(1, chips.size)));
	};

	/**
	 * Point each chip at the COMRADES chip, so folded they sit behind it and open they fly out
	 * of it. offsetLeft/offsetTop are layout positions, which the chips' transforms do not move.
	 * Every position is read before anything is written: reading after a write would make the
	 * browser lay the page out again for each chip, and the stall shows as a judder.
	 */
	const aim = (): void => {
		const hx = head.offsetLeft, hy = head.offsetTop;
		const at = [...chips.values()].map((c) => [c.button, hx - c.button.offsetLeft, hy - c.button.offsetTop] as const);
		for (const [b, dx, dy] of at) { setVar(b, '--p67-dx', `${dx}px`); setVar(b, '--p67-dy', `${dy}px`); }
	};

	const roster: Roster = {
		el,
		get open() { return open; },
		setOpen(next) {
			if (next === open) return;
			open = next;
			if (flight) clearTimeout(flight);
			pace();
			// Folding chips leave the tab order at once, not only once they have slid in and are hidden.
			for (const c of chips.values()) c.button.toggleAttribute('inert', !open);
			if (open) {
				// Hidden chips have no place to measure from: show them folded, with no transition,
				// aimed at the head; then open. Chips still flying back are turned around mid-flight.
				const hidden = [...chips.values()].some((c) => c.button.hidden);
				if (hidden) el.classList.add('p67-aiming');
				for (const c of chips.values()) c.button.hidden = false;
				aim();
				void el.offsetWidth;
				el.classList.remove('p67-aiming');
				el.classList.add('p67-open');
			} else {
				// Open chips are untransformed, so re-aiming them (the roster may have changed) moves nothing.
				aim();
				el.classList.remove('p67-open');
			}
			flight = setTimeout(() => {
				flight = null;
				if (!open) for (const c of chips.values()) c.button.hidden = true;
				if (deferred) { const args = deferred; deferred = null; roster.update(...args); }
			}, step() * chips.size + SLIDE_MS);
			face();
		},
		update(comrades, selected, replies = new Set()) {
			// Reordering mid-flight would jump chips out of the path they are on; it waits for them to land.
			deferred = flight ? [comrades, selected, replies] : null;
			const ids = new Set(comrades.map((c) => c.id));
			for (const [id, chip] of chips) if (!ids.has(id)) { chip.button.remove(); chips.delete(id); }
			rosterOrder(comrades, replies).forEach((c, i) => {
				let chip = chips.get(c.id);
				if (!chip) {
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'p67-chip';
					button.hidden = !open;
					button.toggleAttribute('inert', !open);
					const dot = document.createElement('span');
					dot.className = 'p67-dot';
					const name = document.createElement('span');
					const flag = document.createElement('span');
					flag.className = 'p67-flag';
					flag.textContent = '!';
					const reply = document.createElement('span');
					reply.className = 'p67-reply';
					reply.textContent = '✉\uFE0E';
					button.append(dot, name, reply, flag);
					button.addEventListener('click', () => onPick(c.id));
					chip = { button, dot, name, flag, reply };
					chips.set(c.id, chip);
				}
				if (chip.name.textContent !== c.agent.name) chip.name.textContent = c.agent.name;
				const colour = statusColour(c.agent.status);
				if (chip.dot.dataset.colour !== colour) { chip.dot.dataset.colour = colour; chip.dot.style.background = colour; }
				chip.flag.hidden = !c.needsYou;
				const tip = `${c.agent.name}: ${comradeWords(c.agent, host)}${replies.has(c.id) ? ' They have replied to a directive.' : ''}`;
				if (chip.button.title !== tip) chip.button.title = tip;
				chip.reply.hidden = !replies.has(c.id);
				chip.button.classList.toggle('p67-on', c.id === selected);
				chip.button.setAttribute('aria-pressed', String(c.id === selected));
				if (deferred) { if (!chip.button.parentNode) el.append(chip.button); return; }
				setVar(chip.button, '--p67-i', String(i));
				// The head is child 0. Move a chip only when it is out of place: moving a node drops keyboard focus from it.
				if (el.children[i + 1] !== chip.button) el.insertBefore(chip.button, el.children[i + 1] ?? null);
			});
			counts = { n: comrades.length, needs: comrades.filter((c) => c.needsYou).length, replied: comrades.filter((c) => replies.has(c.id)).length };
			pace();
			face();
		},
	};
	head.addEventListener('click', () => roster.setOpen(!open));
	face();
	return roster;
}
