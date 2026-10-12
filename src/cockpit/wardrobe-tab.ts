/**
 * The Wardrobe tab on the name card: the comrade turning slowly in what you are
 * choosing, a row per part with ‹ › arrows and a cloth picker, the extras as switches, and three
 * buttons: Keep (they go and change at the cloakroom), Back to their own, and Surprise me (a random
 * look to start from; nothing is kept until Keep). The preview is drawn by the sprite workers.
 */
import type { Dir } from '../art/avatar';
import { HEADWEAR_NAME, type Outfit, TORSO_NAME, colourName } from '../art/outfits';
import type { MaterialName } from '../art/palette';
import type { SpritePixels } from '../art/sprite-job';
import { el } from './dom';
import { EXTRAS, FACES, type Garment, HATS, LEGS, type Look, MOUTHS, SCARVES, SHIRTS, TOPS, WORDS, lookKey, lookOf, normalLook, surprise, wear, withExtra } from './wardrobe';

/** The preview turns through these, one every TURN_MS. */
const TURN: readonly Dir[] = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
export const TURN_MS = 900;
/** The part of a sprite frame the preview shows, and how much bigger. */
const CROP = { x: 14, y: 6, w: 56, h: 94 };
const ZOOM = 2;

/** What the tab needs from the cockpit. */
export interface WardrobeTabDeps {
	/**
	 * Render one standing frame of an outfit.
	 *
	 * @param o Outfit.
	 * @param dir Which way it faces.
	 * @returns Pixels.
	 */
	render(o: Outfit, dir: Dir): Promise<SpritePixels>;
	/** Stop rendering an outfit nobody is looking at any more. */
	forget(outfitId: string): void;
	/** The comrade's own outfit (bespoke or from the bank). */
	own(agentId: string): Outfit | null;
	/** The look kept for them, or null. */
	kept(agentId: string): Look | null;
	/** Keep a look: they go and change. */
	keep(agentId: string, look: Look): void;
	/** Forget their look: they go and change back into their own. */
	reset(agentId: string): void;
	/** Seeds for Surprise me (injectable for tests). */
	random?(): number;
	/** True when the owner asked for less motion: the preview stands still. */
	reducedMotion?(): boolean;
}

/** The Wardrobe tab, for the name card. */
export interface WardrobeTab {
	el: HTMLElement;
	/** Show a comrade's wardrobe, or nobody's. */
	open(agentId: string | null): void;
	/** Turn the preview. */
	tick(dt: number): void;
	/** The look being chosen (scripted checks). */
	readonly draft: Look | null;
}

/**
 * Build the Wardrobe tab.
 *
 * @param d Dependencies.
 * @returns The tab.
 */
