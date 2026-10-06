/**
 * The options page: Form 67-C, where someone tells the plant where their Paperclip lives.
 * Typing an address and pressing Connect asks Chrome for that one site, registers the plant on
 * <origin>/api/plant-67 and knocks to see whether Paperclip answers. Only the address is kept.
 *
 * Built by scripts/build-extension.ts into options.js for extension/options.html. The page logic
 * takes its Chrome, fetch and tab opener as arguments, so it runs under test in happy-dom.
 */
import { el } from '../cockpit/dom';
import { ADDRESS_ERRORS, plantUrl, tidyAddress } from './connect';
import { connect, disconnect, knock, requestAccess, sync, type ChromeApis } from './registry';

/** What the options page needs from the outside world. */
export interface OptionsDeps {
	apis: ChromeApis;
	fetchImpl: typeof fetch;
	openTab: (url: string) => void;
}

type Note = { kind: 'err' | 'ok' | 'warn'; text: string } | null;

/**
 * Build the options page into a root element and load the saved address.
 *
 * @param {HTMLElement} root Where the form goes.
 * @param {OptionsDeps} deps Chrome, fetch and a tab opener.
 * @returns {Promise<void>} Resolves once the first view is drawn.
 */
export async function mountOptions(root: HTMLElement, deps: OptionsDeps): Promise<void> {
	const form = el('div', 'p67o-form');
	const head = el('div', 'p67o-head');
	head.append(el('span', 'p67o-em', '★'), el('b', '', "THE PEOPLE'S PLANT #67"), el('small', '', 'FORM 67-C · CONNECTION'));
	const body = el('div', 'p67o-body');
	const foot = el('div', 'p67o-foot', 'The plant runs inside your own Paperclip tab. It sees what you can see there and nothing more. ');
	const gh = el('a', '', 'Open source on GitHub.');
	gh.href = 'https://github.com/People-sPlant-67/the-peoples-plant-67';
	gh.target = '_blank';
	gh.rel = 'noopener';
	foot.append(gh);
	form.append(head, body, foot);
	root.replaceChildren(form);

	/**
	 * A message box.
	 *
	 * @param {Note} n The message, or null for none.
	 * @returns {HTMLElement[]} Zero or one element.
	 */
	const note = (n: Note): HTMLElement[] => {
		if (!n) return [];
		const box = el('div', `p67o-${n.kind}`, n.text);
		box.setAttribute('role', n.kind === 'err' ? 'alert' : 'status');
		return [box];
	};

	/**
	 * The address form.
	 *
	 * @param {string} value What the box starts with.
	 * @param {Note} msg A message above it.
	 */
	function showForm(value: string, msg: Note = null): void {
		const h = el('h1', 'p67o-h', 'Where does your Paperclip live?');
		const lede = el('p', 'p67o-lede', 'Type the address you open Paperclip at. Chrome will ask you to let the plant draw on that one site. The plant stores the address and nothing else. No passwords. No keys.');
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
		const btn = el('button', 'p67o-btn p67o-red', 'Connect');
		btn.type = 'submit';
		row.append(input, btn);
		const hint = el('span', 'p67o-note');
		hint.id = 'p67o-hint';
		input.setAttribute('aria-describedby', 'p67o-hint');
		const updateHint = (): void => {
			const r = tidyAddress(input.value);
			hint.replaceChildren(...(r.ok ? ['The plant will open at ', el('b', '', plantUrl(r.origin))] : ['Running Paperclip on this computer? Type ', el('b', '', 'localhost:3100'), '.']));
		};
		input.addEventListener('input', updateHint);
		updateHint();
		f.append(label, row, hint);
		f.addEventListener('submit', (e) => {
			e.preventDefault();
			const r = tidyAddress(input.value);
			if (!r.ok) {
				showForm(input.value, { kind: 'err', text: ADDRESS_ERRORS[r.error] });
				return;
			}
			const typed = input.value;
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
						showForm(typed, { kind: 'err', text: 'Chrome did not give permission, so the plant cannot open there. Press Connect and choose Allow.' });
						return;
					}
					await connect(deps.apis, r.origin);
					await showConnected(r.origin);
				})
				.catch((err: unknown) => showForm(typed, { kind: 'err', text: `Chrome could not finish connecting (${err instanceof Error ? err.message : String(err)}). Try again.` }));
		});
		body.replaceChildren(h, lede, ...note(msg), f);
		input.focus();
	}

	/**
	 * The connected view, then a knock to see whether Paperclip answers. A slow knock that lands
	 * after someone has left the view only touches the detached old elements.
	 *
	 * @param {string} origin The connected origin.
	 * @returns {Promise<void>} Resolves after the knock.
	 */
	async function showConnected(origin: string): Promise<void> {
		const h = el('h1', 'p67o-h', 'The plant is connected.');
		const lede = el('p', 'p67o-lede', 'It opens inside your Paperclip tab and uses the sign-in you already have there.');
		const msg = el('div');
		const conn = el('div', 'p67o-conn');
		const left = el('div');
		left.append(el('div', 'p67o-k', 'Paperclip address'), el('div', 'p67o-v', origin));
		const stamp = el('div', 'p67o-stamp', 'CONNECTED');
		conn.append(left, stamp);
		const open = el('button', 'p67o-btn p67o-red', 'Open the plant');
		open.type = 'button';
		open.addEventListener('click', () => deps.openTab(plantUrl(origin)));
		const change = el('button', 'p67o-btn p67o-ghost', 'Change address');
		change.type = 'button';
		change.addEventListener('click', () => showForm(origin.replace(/^https:\/\//, '')));
		const disc = el('button', 'p67o-btn p67o-ghost', 'Disconnect');
		disc.type = 'button';
		disc.addEventListener('click', () => {
			disc.disabled = true;
			disconnect(deps.apis)
				.then(() => showForm('', { kind: 'ok', text: 'Disconnected. Chrome no longer lets the plant draw on that site.' }))
				.catch((err: unknown) => {
					disc.disabled = false;
					msg.replaceChildren(...note({ kind: 'err', text: `Chrome could not disconnect (${err instanceof Error ? err.message : String(err)}). Try again.` }));
				});
		});
		const actions = el('div', 'p67o-actions');
		actions.append(open, change, disc);
		const tip = el('span', 'p67o-note', 'Tip: the ★ in Chrome\'s toolbar opens the plant from anywhere.');
		const checking = el('span', 'p67o-note', 'Checking that Paperclip answers.');
		body.replaceChildren(h, lede, msg, conn, actions, tip);
		msg.replaceChildren(checking);
		open.focus();
		const answered = await knock(deps.fetchImpl, origin);
		if (answered) {
			msg.replaceChildren(...note({ kind: 'ok', text: `Paperclip answered at ${origin}.` }));
		} else {
			stamp.textContent = 'NO ANSWER';
			stamp.classList.add('p67o-amber');
			msg.replaceChildren(...note({ kind: 'warn', text: `Nothing answered at ${origin} just now. Start Paperclip, then open the plant.` }));
		}
	}

	let origin: string | null = null;
	try {
		origin = await sync(deps.apis);
	} catch (err) {
		showForm('', { kind: 'err', text: `Chrome could not read the saved address (${err instanceof Error ? err.message : String(err)}).` });
		return;
	}
	if (origin) await showConnected(origin);
	else showForm('');
}
