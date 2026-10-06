/**
 * Name card for one comrade: name, title, status in words, home zone and, verbatim, why they
 * are paused or in error. Below that, two tabs: Directives (dossiers and the chat) and the
 * Personnel File. Every value comes from Paperclip and is untrusted, so it is only ever
 * written with textContent.
 */
import { homeZone } from '../live/placement';
import type { World } from '../world/types';
import type { Comrade } from './crew';
import { el, setText } from './dom';
import { comradeWords, statusColour } from './status';
import type { Host } from './host';

/** The card's tabs. */
export type CardTab = 'directives' | 'file' | 'wardrobe';

/** The tabs, in order. */
const TABS: readonly CardTab[] = ['directives', 'file', 'wardrobe'];

export interface Card {
	el: HTMLElement;
	/** Pane for the Directives tab: the app puts the dossiers and the chat in it. */
	directives: HTMLElement;
	/** Pane for the Personnel File tab. */
	file: HTMLElement;
	/** Pane for the Wardrobe tab. */
	wardrobe: HTMLElement;
	/** The tab showing. It stays as it is from one comrade to the next. */
	readonly tab: CardTab;
	/** Show a tab, as if the owner had picked it. */
	setTab(t: CardTab): void;
	/** Mark the Directives tab when something there needs the owner (a dossier, an unread reply). */
	flagDirectives(on: boolean): void;
	/** Id of the comrade shown, or null when closed. */
	readonly openId: string | null;
	show(c: Comrade): void;
	/** Refresh from the latest crew state; closes the card if the comrade has left. */
	update(c: Comrade | undefined): void;
	hide(): void;
}

/**
 * A labelled line on the card.
 *
 * @param label Label text.
 * @returns Row element and the element that holds its value.
 */
export function row(label: string): { row: HTMLElement; value: HTMLElement } {
	const r = el('div', 'p67-row');
	const value = el('span', 'p67-value');
	r.append(el('span', 'p67-label', label), value);
	return { row: r, value };
}

/**
 * Build the name card (hidden until show()).
 *
 * @param world World, for zone names.
 * @param onClose Called when the card is closed by its button or Escape.
 * @param onTab Called when the owner switches tab.
 * @param doing What a comrade is doing that their place does not say (changing at the cloakroom), or null.
 * @returns Card.
 */
