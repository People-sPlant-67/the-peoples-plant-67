/**
 * The founding form, FORM 67-A: the wizard a new owner goes through over the live plant.
 *
 * 1 Party card (name and title) → 2 Choose your dictator (six archetypes, the painter, or a
 * photo) → 3 Connect (the company and the owner's own seat; in the demo, "Just show me") →
 * 3½ a word about coffee, shown once → 4 Found the Ministry (the regime, and the order for the
 * CEO agent) → 5 Inspection (a stamp for each piece the CEO has set up). A host with no Ministry
 * (the demo, the npx bridge) stops after the coffee, and so does an owner who said "No Ministry,
 * thanks" (after page 4, where they can change their mind).
 *
 * Every change is handed to the cockpit as it happens (save), so the portrait on the wall and
 * the paper change while the owner paints. The wizard opens by itself until the owner has been
 * through it once; the ★ button in the corner reopens it.
 */
import { ARCHETYPES, type Portrait, copyPortrait } from '../art/archetypes';
import { type FetchLike, UUID, get } from '../live/http';
import { CHECK_ORDER, type CheckId, type Inspection, LEDGER_TITLE, LESSONS_TITLE, ROUTINE_TITLE, verdict } from '../live/inspection';
import { ceoPrompt, strikesWords } from '../live/onboarding';
import { isOwnSeat } from '../live/personas';
import { listOf } from '../live/poller';
import type { AgentState } from '../live/types';
import { ownerPortrait } from '../world/zones';
import type { Host } from './host';
import { type Wiring, wiringNote } from './wiring';
import { bitmapCanvas, el, opt, setText } from './dom';
import { createPainter } from './painter';
import { photoToPortrait } from './pixelate';
import { REGIMES, REGIME_ORDER, type Regime } from '../live/regimes';
import { NAME_MAX, STEPS, type Setup, type Step, TITLES, TITLE_MAX, addressOf, cleanText } from './setup-store';

/** Where the coffee goes. */
const COFFEE_URL = 'https://buymeacoffee.com/thechiefengineer';

/** Each page's number and name, as the row of tabs shows them. */
const PIPS: Record<Step, [string, string]> = {
	party: ['1', 'Party card'], dictator: ['2', 'Your dictator'], connect: ['3', 'Connect'],
	coffee: ['3½', 'Coffee'], ministry: ['4', 'Ministry'], inspection: ['5', 'Inspection'],
};

/** Each check's heading on the inspection page. */
const CHECK_HEADS: Record<CheckId, (n: number) => string> = {
	director: () => 'The Director of Operational Hygiene is on the roster',
	routine: () => 'The daily review routine exists',
	ledger: () => 'The Strike Ledger is open',
	threshold: (n) => `The threshold matches your regime (${n})`,
	lessons: () => 'The Lessons of the Tribunal are open',
};
/** What each check looks for, under its heading while it has nothing else to say. */
const CHECK_WANTS: Record<CheckId, (n: number) => string> = {
	director: () => 'Exactly one agent named or titled "Director of Operational Hygiene" ("Enforcer" counts too).',
	routine: () => `Routine "${ROUTINE_TITLE}", given to the Director, switched on.`,
	ledger: () => `An issue titled "${LEDGER_TITLE}".`,
	threshold: (n) => `The ledger's first line reads "Tribunal threshold: ${strikesWords(n)}".`,
	lessons: () => `An issue titled "${LESSONS_TITLE}".`,
};

export interface WizardDeps {
	/** Who the plant draws from, and what it can do (see host.ts). */
	host: Host;
	/** How to wire the harnesses to the bridge, for its Connect page. */
	wiring?: Wiring | null;
	fetchImpl: FetchLike;
	/** The owner's choices as they stand. */
	setup(): Setup;
	/** Take a change: store it and show it in the plant. */
	save(next: Setup): void;
	/** The roster from the last good snapshot. */
	roster(): AgentState[];
	/** The latest inspection, or null before the first. */
	inspection(): Inspection | null;
	/** The company the plant draws now, or null before it has drawn one. */
	drawn(): string | null;
	/**
	 * The inspection page is showing, or has stopped showing: inspect now and every few seconds
	 * while it shows (the answers come back through update()).
	 *
	 * @param on Showing.
	 */
	watch(on: boolean): void;
	/** The wizard opened or closed. */
	onToggle?(open: boolean): void;
}

export interface Wizard {
	el: HTMLElement;
	/** The ★ button that reopens the form, for the cockpit's corner. */
	button: HTMLButtonElement;
	readonly isOpen: boolean;
	/**
	 * Open the form.
	 *
	 * @param step The page to open on; the one last left by default.
	 * @param note A warning to show at the top of that page (the company has gone).
	 */
	open(step?: Step, note?: string): void;
	close(): void;
	/** The roster or the inspection changed: refresh the page that shows them. */
	update(): void;
}

/**
 * The pages this owner goes through: a host with no Ministry has neither Ministry page, an owner
 * who said no keeps page 4 (to change their mind) but has no inspection, and the coffee page
 * shows only once.
 *
 * @param host What the host can do.
 * @param s The owner's choices.
 * @param at The page shown now (kept even if it would otherwise be left out).
 * @returns Pages in order.
 */
