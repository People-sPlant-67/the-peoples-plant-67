/**
 * The options page: Form 67-C, where someone tells the plant where their Paperclip lives.
 * Typing an address and pressing Connect asks Chrome for that one site, registers the plant on
 * <origin>/api/plant-67 and knocks to see who answers there. Only the address is kept.
 *
 * Built by scripts/build-extension.ts into options.js for extension/options.html. The page logic
 * takes its Chrome, fetch and tab opener as arguments, so it runs under test in happy-dom.
 */
import { el } from '../cockpit/dom';
import { ADDRESS_ERRORS, plantUrl, tidyAddress } from './connect';
import { connect, disconnect, knock, requestAccess, savedOrigin, sync, type Answer, type ChromeApis } from './registry';

/** What the options page needs from the outside world. */
export interface OptionsDeps {
	apis: ChromeApis;
	fetchImpl: typeof fetch;
	openTab: (url: string) => void;
}

type Note = { kind: 'err' | 'ok' | 'warn'; text: string } | null;

/** What each knock answer says, and the stamp it leaves. */
const ANSWERS: Record<Answer, { kind: 'ok' | 'warn'; stamp: string; text: (o: string) => string }> = {
	paperclip: { kind: 'ok', stamp: 'CONNECTED', text: (o) => `Paperclip answered at ${o}.` },
	signin: { kind: 'ok', stamp: 'CONNECTED', text: (o) => `A sign-in page answered at ${o}. Sign in there when the plant opens.` },
	other: { kind: 'warn', stamp: 'CHECK ADDRESS', text: (o) => `Something answered at ${o}, but it does not look like Paperclip. Check the address and port.` },
	silent: { kind: 'warn', stamp: 'NO ANSWER', text: (o) => `Nothing answered at ${o}. Check the address and port, or start Paperclip.` },
};

/**
 * The words of an error, for a message.
 *
 * @param {unknown} err What was thrown.
 * @returns {string} Its message.
 */
const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * What to put in the address box for an origin: https is the default, so it is left off.
 *
 * @param {string} origin An origin.
 * @returns {string} Text for the box.
 */