export function createCard(world: World, host: Pick<Host, 'board'>, onClose: () => void, onTab: (t: CardTab) => void = () => {}, doing: (c: Comrade) => string | null = () => null): Card {
	const box = document.createElement('section');
	box.className = 'p67-card';
	box.hidden = true;
	box.setAttribute('aria-live', 'polite');
	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'p67-close';
	close.textContent = '×';
	close.setAttribute('aria-label', 'Close the name card');
	const name = document.createElement('h2');
	const title = document.createElement('p');
	title.className = 'p67-title';
	const status = row('Status');
	const home = row('Home');
	const now = row('Now');
	const error = row('Error');
	const pause = row('Paused because');
	const tabs = el('div', 'p67-tabs');
	tabs.setAttribute('role', 'tablist');
	tabs.setAttribute('aria-label', 'Name card sections');
	const panes: Record<CardTab, HTMLElement> = { directives: el('div', 'p67-pane'), file: el('div', 'p67-pane'), wardrobe: el('div', 'p67-pane') };
	const buttons: Record<CardTab, HTMLButtonElement> = { directives: el('button', 'p67-tab', 'Directives'), file: el('button', 'p67-tab', 'Personnel File'), wardrobe: el('button', 'p67-tab', 'Wardrobe') };
	let tab: CardTab = 'directives';
	/**
	 * Show one tab.
	 *
	 * @param t Tab.
	 */
	const setTab = (t: CardTab): void => {
		tab = t;
		for (const k of TABS) {
			buttons[k].setAttribute('aria-selected', String(k === t));
			buttons[k].tabIndex = k === t ? 0 : -1;
			panes[k].hidden = k !== t;
		}
	};
	for (const k of TABS) {
		buttons[k].type = 'button';
		buttons[k].id = `p67-tab-${k}`;
		buttons[k].setAttribute('role', 'tab');
		buttons[k].setAttribute('aria-controls', `p67-pane-${k}`);
		panes[k].id = `p67-pane-${k}`;
		panes[k].setAttribute('role', 'tabpanel');
		panes[k].setAttribute('aria-labelledby', buttons[k].id);
		buttons[k].addEventListener('click', () => { if (tab !== k) { setTab(k); onTab(k); } });
		tabs.append(buttons[k]);
	}
	// Arrow keys move between tabs, as the tabs pattern expects.
	tabs.addEventListener('keydown', (e) => {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		const k = TABS[(TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
		setTab(k);
		onTab(k);
		buttons[k].focus();
		e.preventDefault();
	});
	setTab('directives');
	box.append(close, name, title, status.row, home.row, now.row, error.row, pause.row, tabs, panes.directives, panes.file, panes.wardrobe);
	let openId: string | null = null;

	/**
	 * Close the card and tell the app.
	 */
	const closeCard = (): void => { if (openId) { openId = null; box.hidden = true; onClose(); } };
	close.addEventListener('click', closeCard);

	/**
	 * Fill the card from a comrade.
	 *
	 * @param c Comrade.
	 */
	const fill = (c: Comrade): void => {
		const a = c.agent;
		setText(name, a.name);
		setText(title, a.title ?? a.role ?? 'No title on file.');
		setText(status.value, comradeWords(a, host));
		status.value.style.color = statusColour(a.status);
		const zone = homeZone(a);
		setText(home.value, zone === 'roam' ? 'The whole plant: The Commissar answers to no single room.' : `${world.zones[zone].label}.`);
		const errand = doing(c);
		if (errand) setText(now.value, errand);
		else if (c.place.zone === 'roam') setText(now.value, c.path.length ? 'Strolling to another part of the plant.' : 'Stopped to inspect this part of the plant.');
		else {
			const label = world.zones[c.place.zone].label;
			// Siberia is a place name; every other zone is a room ("the Canteen").
			setText(now.value, c.path.length ? `Walking to ${c.place.zone === 'siberia' ? '' : 'the '}${label}.` : `${label}.`);
		}
		// Shown exactly as Paperclip wrote them: they are the only clue to what went wrong.
		setText(error.value, a.errorReason ?? '');
		error.row.hidden = !a.errorReason;
		setText(pause.value, pauseWords(a.pauseReason));
		// A waiting comrade's reason is in the status line already.
		pause.row.hidden = !a.pauseReason || a.status === 'waiting';
	};

	return {
		el: box,
		directives: panes.directives,
		file: panes.file,
		wardrobe: panes.wardrobe,
		get tab() { return tab; },
		setTab(t) { if (tab !== t) { setTab(t); onTab(t); } },
		flagDirectives(on) {
			buttons.directives.classList.toggle('p67-tab-flag', on);
			buttons.directives.setAttribute('aria-label', on ? 'Directives: something here needs you.' : 'Directives');
		},
		get openId() { return openId; },
		show(c) {
			openId = c.id;
			fill(c);
			box.hidden = false;
		},
		update(c) {
			if (!openId) return;
			if (!c) { closeCard(); return; }
			fill(c);
		},
		hide: closeCard,
	};
}

/** Paperclip's pause reasons, in words. */
const PAUSE_WORDS: Record<string, string> = {
	manual: 'Paused by hand.',
	budget: 'Over their monthly budget.',
	system: 'Paused by Paperclip itself.',
	company_archived: 'Their company was archived.',
	import: 'Paused when the company was imported.',
};

/**
 * Why a comrade is paused, in words. A reason Paperclip adds later is shown as it comes.
 *
 * @param reason Paperclip's pause reason.
 * @returns Words, or empty for none.
 */
export function pauseWords(reason: string | null): string {
	if (!reason) return '';
	return PAUSE_WORDS[reason] ?? `${reason.replace(/_/g, ' ')}.`;
}