export function stepsFor(host: Pick<Host, 'ministry'>, s: Pick<Setup, 'coffeeSeen' | 'ministry'>, at: Step): Step[] {
	return STEPS.filter((p) => p === at || (p === 'coffee' ? !s.coffeeSeen : p === 'ministry' ? host.ministry : p === 'inspection' ? host.ministry && s.ministry : true));
}

/**
 * Build the founding form (closed).
 *
 * @param d Dependencies.
 * @returns Wizard.
 */
export function createWizard(d: WizardDeps): Wizard {
	const back = el('div', 'p67-wiz-back');
	back.hidden = true;
	const form = el('section', 'p67-wiz');
	form.setAttribute('role', 'dialog');
	form.setAttribute('aria-modal', 'true');
	form.setAttribute('aria-labelledby', 'p67-wiz-title');
	form.tabIndex = -1;
	const head = el('div', 'p67-wiz-head');
	const title = el('h2', '', 'FORM 67-A · Founding of the Plant');
	title.id = 'p67-wiz-title';
	const stepOf = el('small');
	const shut = el('button', 'p67-wiz-shut', '×');
	shut.type = 'button';
	shut.setAttribute('aria-label', 'Close the form. It stays where you left it.');
	head.append(el('span', 'p67-wiz-emblem', '★'), title, stepOf, shut);
	const pips = el('nav', 'p67-wiz-pips');
	pips.setAttribute('aria-label', 'Pages of the form');
	const body = el('div', 'p67-wiz-body');
	const foot = el('div', 'p67-wiz-foot');
	const prev = el('button', 'p67-wiz-btn p67-ghost', 'Back');
	prev.type = 'button';
	const footNote = el('span', 'p67-wiz-footnote');
	footNote.setAttribute('role', 'status');
	const next = el('button', 'p67-wiz-btn p67-red', 'Next');
	next.type = 'button';
	foot.append(prev, el('span', 'p67-wiz-gap'), footNote, next);
	form.append(head, pips, body, foot);
	back.append(form);

	const button = el('button', 'p67-ministry-chip', d.host.ministry && d.setup().ministry ? '★ Ministry' : '★ Founding form');
	button.type = 'button';
	button.title = d.host.ministry ? 'Reopen the founding form: your party card, your portrait and the Ministry.' : 'Reopen the founding form: your party card and your portrait.';

	let isOpen = false;
	let step: Step = d.setup().step;
	let note: string | null = null;
	let restore: HTMLElement | null = null;
	/** Dictator page: which tab is showing. */
	let tab: 'arch' | 'paint' | 'photo' = 'arch';
	/** Photo page: the chosen file, kept only while the form is open, for the sepia toggle. */
	let photo: Blob | null = null;
	let sepia = false;
	/** Inspection page: checks already stamped, so a stamp thuds once and then stays still. */
	const stamped = new Set<CheckId>();
	/** Connect page: the companies Paperclip lists, once read. */
	let companies: { id: string; name: string }[] | null = null;
	let companiesError: string | null = null;
	/** Pieces of the page shown now that update() refreshes in place. */
	let live: { company?: HTMLSelectElement; seat?: HTMLSelectElement; checks?: HTMLElement; empty?: HTMLElement; paintCompanies?: () => void } = {};
	/** Bridge Connect page: say how to wire a harness while the plant has drawn nobody. */
	const paintEmpty = (): void => { if (live.empty) live.empty.hidden = !(d.drawn() !== null && !d.roster().length); };
	/** Connect page: the company list is being read (one read at a time). */
	let companiesLoading = false;
	/** Ministry page: a regime clicked with a Director at work, waiting to be confirmed. */
	let pendingRegime: Regime | null = null;
	/** Ministry page: the state it was drawn for. */
	let ministryShown: 'founded' | 'standing' | 'none' = 'none';

	/**
	 * The threshold the ledger says now, from the last inspection, or null when it is not known.
	 *
	 * @returns Strikes, or null.
	 */
	const ledgerSays = (): number | null => d.inspection()?.ledgerSays ?? null;

	/**
	 * Where the Ministry stands: founded; set up (a Director at work) but failing a check; or not
	 * set up. Only in the last case is the order offered unfolded, so it is never sent twice.
	 *
	 * @returns State.
	 */
	const ministryState = (): 'founded' | 'standing' | 'none' => {
		const s = setup();
		if (!wanted()) return 'none';
		if (s.founded) return 'founded';
		const i = d.inspection();
		// Before the first inspection, a ledger found on an earlier visit says the Ministry stands.
		return (i ? i.director.state === 'ok' : !!(s.known.ledger || s.known.lessons)) ? 'standing' : 'none';
	};
	/** Photo page: bumped for every photo run, so only the newest result is taken. */
	let photoRun = 0;

	const setup = (): Setup => d.setup();
	/** The Ministry is wanted here: the host can carry one and the owner has not said no. */
	const wanted = (): boolean => d.host.ministry && setup().ministry;
	/**
	 * Change the setup.
	 *
	 * @param patch Fields to change.
	 */
	const change = (patch: Partial<Setup>): void => d.save({ ...setup(), ...patch });

	/**
	 * Move to a page.
	 *
	 * @param s Page.
	 */
	function go(s: Step): void {
		// Leaving the coffee page counts as having seen it.
		if (step === 'coffee' && s !== 'coffee') change({ coffeeSeen: true });
		step = s;
		note = null;
		pendingRegime = null;
		change({ step: s });
		render();
		body.scrollTop = 0;
		form.focus();
		watchInspection();
	}

	/** Tell the setup whether the inspection page is showing. */
	function watchInspection(): void {
		// The Ministry page reads the ledger's number too (for the regime confirm), so it watches as well.
		d.watch(isOpen && wanted() && (step === 'inspection' || step === 'ministry'));
	}

	/** The pages, in order, for this owner now. */
	const steps = (): Step[] => stepsFor(d.host, setup(), step);

	/** Finish: the owner enters the plant. */
	function finish(): void {
		// The form reopens on the page it closed on; the coffee page is shown once only.
		if (step === 'coffee') { change({ coffeeSeen: true, done: true, step: 'party' }); step = 'party'; }
		else change({ done: true });
		close();
	}

	/** Draw the page shown now. */
	function render(): void {
		const order = steps();
		const at = order.indexOf(step);
		pips.replaceChildren();
		for (const s of order) {
			const p = el('button', 'p67-wiz-pip', `${PIPS[s][0]} ${PIPS[s][1]}`);
			p.type = 'button';
			if (s === step) { p.classList.add('p67-on'); p.setAttribute('aria-current', 'step'); }
			else if (order.indexOf(s) < at) p.classList.add('p67-done');
			// Pages ahead open only once a name is given: the card is the one thing the form needs.
			p.disabled = !setup().name && s !== 'party';
			p.addEventListener('click', () => go(s));
			pips.append(p);
		}
		const visible = order.filter((s) => s !== 'coffee');
		setText(stepOf, step === 'coffee' ? 'A word from the Chief Engineer' : `Page ${PIPS[step][0]} of ${visible.length}`);
		live = {};
		body.replaceChildren();
		if (note) body.append(el('p', 'p67-wiz-err', note));
		PAGES[step]();
		prev.disabled = at <= 0;
		// The page was rebuilt under the focus: give it back to the form, so Escape still reaches it.
		if (isOpen && !form.contains(document.activeElement)) form.focus();
		paintFoot();
	}

	/** The foot's buttons and note for the page shown now. */
	function paintFoot(): void {
		const order = steps();
		const last = order.indexOf(step) === order.length - 1;
		const needName = step === 'party' && !setup().name;
		// Live Connect waits for the company list: Next keeps the company shown, so there must be one.
		const needList = step === 'connect' && d.host.companies && !(companies && companies.length);
		next.disabled = needName || needList;
		// While a regime change waits for its answer, the confirm box holds the main choice.
		next.classList.toggle('p67-red', !(step === 'ministry' && pendingRegime));
		next.classList.toggle('p67-ghost', step === 'ministry' && !!pendingRegime);
		setText(footNote, needName ? 'A name, please, comrade.' : needList ? (companiesError ? '' : 'Reading the companies…') : '');
		if (step === 'coffee') setText(next, last ? 'Not today, comrade. Enter the plant' : 'Not today, comrade');
		else if (step === 'ministry' && !setup().ministry) setText(next, last ? 'Enter the plant' : 'Next');
		else if (step === 'ministry') setText(next, ministryState() !== 'none' ? 'See the inspection' : 'I have sent it');
		else if (step === 'connect' && d.host.companies && live.company?.value && live.company.value !== d.drawn()) setText(next, 'Use this company');
		else if (step === 'inspection') { const i = d.inspection(); setText(next, i && verdict(i, false) ? 'Enter the plant' : 'Enter the plant, finish later'); }
		else if (step === 'connect' && d.host.kind === 'demo') setText(next, 'Just show me');
		else setText(next, last ? 'Enter the plant' : 'Next');
	}

	/**
	 * A page heading and the line under it.
	 *
	 * @param h Heading.
	 * @param lede Line.
	 */
	const heading = (h: string, lede: string): void => { body.append(el('h3', 'p67-wiz-h', h), el('p', 'p67-wiz-lede', lede)); };

	/**
	 * A labelled field.
	 *
	 * @param label Label text.
	 * @param control The control.
	 * @returns Field.
	 */
	const field = (label: string, control: HTMLElement): HTMLLabelElement => {
		const f = el('label', 'p67-wiz-field');
		f.append(el('span', '', label), control);
		return f;
	};

	/**
	 * A framed portrait canvas.
	 *
	 * @param inside Portrait inside, or null for the Chairman.
	 * @param scale Pixel size.
	 * @param cls Class.
	 * @returns Canvas.
	 */
	const portraitCanvas = (inside: Portrait | null, scale: number, cls: string): HTMLCanvasElement => {
		const c = bitmapCanvas(ownerPortrait(inside ?? undefined).b, scale);
		c.className = cls;
		c.setAttribute('aria-hidden', 'true');
		return c;
	};

	const PAGES: Record<Step, () => void> = {
		party() {
			heading('Your Party card', 'Who runs this plant? The comrades will address you by this. You can change it later.');
			const s = setup();
			const wrap = el('div', 'p67-wiz-party');
			const left = el('div');
			const name = el('input');
			name.maxLength = NAME_MAX;
			name.placeholder = 'e.g. Sasha';
			name.value = s.name;
			name.autocomplete = 'off';
			const pick = el('select');
			for (const t of TITLES) pick.append(opt(t, t));
			pick.append(opt('Something else…', ''));
			const custom = el('input');
			custom.maxLength = TITLE_MAX;
			const own = !TITLES.includes(s.title);
			pick.value = own ? '' : s.title;
			custom.value = own ? s.title : '';
			const customField = field('Your own title', custom);
			customField.hidden = !own;
			left.append(field('Your name, or the one you go by', name), field('Your title', pick), customField, el('p', 'p67-wiz-note', d.host.kind === 'paperclip' ? 'Kept in this browser, in your Paperclip site\'s storage. The plant sends it nowhere else.' : d.host.kind === 'bridge' ? 'Kept in the plant\'s folder on this computer. Sent nowhere else.' : 'Kept in this browser. Sent nowhere.'));
			const card = el('div', 'p67-wiz-booklet');
			card.append(el('div', 'p67-wiz-cap', 'Communist Party of the Plant'), el('div', 'p67-wiz-star', '★'), el('div', 'p67-wiz-cap', 'Party card No. 67-000001'));
			const inner = el('div', 'p67-wiz-inner');
			const slot = el('div', 'p67-wiz-slot');
			const nameV = el('div', 'p67-wiz-v');
			const rankV = el('div', 'p67-wiz-v');
			const info = el('div');
			info.append(el('div', 'p67-wiz-k', 'Name'), nameV, el('div', 'p67-wiz-k', 'Rank'), rankV);
			inner.append(slot, info);
			card.append(inner, el('div', 'p67-wiz-seal', 'PLANT No. 67'));
			const paint = (): void => {
				const now = setup();
				setText(nameV, now.name || '…');
				setText(rankV, now.title);
				slot.replaceChildren(portraitCanvas(now.portrait, 3, 'p67-wiz-slotpic'));
				paintFoot();
				for (const p of Array.from(pips.children)) (p as HTMLButtonElement).disabled = !now.name && !p.classList.contains('p67-on');
			};
			name.addEventListener('input', () => { change({ name: cleanText(name.value, NAME_MAX) ?? '' }); paint(); });
			pick.addEventListener('change', () => {
				customField.hidden = pick.value !== '';
				change({ title: pick.value || cleanText(custom.value, TITLE_MAX) || 'Leader' });
				paint();
				if (!pick.value) custom.focus();
			});
			custom.addEventListener('input', () => { change({ title: cleanText(custom.value, TITLE_MAX) || 'Leader' }); paint(); });
			name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && setup().name) next.click(); });
			wrap.append(left, card);
			body.append(wrap);
			paint();
			queueMicrotask(() => { if (isOpen) name.focus(); });
		},

		dictator() {
			heading('Choose your dictator', 'This portrait hangs in the Director\'s office and heads every edition of Pravda. Pick one, paint your own, or pixelate a photo.');
			const tabs = el('div', 'p67-wiz-tabs');
			tabs.setAttribute('role', 'tablist');
			for (const [k, t] of [['arch', 'Six archetypes'], ['paint', 'Paint your own'], ['photo', 'From a photo']] as const) {
				const b = el('button', 'p67-wiz-tab', t);
				b.type = 'button';
				b.setAttribute('role', 'tab');
				b.setAttribute('aria-selected', String(tab === k));
				b.addEventListener('click', () => { tab = k; render(); });
				tabs.append(b);
			}
			body.append(tabs);
			const wrap = el('div', 'p67-wiz-dict');
			const main = el('div');
			const side = el('div', 'p67-wiz-preview');
			const wall = el('div', 'p67-wiz-wall');
			const caption = el('div', 'p67-wiz-caption');
			side.append(wall, caption);
			const preview = (): void => {
				wall.replaceChildren(portraitCanvas(setup().portrait, 5, 'p67-wiz-big'));
				setText(caption, `“${addressOf(setup())}”`);
			};
			/**
			 * Take a new portrait.
			 *
			 * @param p Portrait.
			 * @param archetype The archetype it is, untouched, or null.
			 */
			const take = (p: Portrait, archetype: string | null): void => { change({ portrait: copyPortrait(p), archetype }); preview(); };

			if (tab === 'arch') {
				const grid = el('div', 'p67-wiz-archs');
				grid.setAttribute('role', 'radiogroup');
				grid.setAttribute('aria-label', 'Archetypes');
				for (const a of ARCHETYPES) {
					const card = el('button', 'p67-wiz-arch');
					card.type = 'button';
					card.setAttribute('role', 'radio');
					const on = setup().archetype === a.id;
					card.setAttribute('aria-checked', String(on));
					const words = el('div');
					words.append(el('b', '', a.name), el('span', '', a.line));
					card.append(portraitCanvas(a.pixels, 2, 'p67-wiz-archpic'), words);
					card.addEventListener('click', () => {
						take(a.pixels, a.id);
						for (const c of Array.from(grid.children)) c.setAttribute('aria-checked', String(c === card));
					});
					grid.append(card);
				}
				main.append(grid, el('p', 'p67-wiz-note', 'All six are made up. No real faces. Pick one or use "Paint your own" to go custom.'));
			} else if (tab === 'paint') {
				const painter = createPainter({
					get: () => setup().portrait ?? ARCHETYPES[0].pixels,
					set: (p) => take(p, null),
				});
				main.append(painter.el);
			} else {
				const pickPhoto = el('input');
				pickPhoto.type = 'file';
				pickPhoto.accept = 'image/*';
				const drop = el('label', 'p67-wiz-drop');
				drop.append(el('b', '', 'Choose a photo'), el('span', 'p67-wiz-note', 'It is cropped to the frame, shrunk to 20 × 26 and painted in the plant\'s palette. The photo itself never leaves this browser and is not kept.'), pickPhoto);
				const row = el('div', 'p67-wiz-row');
				const sep = el('input');
				sep.type = 'checkbox';
				sep.checked = sepia;
				const sepLabel = el('label');
				sepLabel.append(sep, document.createTextNode(' Sepia print, like an old official portrait'));
				const touch = el('button', 'p67-wiz-btn p67-ghost', 'Touch it up in the painter');
				touch.type = 'button';
				touch.addEventListener('click', () => { tab = 'paint'; render(); });
				const err = el('p', 'p67-wiz-err');
				err.hidden = true;
				const run = async (): Promise<void> => {
					if (!photo) return;
					const mine = ++photoRun;
					try {
						const p = await photoToPortrait(photo, sepia);
						// A newer photo, a sepia change or a closed form since: this one is no longer wanted.
						if (mine !== photoRun || !isOpen || tab !== 'photo') return;
						take(p, null);
						err.hidden = true;
					} catch (e) {
						if (mine !== photoRun) return;
						err.hidden = false;
						setText(err, (e as Error).message);
					}
				};
				pickPhoto.addEventListener('change', () => { photo = pickPhoto.files?.[0] ?? null; void run(); });
				sep.addEventListener('change', () => { sepia = sep.checked; void run(); });
				row.append(sepLabel, touch);
				main.append(drop, row, err);
			}
			wrap.append(main, side);
			body.append(wrap);
			preview();
		},

		connect() {
			if (d.host.kind === 'bridge') {
				heading('Connect the plant', 'The plant draws your agents from the bridge running on this computer.');
				const none = wiringNote(d.wiring ?? null, 'p67-wiz-err');
				live.empty = none;
				body.append(
					el('p', 'p67-wiz-ok', 'Connected to the plant on this computer. Claude Code and Codex tell it what each agent is doing.'),
					none,
					el('p', 'p67-wiz-note', 'Nothing leaves this computer. A directive you send a comrade waits here until you next send that agent a prompt in its terminal.'),
				);
				paintEmpty();
				return;
			}
			if (d.host.kind === 'demo') {
				heading('Connect the plant', 'The plant draws your agents from Paperclip. No Paperclip yet? Watch the demo plant instead.');
				const two = el('div', 'p67-wiz-two');
				const have = el('div', 'p67-wiz-choice');
				have.append(el('h4', '', 'I have Paperclip'), el('p', '', 'The plant comes as a Chrome extension: you give it your Paperclip address and open the plant from there. The install guide arrives with the first release.'));
				const demo = el('div', 'p67-wiz-choice');
				demo.append(el('h4', '', 'Just show me'), el('p', '', 'A made-up plant with made-up comrades. Everything works, and it changes nothing real. Press "Just show me" below.'));
				two.append(have, demo);
				body.append(two);
				return;
			}
			heading('Connect the plant', 'The plant draws your agents from the Paperclip you are signed in to.');
			body.append(el('p', 'p67-wiz-ok', `Signed in to Paperclip at ${location.host}. The plant uses your browser's own sign-in. No keys are stored.`));
			const two = el('div', 'p67-wiz-two');
			const company = el('select');
			live.company = company;
			const companyField = field('Which company is this plant?', company);
			const failed = el('div', 'p67-wiz-err p67-wiz-failed');
			const failedWords = el('p');
			const retry = el('button', 'p67-wiz-btn p67-ghost', 'Try again');
			retry.type = 'button';
			retry.addEventListener('click', () => { companiesError = null; companies = null; loadCompanies(); paintCompanies(); });
			failed.append(failedWords, retry);
			body.append(failed);
			// The choice is kept on Next, so looking through the list changes nothing until then.
			const paintCompanies = (): void => {
				const s = setup();
				company.replaceChildren();
				failed.hidden = !companiesError;
				setText(failedWords, companiesError ?? '');
				if (companiesError) { companyField.hidden = true; paintFoot(); return; }
				if (!companies) { company.append(opt('Reading the companies…', '')); company.disabled = true; paintFoot(); return; }
				company.disabled = false;
				for (const c of companies) company.append(opt(c.name, c.id));
				const listed = !!s.companyId && companies.some((c) => c.id === s.companyId);
				company.value = listed ? s.companyId! : companies[0]?.id ?? '';
				companyField.hidden = companies.length < 2 && (listed || !s.companyId);
				paintSeat();
				paintFoot();
			};
			const loadCompanies = (): void => {
				if (companiesLoading) return;
				companiesLoading = true;
				void get(d.fetchImpl, '/api/companies').then((g) => {
					// Only ids Paperclip could have given out: anything else could never be drawn.
					companiesLoading = false;
					const list = g.ok ? listOf(g.body).flatMap((c) => (typeof c.id === 'string' && UUID.test(c.id) ? [{ id: c.id, name: typeof c.name === 'string' && c.name ? c.name : 'A company with no name' }] : [])) : [];
					if (!g.ok) companiesError = 'Paperclip did not list your companies just now. Check that the dashboard loads in this browser, then press Try again.';
					else if (!list.length) companiesError = 'Paperclip lists no company this sign-in can use. Check your account in the dashboard, then press Try again.';
					else companies = list;
					// Painted on the Connect page showing now, which may have been redrawn since this began.
					if (isOpen && step === 'connect') live.paintCompanies?.();
				});
			};
			live.paintCompanies = paintCompanies;
			// Another company in the list: its roster is not drawn yet, so the seat waits for it.
			company.addEventListener('change', () => { paintSeat(); paintFoot(); });
			if (!companies && !companiesError) loadCompanies();
			const seat = el('select');
			live.seat = seat;
			// Kept at once (and again on Next): an enabled list is always the drawn company's roster.
			seat.addEventListener('change', () => { if (!seat.disabled && seat.value) change({ seatAgentId: seat.value }); });
			const seatField = field('Do you work one of these agents yourself?', seat);
			seatField.append(el('span', 'p67-wiz-note', 'Some owners sit in as an agent and do its work by hand. If that is you, pick it: it stays in the Director\'s office, is never sent to Siberia or put on trial, and shows no shift log.'));
			two.append(companyField, seatField);
			body.append(two);
			paintCompanies();
			paintSeat();
		},

		coffee() {
			const w = el('div', 'p67-wiz-coffee');
			const mug = el('canvas', 'p67-wiz-mug');
			mug.width = 16; mug.height = 16;
			mug.setAttribute('aria-hidden', 'true');
			const m = mug.getContext('2d');
			const P = (c: string, x: number, y: number, ww = 1, hh = 1): void => { if (m) { m.fillStyle = c; m.fillRect(x, y, ww, hh); } };
			P('#efe3c4', 3, 5, 8, 9); P('#b02a22', 3, 8, 8, 2); P('#e6b92e', 6, 8, 2, 2); P('#efe3c4', 11, 7, 2, 1); P('#efe3c4', 12, 8, 1, 3);
			P('#efe3c4', 11, 11, 2, 1); P('#3a2e26', 4, 5, 6, 1); P('#9a958a', 5, 2, 1, 2); P('#9a958a', 8, 1, 1, 3);
			const t = el('div');
			const buy = el('a', 'p67-wiz-btn p67-red', '☕ Buy the Chief Engineer a coffee');
			buy.href = COFFEE_URL;
			buy.target = '_blank';
			buy.rel = 'noopener noreferrer';
			t.append(
				el('h3', 'p67-wiz-h', 'A word from the Chief Engineer'),
				el('p', 'p67-wiz-lede', 'I built this in my spare time (mostly late into the night), fuelled by unhinged passion and coffee. If you like, you can spot me my next coffee.'),
				buy,
				el('p', 'p67-wiz-note', 'Shown once. Never again after this.'),
			);
			w.append(mug, t);
			body.append(w);
		},

		ministry() {
			const s = setup();
			const st = ministryState();
			ministryShown = st;
			/**
			 * Say yes or no to the Ministry. No stops the inspection and the nag; yes inspects at once.
			 *
			 * @param yes Wanted.
			 */
			const want = (yes: boolean): void => { pendingRegime = null; change({ ministry: yes }); render(); watchInspection(); };
			if (!s.ministry) {
				heading('Found the Ministry', 'No Ministry, by your order. The plant runs without one: nothing is inspected and nothing nags. Change your mind here any time.');
				const again = el('button', 'p67-wiz-btn p67-red', 'Found the Ministry after all');
				again.type = 'button';
				again.addEventListener('click', () => want(true));
				body.append(again);
				return;
			}
			const no = el('p', 'p67-wiz-note p67-wiz-optout');
			const decline = el('button', 'p67-wiz-btn p67-ghost', 'No Ministry, thanks');
			decline.type = 'button';
			decline.addEventListener('click', () => want(false));
			no.append(document.createTextNode('You can run the plant without it. Nothing is inspected and nothing nags. '), decline);
			heading('Found the Ministry', st === 'founded'
				? `Your Ministry is founded, under the ${REGIMES[s.regime].name} regime. You need nothing more here.`
				: st === 'standing'
					? 'Your Ministry is set up but needs a fix. The inspection page says what to change.'
					: 'Pick the regime. It sets how many strikes an agent may collect before the Director refers them to your tribunal.');
			const row = el('div', 'p67-wiz-regimes');
			row.setAttribute('role', 'radiogroup');
			row.setAttribute('aria-label', 'Regime');
			for (const k of REGIME_ORDER) {
				const r = REGIMES[k];
				const b = el('button', `p67-wiz-regime p67-${r.tone}`);
				b.type = 'button';
				b.setAttribute('role', 'radio');
				b.setAttribute('aria-checked', String(s.regime === k));
				const small = el('small');
				small.append(el('b', '', r.name), el('br'), document.createTextNode(r.line));
				b.append(el('span', 'p67-wiz-rword', r.word), el('span', 'p67-wiz-rnum', String(r.strikes)), small);
				b.addEventListener('click', () => {
					if (k === setup().regime) { pendingRegime = null; render(); return; }
					// The ledger already says this regime's number: nothing to ask the CEO, so no confirm.
					if (ledgerSays() === REGIMES[k].strikes) { pendingRegime = null; change({ regime: k }); render(); return; }
					// With a Director at work, a new regime means a new ledger line: it is confirmed first.
					if (ministryState() !== 'none') { pendingRegime = k; render(); return; }
					change({ regime: k });
					render();
				});
				row.append(b);
			}
			body.append(row);
			if (pendingRegime) {
				const to = REGIMES[pendingRegime], from = REGIMES[s.regime];
				const now = ledgerSays();
				const ask = el('div', 'p67-wiz-confirm');
				ask.setAttribute('role', 'alert');
				const yes = el('button', 'p67-wiz-btn p67-red', `Change to ${to.name}`);
				yes.type = 'button';
				const keep = el('button', 'p67-wiz-btn p67-ghost', `Keep ${from.name}`);
				keep.type = 'button';
				const target = pendingRegime;
				yes.addEventListener('click', () => { pendingRegime = null; change({ regime: target }); render(); });
				keep.addEventListener('click', () => { pendingRegime = null; render(); });
				ask.append(
					el('p', '', `${now === null ? 'The plant has not read a threshold line on your Strike Ledger yet.' : `Your Strike Ledger's first line reads "Tribunal threshold: ${strikesWords(now)}".`} For ${to.name} it must read "Tribunal threshold: ${strikesWords(to.strikes)}". Ask your CEO to change that line. The Director takes the number from it. Until it is changed, the inspection marks the threshold wrong.`),
					yes, keep,
				);
				body.append(ask);
			}
			const n = REGIMES[s.regime].strikes;
			const box = el('div', 'p67-wiz-prompt');
			const text = ceoPrompt(n);
			const pre = el('pre');
			pre.tabIndex = 0;
			pre.setAttribute('aria-label', 'The order for your CEO agent');
			// The threshold is marked wherever it appears, so the owner can see their regime went in.
			const mark = `Tribunal threshold: ${strikesWords(n)}`;
			const parts = text.split(mark);
			parts.forEach((p, i) => { pre.append(document.createTextNode(p)); if (i < parts.length - 1) pre.append(el('mark', '', mark)); });
			const copy = el('button', 'p67-wiz-btn p67-copy', 'Copy the order');
			copy.type = 'button';
			copy.addEventListener('click', () => {
				const done = (): void => setText(copy, 'Copied ✓');
				const fallback = (): void => {
					// Clipboard refused (an older browser, or no permission): select the text to copy by hand.
					const r = document.createRange();
					r.selectNodeContents(pre);
					const sel = getSelection();
					sel?.removeAllRanges();
					sel?.addRange(r);
					setText(copy, 'Selected: press Ctrl+C or ⌘C');
				};
				if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
				else fallback();
			});
			box.append(copy, pre);
			if (st !== 'none') {
				// Sending the order again would hire a second Director, so it is folded away.
				const fold = el('details', 'p67-wiz-fold');
				fold.append(el('summary', '', 'Show the order again'), el('p', 'p67-wiz-note', 'Only send it again to a company that has no Ministry yet. Sent twice, it hires a second Director.'), box);
				body.append(fold, no);
				return;
			}
			body.append(box, el('p', 'p67-wiz-note', 'Paste it into Paperclip as a new issue for your CEO agent. Then come back: the next page watches for each piece.'), no);
		},

		inspection() {
			heading('Inspection', 'The inspector checks Paperclip every few seconds. Each piece your CEO sets up gets stamped. You can close this and come back: the ★ button, top right, reopens it.');
			const list = el('div', 'p67-wiz-checks');
			list.setAttribute('aria-live', 'polite');
			live.checks = list;
			body.append(list);
			paintChecks();
		},
	};

	/** The seat list on the connect page, from the roster, keeping the choice. */
	function paintSeat(): void {
		const seat = live.seat;
		if (!seat || document.activeElement === seat) return;
		const s = setup();
		// The seat is chosen from the company the plant draws. Another company in the list, or a
		// roster not read yet: the choice waits, and nothing about the seat is kept on Next.
		const elsewhere = !!live.company?.value && live.company.value !== d.drawn();
		const roster = elsewhere ? [] : d.roster().filter((a) => a.status !== 'terminated').sort((a, b) => a.name.localeCompare(b.name));
		seat.disabled = !roster.length;
		if (!roster.length) {
			seat.replaceChildren(opt(elsewhere ? 'Pick your seat after the switch' : 'The roster appears once the plant draws your company', ''));
			return;
		}
		seat.replaceChildren(opt('No, none of them is me', 'none'));
		for (const a of roster) seat.append(opt(a.title ? `${a.name} (${a.title})` : a.name, a.id));
		// Until the owner chooses, an agent the old name rule counts as the seat is offered first.
		// What shows is kept on Next, so the choice is always the owner's own from then on.
		const shown = s.seatAgentId ?? roster.find((a) => isOwnSeat(a))?.id ?? 'none';
		if (shown !== 'none' && !roster.some((a) => a.id === shown) && roster.length) seat.append(opt('The agent you chose is no longer on the roster', shown));
		seat.value = shown;
		if (seat.value !== shown) seat.value = 'none';
	}

	/** The inspection rows, from the latest inspection. */
	function paintChecks(): void {
		const list = live.checks;
		if (!list) return;
		const n = REGIMES[setup().regime].strikes;
		const got = d.inspection();
		list.replaceChildren();
		if (!got) list.append(el('p', 'p67-wiz-note', 'Waiting for the plant to draw your company from Paperclip. The stamps land as soon as it does. If your company has gone, choose one on page 3.'));
		for (const k of CHECK_ORDER) {
			const c = got?.[k] ?? { state: 'unknown' as const, note: null };
			const r = el('div', 'p67-wiz-check');
			let word: string, cls: string;
			if (c.state === 'ok') { word = 'ПРИНЯТО'; cls = stamped.has(k) ? 'p67-ok' : 'p67-ok p67-fresh'; stamped.add(k); }
			else if (c.state === 'wrong') { word = 'НЕ ТАК'; cls = 'p67-bad'; stamped.delete(k); }
			else if (c.state === 'manual') { word = 'check by hand'; cls = 'p67-manual'; stamped.delete(k); }
			else { word = got ? (c.state === 'missing' ? 'not found yet' : 'checking…') : 'checking…'; cls = 'p67-no'; stamped.delete(k); }
			const st = el('div', `p67-wiz-st ${cls}`, word);
			// The stamps are Russian; a screen reader hears what they mean.
			st.setAttribute('aria-label', { ok: 'Accepted', wrong: 'Not right', manual: 'Check by hand', missing: 'Not found yet', unknown: 'Checking' }[c.state]);
			const t = el('div');
			t.append(el('b', '', CHECK_HEADS[k](n)), el('span', '', c.state === 'ok' || !c.note ? CHECK_WANTS[k](n) : c.note));
			r.append(st, t);
			list.append(r);
		}
		paintFoot();
	}

	/**
	 * Keep Tab inside the form while it is open.
	 *
	 * @param e Key event.
	 */
	function trap(e: KeyboardEvent): void {
		// Escape closes the form and goes no further: nothing behind it closes or deselects too.
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
		if (e.key !== 'Tab') return;
		const all = Array.from(form.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([type=hidden]), select, textarea, [tabindex="0"]')).filter((x) => !x.closest('[hidden]'));
		if (!all.length) return;
		const first = all[0], last = all[all.length - 1];
		if (e.shiftKey && (document.activeElement === first || document.activeElement === form)) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}

	/**
	 * Open the form.
	 *
	 * @param at Page.
	 * @param warn Warning at the top.
	 */
	function open(at?: Step, warn?: string): void {
		step = at ?? setup().step;
		// A page this owner no longer goes through (the coffee, once seen; the Ministry, on a host without one) opens the card instead.
		if (!stepsFor(d.host, setup(), 'party').includes(step)) step = 'party';
		note = warn ?? null;
		if (!isOpen) {
			restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			isOpen = true;
			back.hidden = false;
			d.onToggle?.(true);
		}
		render();
		form.focus();
		watchInspection();
	}

	/** Close the form; it remembers its page. */
	function close(): void {
		if (!isOpen) return;
		// Closing counts as "finish later": the form waits behind the ★ button instead of
		// opening by itself on every visit. Closed on the coffee page, it reopens past it.
		const order = steps();
		const after = order[order.indexOf(step) + 1] ?? 'party';
		change({ done: true, ...(step === 'coffee' ? { coffeeSeen: true, step: after } : {}) });
		if (step === 'coffee') step = after;
		pendingRegime = null;
		photoRun++;
		isOpen = false;
		watchInspection();
		back.hidden = true;
		photo = null;
		companies = null;
		companiesError = null;
		d.onToggle?.(false);
		// A first-run form opened with nothing focused: give focus to the ★ button that reopens it.
		(restore && restore.isConnected && restore !== document.body ? restore : button).focus();
	}

	prev.addEventListener('click', () => {
		const order = steps();
		const i = order.indexOf(step);
		if (i > 0) go(order[i - 1]);
	});
	next.addEventListener('click', () => {
		if (step === 'party' && !setup().name) return;
		const order = steps();
		const i = order.indexOf(step);
		// Connect keeps both choices as shown, and the page to come back to, in one change: a new
		// company starts the plant again for it.
		if (step === 'connect' && d.host.companies) {
			const pick = live.company && !live.company.disabled && live.company.value ? live.company.value : setup().companyId;
			// The seat is kept only when it was chosen from this company's own roster.
			const seat = live.seat && !live.seat.disabled && live.seat.value ? { seatAgentId: live.seat.value } : {};
			change({ companyId: pick, ...seat, step: order[i + 1] ?? step });
		}
		if (i === order.length - 1) finish();
		else go(order[i + 1]);
	});
	shut.addEventListener('click', close);
	// On the backdrop too, so Escape works wherever focus has wandered while the form is open.
	back.addEventListener('keydown', trap);
	button.addEventListener('click', () => open());

	return {
		el: back,
		button,
		get isOpen() { return isOpen; },
		open,
		close,
		update() {
			const nag = wanted() && !setup().founded;
			button.classList.toggle('p67-nag', nag);
			setText(button, !nag ? (wanted() ? '★ Ministry' : '★ Founding form') : ministryState() === 'standing' ? '★ Ministry needs a fix' : '★ Ministry not yet founded');
			if (!isOpen) return;
			if (step === 'connect') { paintSeat(); paintEmpty(); paintFoot(); }
			if (step === 'inspection') paintChecks();
			// The Ministry page says founded, set up or not yet: redraw it when that changes.
			if (step === 'ministry' && ministryState() !== ministryShown) render();
		},
	};
}