const typed = (origin: string): string => origin.replace(/^https:\/\//, '');

/**
 * Build the options page into a root element and load the saved address.
 *
 * @param {HTMLElement} root Where the form goes.
 * @param {OptionsDeps} deps Chrome, fetch and a tab opener.
 * @returns {Promise<void>} Resolves once the first view is drawn and its knock, if any, is in.
 */
export async function mountOptions(root: HTMLElement, deps: OptionsDeps): Promise<void> {
	const form = el('div', 'p67o-form');
	const head = el('div', 'p67o-head');
	head.append(el('span', 'p67o-em', '★'), el('b', '', "THE PEOPLE'S PLANT #67"), el('small', '', 'FORM 67-C · CONNECTION'));
	const body = el('div', 'p67o-body');
	// The heading, the lede and the message slot stay put from view to view, so a screen reader
	// announces each new message in the slot instead of missing it in a redrawn page.
	const h = el('h1', 'p67o-h');
	const lede = el('p', 'p67o-lede');
	const live = el('div', 'p67o-live');
	live.id = 'p67o-msg';
	live.setAttribute('role', 'status');
	const content = el('div');
	body.append(h, lede, live, content);
	const foot = el('div', 'p67o-foot', 'The plant runs inside your own Paperclip tab. It sees what you can see there and nothing more. ');
	const gh = el('a', '', 'Open source on GitHub.');
	gh.href = 'https://github.com/People-sPlant-67/the-peoples-plant-67';
	gh.target = '_blank';
	gh.rel = 'noopener';
	foot.append(gh);
	form.append(head, body, foot);
	root.replaceChildren(form);

	// Each view bumps this, so a slow knock cannot write into the page someone moved on to.
	let view = 0;

	/**
	 * Show a message in the slot, or clear it.
	 *
	 * @param {Note} n The message, or null for none.
	 */
	const say = (n: Note): void => {
		live.replaceChildren(...(n ? [el('div', `p67o-${n.kind}`, n.text)] : []));
	};

	/**
	 * The address form.
	 *
	 * @param {string} value What the box starts with.
	 * @param {Note} msg A message above it.
	 * @param {string | null} still The address the plant stays connected to while this is
	 *   changed, which gives the form a way back.
	 */
	function showForm(value: string, msg: Note = null, still: string | null = null): void {
		view++;
		h.textContent = still ? 'Change the Paperclip address' : 'Where does your Paperclip live?';
		lede.textContent = still
			? `The plant stays connected to ${still} until a new address is allowed.`
			: 'Type the address you open Paperclip at. Chrome will ask you to let the plant draw on that one site. The plant stores the address and nothing else. No passwords. No keys.';
		say(msg);
		const f = el('form', 'p67o-field');
		f.noValidate = true;
		const label = el('label', 'p67o-label', 'Paperclip address');
		label.htmlFor = 'p67o-addr';
		const row = el('div', 'p67o-row');
		const input = el('input');
		input.id = 'p67o-addr';
		input.value = value;
		input.placeholder = 'paperclip.example.com or localhost:3100';
		input.autocomplete = 'off';
		input.spellcheck = false;
		const hint = el('span', 'p67o-note');
		hint.id = 'p67o-hint';
		input.setAttribute('aria-describedby', msg?.kind === 'err' ? 'p67o-msg p67o-hint' : 'p67o-hint');
		if (msg?.kind === 'err') input.setAttribute('aria-invalid', 'true');
		const btn = el('button', 'p67o-btn p67o-red', 'Connect');
		btn.type = 'submit';
		row.append(input, btn);
		if (still) {
			const cancel = el('button', 'p67o-btn p67o-ghost', 'Cancel');
			cancel.type = 'button';
			cancel.addEventListener('click', () => void showConnected(still));
			row.append(cancel);
		}
		/** Say where the plant will open for what is typed so far. */
		const updateHint = (): void => {
			const r = tidyAddress(input.value);
			hint.replaceChildren(...(r.ok ? ['The plant will open at ', el('b', '', plantUrl(r.origin)), '.'] : ['Running Paperclip on this computer? Type ', el('b', '', 'localhost:3100'), '.']));
		};
		input.addEventListener('input', updateHint);
		updateHint();
		f.append(label, row, hint);
		f.addEventListener('submit', (e) => {
			e.preventDefault();
			const r = tidyAddress(input.value);
			if (!r.ok) {
				showForm(input.value, { kind: 'err', text: ADDRESS_ERRORS[r.error] }, still);
				return;
			}
			const text = input.value;
			btn.disabled = true;
			input.disabled = true;
			// Ask first, before anything else is awaited: Chrome only shows its prompt while the
			// click still counts as the user's own.
			let asked: Promise<boolean>;
			try {
				asked = requestAccess(deps.apis, r.origin);
			} catch (err) {
				asked = Promise.reject(err);
			}
			void asked
				.then(async (granted) => {
					if (!granted) {
						showForm(text, { kind: 'err', text: 'Chrome did not give permission, so the plant cannot open there. Press Connect and choose Allow.' }, still);
						return;
					}
					await connect(deps.apis, r.origin);
					await showConnected(r.origin);
				})
				.catch((err: unknown) => showForm(text, { kind: 'err', text: `Chrome could not finish connecting (${why(err)}). Try again.` }, still));
		});
		content.replaceChildren(f);
		input.focus();
	}

	/**
	 * The connected view, then a knock to see who answers there.
	 *
	 * @param {string} origin The connected origin.
	 * @returns {Promise<void>} Resolves after the knock.
	 */
	async function showConnected(origin: string): Promise<void> {
		const mine = ++view;
		h.textContent = 'The plant is connected.';
		lede.textContent = 'It opens inside your Paperclip tab and uses the sign-in you already have there.';
		say(null);
		const conn = el('div', 'p67o-conn');
		const left = el('div');
		left.append(el('div', 'p67o-k', 'Paperclip address'), el('div', 'p67o-v', origin));
		const stamp = el('div', 'p67o-stamp', 'CHECKING');
		stamp.setAttribute('aria-hidden', 'true');
		conn.append(left, stamp);
		const open = el('button', 'p67o-btn p67o-red', 'Open the plant');
		open.type = 'button';
		open.addEventListener('click', () => deps.openTab(plantUrl(origin)));
		const change = el('button', 'p67o-btn p67o-ghost', 'Change address');
		change.type = 'button';
		change.addEventListener('click', () => showForm(typed(origin), null, origin));
		const disc = el('button', 'p67o-btn p67o-ghost', 'Disconnect');
		disc.type = 'button';
		disc.addEventListener('click', () => {
			disc.disabled = true;
			disconnect(deps.apis)
				.then(() => showForm('', { kind: 'ok', text: 'Disconnected. Chrome no longer lets the plant draw on that site.' }))
				.catch((err: unknown) => {
					disc.disabled = false;
					say({ kind: 'err', text: `Chrome could not disconnect (${why(err)}). Try again.` });
				});
		});
		const actions = el('div', 'p67o-actions');
		actions.append(open, change, disc);
		const tip = el('span', 'p67o-note', 'Tip: pin the plant from the puzzle piece in Chrome\'s toolbar. Its ★ then opens the plant from anywhere.');
		content.replaceChildren(conn, actions, tip);
		open.focus();
		const answer = ANSWERS[await knock(deps.fetchImpl, origin)];
		if (mine !== view) return;
		stamp.textContent = answer.stamp;
		stamp.classList.toggle('p67o-amber', answer.kind === 'warn');
		say({ kind: answer.kind, text: answer.text(origin) });
	}

	let origin: string | null;
	let kept: string | null;
	try {
		origin = await sync(deps.apis);
		kept = origin ? null : await savedOrigin(deps.apis);
	} catch (err) {
		showForm('', { kind: 'err', text: `Chrome could not read the saved address (${why(err)}). Reload this page to try again.` });
		return;
	}
	if (origin) await showConnected(origin);
	// Saved but no longer allowed: someone took the permission back in Chrome's settings.
	else if (kept) showForm(typed(kept), { kind: 'warn', text: `Chrome no longer lets the plant draw on ${kept}. Press Connect to allow it again.` });
	else showForm('');
}