export function createWardrobeTab(d: WardrobeTabDeps): WardrobeTab {
	const root = el('div', 'p67-wardrobe');
	const canvas = el('canvas', 'p67-wardrobe-preview');
	canvas.width = CROP.w * ZOOM;
	canvas.height = CROP.h * ZOOM;
	canvas.setAttribute('role', 'img');
	const rows = el('div', 'p67-wardrobe-rows');
	const extras = el('fieldset', 'p67-wardrobe-extras');
	const legend = el('legend', '', 'Extras');
	extras.append(legend);
	const actions = el('div', 'p67-wardrobe-actions');
	const keep = el('button', 'p67-wardrobe-keep', 'Keep');
	keep.type = 'button';
	const back = el('button', '', 'Back to their own');
	back.type = 'button';
	const surp = el('button', '', 'Surprise me');
	surp.type = 'button';
	actions.append(keep, back, surp);
	const note = el('p', 'p67-wardrobe-note', 'Kept looks are saved on this computer only. On Keep, they go to the cloakroom in the Palace of Culture to change.');
	// What a choice became, read aloud: the rows are drawn afresh on every change, and a live region
	// drawn afresh is not announced.
	const said = el('p', 'p67-sr');
	said.setAttribute('aria-live', 'polite');
	const top = el('div', 'p67-wardrobe-top');
	top.append(canvas, rows);
	root.append(top, extras, actions, note, said);
	const reduced = d.reducedMotion ?? (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
	/** Preview frames drawn for the outfit shown, by direction, so the turn does not render them again. */
	let cache = new Map<Dir, HTMLCanvasElement>();

	let agentId: string | null = null;
	let own: Outfit | null = null;
	let draft: Look | null = null;
	let shown: Outfit | null = null;
	let turn = 0, turnT = 0;
	/** A newer draw supersedes any older one still in a worker. */
	let drawn = 0;

	/** Draw the preview for the draft, facing the way it has turned to. */
	const paint = (): void => {
		if (!own || !draft) return;
		const o = wear(own, draft);
		if (shown && shown.id !== o.id) { d.forget(shown.id); cache = new Map(); }
		shown = o;
		const n = ++drawn;
		const dir = TURN[turn];
		canvas.setAttribute('aria-label', `${own.label}: ${describe(draft)}`);
		/**
		 * Put a rendered frame on the preview.
		 *
		 * @param img The frame.
		 */
		const show = (img: HTMLCanvasElement): void => {
			const g = canvas.getContext('2d');
			if (!g) return;
			g.imageSmoothingEnabled = false;
			g.clearRect(0, 0, canvas.width, canvas.height);
			g.drawImage(img, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, CROP.w * ZOOM, CROP.h * ZOOM);
		};
		const hit = cache.get(dir);
		if (hit) { show(hit); return; }
		void d.render(o, dir).then((px) => {
			const img = document.createElement('canvas');
			img.width = px.w; img.height = px.h;
			img.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px.rgba), px.w, px.h), 0, 0);
			if (shown?.id === o.id) cache.set(dir, img);
			if (n === drawn) show(img);
		}, () => { /* Dropped for a newer look: nothing to draw. */ });
	};

	/**
	 * One part's row: its name, ‹ the choice ›, and a cloth picker when the choice has cloths.
	 *
	 * @param label Part.
	 * @param options How many choices.
	 * @param index The draft's choice now.
	 * @param name Words for a choice.
	 * @param choose Put a choice in the draft.
	 * @param cloths The cloths for the choice now, and the draft's cloth, or null.
	 * @param pickCloth Put a cloth in the draft.
	 * @returns Row.
	 */
	const row = (
		label: string, options: number, index: number, name: (k: number) => string, choose: (k: number) => void,
		cloths: { list: readonly MaterialName[]; now: MaterialName } | null, pickCloth: (m: MaterialName) => void,
	): HTMLElement => {
		const r = el('div', 'p67-wardrobe-row');
		const lab = el('span', 'p67-wardrobe-label', label);
		const prev = el('button', 'p67-wardrobe-arrow', '‹');
		prev.type = 'button';
		prev.setAttribute('aria-label', `Previous ${label.toLowerCase()}`);
		const next = el('button', 'p67-wardrobe-arrow', '›');
		next.type = 'button';
		next.setAttribute('aria-label', `Next ${label.toLowerCase()}`);
		const val = el('span', 'p67-wardrobe-value', name(index));
		val.title = name(index);
		/**
		 * Choose, redraw, and say what was chosen.
		 *
		 * @param k Choice.
		 * @param focus Control to focus again.
		 */
		const go = (k: number, focus: string): void => { choose(k); refresh(focus); said.textContent = `${label}: ${name(k)}.`; };
		prev.addEventListener('click', () => go((index + options - 1) % options, `${label}-prev`));
		next.addEventListener('click', () => go((index + 1) % options, `${label}-next`));
		r.append(lab, prev, val, next);
		if (cloths && cloths.list.length > 1) {
			const sel = el('select', 'p67-wardrobe-cloth');
			sel.setAttribute('aria-label', `${label} cloth`);
			const list = cloths.list.includes(cloths.now) ? cloths.list : [cloths.now, ...cloths.list];
			for (const m of list) { const opt = el('option', '', cap(colourName(m))); opt.value = m; sel.append(opt); }
			sel.value = cloths.now;
			sel.addEventListener('change', () => { pickCloth(sel.value as MaterialName); refresh(`${label}-cloth`); });
			r.append(sel);
		} else if (cloths) r.append(el('span', 'p67-wardrobe-only', cap(colourName(cloths.now))));
		return r;
	};

	/**
	 * A cloth for a garment: the one the draft had if the garment comes in it, else its first.
	 *
	 * @param g Garment.
	 * @param now The draft's cloth.
	 * @returns Cloth.
	 */
	const clothFor = <K extends string>(g: Garment<K>, now: MaterialName): MaterialName => (g.cloths.includes(now) || !g.cloths.length ? now : g.cloths[0]);

	/**
	 * Redraw the rows and buttons for the draft, and the preview; focus goes back to the control used.
	 *
	 * @param focus Key of the control to focus again.
	 */
	function refresh(focus?: string): void {
		const l = draft;
		rows.replaceChildren();
		extras.replaceChildren(legend);
		if (!l || !own || !agentId) { paint(); return; }
		const hat = HATS.findIndex((h) => h.kind === l.headwear);
		const top = TOPS.findIndex((t) => t.kind === l.torso);
		const legs = LEGS.findIndex((g) => g.kind === l.legs);
		/**
		 * Put a row in, keyed so focus can find it again.
		 *
		 * @param key Part.
		 * @param r Row.
		 */
		const add = (key: string, r: HTMLElement): void => {
			r.dataset.key = key;
			rows.append(r);
		};
		add('Hat', row('Hat', HATS.length, Math.max(0, hat), (k) => (HATS[k].kind === 'none' ? 'No hat' : cap(HEADWEAR_NAME[HATS[k].kind as Exclude<typeof l.headwear, 'none'>])),
			(k) => { l.headwear = HATS[k].kind; l.hatMat = clothFor(HATS[k], l.hatMat); },
			HATS[Math.max(0, hat)].cloths.length ? { list: HATS[Math.max(0, hat)].cloths, now: l.hatMat } : null, (m) => { l.hatMat = m; }));
		add('Top', row('Top', TOPS.length, Math.max(0, top), (k) => cap(TORSO_NAME[TOPS[k].kind]),
			(k) => { l.torso = TOPS[k].kind; l.torsoMat = clothFor(TOPS[k], l.torsoMat); },
			{ list: TOPS[Math.max(0, top)].cloths, now: l.torsoMat }, (m) => { l.torsoMat = m; }));
		// A shirt shows under overalls and an open lab coat.
		if (l.torso === 'overalls' || l.torso === 'labcoat') {
			add('Shirt', row('Shirt', SHIRTS.length, Math.max(0, SHIRTS.indexOf(l.shirtMat)), (k) => cap(colourName(SHIRTS[k])), (k) => { l.shirtMat = SHIRTS[k]; }, null, () => {}));
		}
		// Overalls are one garment: the legs are the bib's cloth.
		if (l.torso !== 'overalls') {
			add('Legs', row('Legs', LEGS.length, Math.max(0, legs), (k) => WORDS.legs[LEGS[k].kind],
				(k) => { l.legs = LEGS[k].kind; l.legsMat = clothFor(LEGS[k], l.legsMat); },
				{ list: LEGS[Math.max(0, legs)].cloths, now: l.legsMat }, (m) => { l.legsMat = m; }));
		}
		add('Face', row('Face', FACES.length, Math.max(0, FACES.indexOf(l.face)), (k) => WORDS.face[FACES[k]], (k) => { l.face = FACES[k]; }, null, () => {}));
		add('Mouth', row('Mouth', MOUTHS.length, Math.max(0, MOUTHS.indexOf(l.mouth)), (k) => WORDS.mouth[MOUTHS[k] ?? 'none'], (k) => { l.mouth = MOUTHS[k]; }, null, () => {}));
		add('Scarf', row('Scarf', SCARVES.length, Math.max(0, SCARVES.indexOf(l.scarf)), (k) => (SCARVES[k] ? cap(colourName(SCARVES[k]!)) : 'None'), (k) => { l.scarf = SCARVES[k]; }, null, () => {}));
		for (const e of EXTRAS) {
			const lab = el('label', 'p67-wardrobe-extra');
			const box = el('input');
			box.type = 'checkbox';
			box.checked = l.extras.includes(e);
			box.dataset.key = `extra-${e}`;
			box.addEventListener('change', () => {
				l.extras = withExtra(l.extras, e, box.checked);
				refresh(`extra-${e}`);
				said.textContent = `${WORDS.extras[e]}: ${box.checked ? 'on' : 'off'}.`;
			});
			lab.append(box, document.createTextNode(WORDS.extras[e]));
			extras.append(lab);
		}
		const kept = d.kept(agentId);
		const now = kept ? lookKey(kept) : lookKey(lookOf(own));
		keep.disabled = lookKey(l) === now;
		back.disabled = !kept;
		if (focus) {
			const [key, part] = focus.split('-');
			const target = focus.startsWith('extra-')
				? extras.querySelector<HTMLElement>(`[data-key="${focus}"]`)
				: rows.querySelector<HTMLElement>(`[data-key="${key}"] ${part === 'prev' ? '.p67-wardrobe-arrow' : part === 'next' ? '.p67-wardrobe-arrow:last-of-type' : 'select'}`);
			target?.focus();
		}
		paint();
	}

	keep.addEventListener('click', () => {
		if (!agentId || !draft) return;
		d.keep(agentId, normalLook(draft));
		said.textContent = 'Kept. They are off to the cloakroom to change.';
		refresh();
	});
	back.addEventListener('click', () => {
		if (!agentId || !own) return;
		d.reset(agentId);
		draft = lookOf(own);
		refresh();
		said.textContent = 'Back to their own. They are off to the cloakroom to change.';
	});
	surp.addEventListener('click', () => {
		draft = surprise(Math.floor((d.random ?? Math.random)() * 2 ** 31));
		refresh();
		said.textContent = `A surprise: ${describe(draft)}`;
	});

	return {
		el: root,
		open(id) {
			if (id === agentId) return;
			if (shown) d.forget(shown.id);
			shown = null;
			cache = new Map();
			agentId = id;
			own = id ? d.own(id) : null;
			const kept = id ? d.kept(id) : null;
			draft = own ? (kept ? { ...kept, extras: [...kept.extras] } : lookOf(own)) : null;
			turn = 0;
			turnT = 0;
			refresh();
		},
		tick(dt) {
			if (!agentId || root.offsetParent === null || reduced()) return;
			turnT += dt;
			if (turnT < TURN_MS) return;
			turnT = 0;
			turn = (turn + 1) % TURN.length;
			paint();
		},
		get draft() { return draft; },
	};
}

/**
 * Capitalise the first letter.
 *
 * @param s Words.
 * @returns Words.
 */
function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A look in words, for the preview's label.
 *
 * @param l Look.
 * @returns Sentence.
 */
function describe(l: Look): string {
	const hat = l.headwear === 'none' ? 'no hat' : `a ${colourName(l.hatMat)} ${HEADWEAR_NAME[l.headwear]}`;
	const extras = l.extras.length ? `, with ${l.extras.map((e) => WORDS.extras[e].toLowerCase()).join(', ')}` : '';
	return `${hat}, a ${colourName(l.torsoMat)} ${TORSO_NAME[l.torso]}${l.torso === 'overalls' ? '' : ` and ${WORDS.legs[l.legs].toLowerCase()}`}${extras}.`;
}
