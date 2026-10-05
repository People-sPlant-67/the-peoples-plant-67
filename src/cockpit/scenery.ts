/**
 * The menus in the scenery: the radiogram, noticeboard, Pravda, telephone and the
 * plant's name on the wall. Resting the pointer on one (or reaching it with Tab) outlines it in
 * gold, gives it one small wobble and shows a label; clicking it (or Enter) opens what it holds.
 * Invisible buttons over each one carry the keyboard. The noticeboard shows Paperclip's counts on
 * its slips; while Paperclip cannot be reached, the telephone rings and the emergency lamp above the
 * board flashes; and a small note card opens beside a fixture for the ones that only have words to say.
 */
import { Sprite, Texture } from 'pixi.js';
import type { Scene } from '../art/scene';
import type { Portrait } from '../art/archetypes';
import { type FixtureId, type Patch, fixturePatches, lampPatch, ministryPatch, noticeboardPatch, portraitPatch } from '../world/zones';
import type { Cam, Size } from './camera';
import { el, setText } from './dom';
import { FIXTURE_ORDER, LAMP_FLASH_MS, LAMP_GLOW, fixtureAt, glow, outline, ringAt, ringMarks, wobbleAt } from './fixtures';
import type { Stage } from './stage';

/** The prop each fixture belongs to, for depth (the noticeboard and the name are on the wall). */
const HOST: Record<FixtureId, string | null> = { radiogram: 'dir-radio', pravda: 'dir-desk', telephone: 'dir-desk', noticeboard: null, plaque: null, toolWall: null };
/** Fixtures that are the whole of their prop, so the live sprite (which can change) is what wobbles. */
const WHOLE = new Set<FixtureId>(['radiogram']);

/**
 * Where a card of a given size goes beside a box: to its right, or to its left where the right
 * has no room; level with its top; kept inside the view.
 *
 * @param b The box, stage pixels.
 * @param size The card's size.
 * @param v The view's size.
 * @returns The card's top-left corner, whole pixels.
 */
export function beside(b: { left: number; top: number; right: number; bottom: number }, size: { w: number; h: number }, v: Size): { x: number; y: number } {
	const right = b.right + 16, left = b.left - 16 - size.w;
	const x = right + size.w <= v.w - 8 || left < 8 ? right : left;
	return { x: Math.round(Math.max(8, Math.min(x, v.w - size.w - 8))), y: Math.round(Math.max(8, Math.min(b.top - 10, v.h - size.h - 8))) };
}

export interface SceneryDeps {
	stage: Stage;
	scene: Scene;
	/** The element the stage is drawn in: pointer moves over it are watched. */
	stageEl: HTMLElement;
	cam(): Cam;
	view(): Size;
	/** The comrade at a world point, if any: one standing in front is pointed at, not the thing behind. */
	comradeAt(at: { x: number; y: number }): string | null;
	/** The words shown beside a fixture, and read by a screen reader on its button. */
	label(id: FixtureId): string;
	/**
	 * Open what a fixture holds.
	 *
	 * @param id Fixture.
	 * @param opener The button that opened it (keyboard), for focus to come back to; null for the pointer.
	 */
	open(id: FixtureId, opener: HTMLElement | null): void;
	/** Glide the camera to a world point (a fixture reached with Tab while off screen). */
	glideTo(p: { x: number; y: number }): void;
	/** True when the owner asked for less motion: no wobble, no hopping telephone. */
	reducedMotion?(): boolean;
	/** Makes a texture from a patch (tests pass a stand-in; the default draws it on a canvas). */
	makeTexture?(p: Patch): Texture;
}

export interface Scenery {
	/** The keyboard's buttons, the label and the note card, for the cockpit root. */
	els: HTMLElement[];
	/**
	 * The fixture at a world point.
	 *
	 * @param at World pixels.
	 * @returns Fixture, or null.
	 */
	hit(at: { x: number; y: number }): FixtureId | null;
	/**
	 * Ring the telephone and flash the emergency lamp, or stop.
	 *
	 * @param on True while Paperclip cannot be reached.
	 */
	setRinging(on: boolean): void;
	readonly ringing: boolean;
	/**
	 * Write Paperclip's counts on the noticeboard's slips.
	 *
	 * @param counts Inbox, approvals and failed runs; none to leave the slips blank.
	 */
	setCounts(counts: (number | null)[] | null): void;
	/**
	 * Hang another portrait in the owner's frame, over the one the wall was built with.
	 *
	 * @param inside The portrait's inside.
	 */
	setPortrait(inside: Portrait): void;
	/**
	 * Hang the Ministry's plaque (founded) or its nagging poster, over what the wall was built with.
	 *
	 * @param founded Whether the inspection has passed.
	 */
	setFounded(founded: boolean): void;
	/**
	 * Show the note card beside a fixture.
	 *
	 * @param id Fixture.
	 * @param title Heading.
	 * @param lines Sentences.
	 * @param opener The button to give focus back to when it closes.
	 */
	showNote(id: FixtureId, title: string, lines: string[], opener: HTMLElement | null): void;
	/**
	 * Change what the open note says, leaving it where it is.
	 *
	 * @param title Heading.
	 * @param lines Sentences.
	 */
	updateNote(title: string, lines: string[]): void;
	/** The fixture whose note is open, or null. */
	readonly noteFor: FixtureId | null;
	/**
	 * Close the note card.
	 *
	 * @param refocus Give focus back to the button that opened it (a close from the keyboard).
	 * @returns True when it was open.
	 */
	closeNote(refocus?: boolean): boolean;
	/** Where a fixture's top middle is on screen (CSS pixels in the stage). */
	anchor(id: FixtureId): { x: number; y: number };
	/** A fixture's box on screen (CSS pixels in the stage), for a panel to open beside. */
	box(id: FixtureId): { left: number; top: number; right: number; bottom: number };
	/** The button for a fixture (scripted checks). */
	button(id: FixtureId): HTMLButtonElement;
	/** The fixture outlined now, by the pointer or the keyboard. */
	readonly active: FixtureId | null;
	/** Move the wobble and the ring along, and keep the buttons, label and note on their fixtures. Call after the depth sort. */
	tick(dt: number): void;
}

/**
 * A patch as a texture.
 *
 * @param p Patch.
 * @returns Texture.
 */
function texture(p: Patch): Texture {
	const c = document.createElement('canvas');
	c.width = p.w; c.height = p.h;
	c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.w, p.h), 0, 0);
	return Texture.from(c);
}

/**
 * A sprite for a patch, placed where it sits.
 *
 * @param p Patch.
 * @param make Makes its texture.
 * @returns Hidden sprite.
 */
function sprite(p: Patch, make: (p: Patch) => Texture): Sprite {
	const s = new Sprite(make(p));
	s.position.set(p.x, p.y);
	s.visible = false;
	return s;
}

/**
 * Put the fixtures on the stage.
 *
 * @param d Dependencies.
 * @returns Scenery.
 */
export function createScenery(d: SceneryDeps): Scenery {
	const patches = fixturePatches(d.scene);
	const reduced = d.reducedMotion ?? (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
	const make = d.makeTexture ?? texture;

	// Per fixture: a copy of its pixels (moved by the wobble and the ring) and its outline. Desk and
	// radiogram things sit in the depth-sorted layer just above their prop, so a comrade in front still
	// covers them; wall things sit on the wall.
	const parts = new Map<FixtureId, { copy: Sprite; ring: Sprite; host: string | null }>();
	for (const id of FIXTURE_ORDER) {
		const host = HOST[id];
		const copy = sprite(patches[id], make);
		const ring = sprite(outline(patches[id]), make);
		(host ? d.stage.layer : d.stage.wall).addChild(copy, ring);
		parts.set(id, { copy, ring, host });
	}
	// The telephone's glow under its copy, and its ring marks over it.
	const halo = sprite(glow(patches.telephone), make);
	const marks = sprite(ringMarks(patches.telephone), make);
	d.stage.layer.addChild(halo, marks);
	// The emergency lamp, lit, with its glow on the wall around it: shown in turns while the line is down.
	const lampLit = lampPatch(d.scene.base, true);
	const lampGlow = sprite(glow(lampLit, LAMP_GLOW.r, LAMP_GLOW.alpha), make);
	const lamp = sprite(lampLit, make);
	d.stage.wall.addChild(lampGlow, lamp);
	// The counts, painted over the blank board.
	const blankBoard = parts.get('noticeboard')!.copy.texture;
	const board = new Sprite(Texture.EMPTY);
	board.visible = false;
	d.stage.wall.addChildAt(board, 0);

	// The owner's portrait and the Ministry's notice, when they change while the plant runs: solid
	// signs the same size as the ones built into the wall, so each covers its old one exactly.
	const portrait = new Sprite(Texture.EMPTY);
	const notice = new Sprite(Texture.EMPTY);
	portrait.visible = notice.visible = false;
	// Under everything else on the wall (just above the board's counts), so the lamp stays on top.
	d.stage.wall.addChildAt(portrait, 1);
	d.stage.wall.addChildAt(notice, 1);
	/**
	 * Show a patch on a wall sprite, freeing the texture it had.
	 *
	 * @param sp Sprite.
	 * @param p Patch.
	 */
	const hangOver = (sp: Sprite, p: Patch): void => {
		const old = sp.texture;
		sp.texture = make(p);
		sp.position.set(p.x, p.y);
		sp.visible = true;
		if (old !== Texture.EMPTY) old.destroy(true);
	};

	const holder = el('div', 'p67-fixtures');
	const buttons = new Map<FixtureId, HTMLButtonElement>();
	const label = el('div', 'p67-fixture-label');
	label.hidden = true;
	label.setAttribute('aria-hidden', 'true');
	const note = el('section', 'p67-propnote');
	note.hidden = true;
	note.setAttribute('role', 'dialog');
	note.tabIndex = -1;
	const noteHead = el('h3');
	const noteBody = el('div', 'p67-propnote-body');
	const noteClose = el('button', 'p67-close', '×');
	noteClose.type = 'button';
	noteClose.setAttribute('aria-label', 'Close the note');
	note.append(noteClose, noteHead, noteBody);

	let hovered: FixtureId | null = null;
	let focused: FixtureId | null = null;
	let shown: FixtureId | null = null;
	/** When the outlined fixture's wobble began (ms of the plant's clock). */
	let wobbleFrom = -Infinity;
	let clock = 0;
	let ringing = false;
	let ringFrom = 0;
	let counts = '';
	let noteFor: FixtureId | null = null;
	let noteOpener: HTMLElement | null = null;
	/** The pointer moved onto a fixture more recently than the keyboard did: its fixture is outlined. */
	let pointerLast = false;
	/** The label's words and the label's and note's sizes, measured when their words change, not every frame. */
	let labelWords = '';
	let labelSize = { w: 0, h: 0 };
	let noteSize = { w: 0, h: 0 };

	/**
	 * World pixels to stage pixels.
	 *
	 * @param x X.
	 * @param y Y.
	 * @returns Point.
	 */
	const toScreen = (x: number, y: number): { x: number; y: number } => {
		const c = d.cam();
		return { x: (x - c.x) * c.zoom, y: (y - c.y) * c.zoom };
	};

	/** Outline the fixture the keyboard or the pointer is on (whichever moved last), and wobble it once. */
	const outlineActive = (): void => {
		const next = pointerLast ? hovered ?? focused : focused ?? hovered;
		if (next === shown) return;
		shown = next;
		wobbleFrom = clock;
		for (const [id, p] of parts) p.ring.visible = id === shown;
		label.hidden = !shown;
	};

	for (const id of FIXTURE_ORDER) {
		const b = el('button', 'p67-fixture');
		b.type = 'button';
		b.setAttribute('aria-label', d.label(id));
		b.addEventListener('focus', (e) => {
			focused = id;
			pointerLast = false;
			outlineActive();
			// Reached with Tab while off screen: bring it into view. Not when focus comes back from the
			// note or panel it opened: the owner has moved on, and the plant should stay where it is.
			if ((e.relatedTarget as Element | null)?.closest?.('[role=dialog]')) return;
			const p = patches[id], v = d.view(), s = toScreen(p.x + p.w / 2, p.y + p.h / 2);
			if (s.x < 0 || s.y < 0 || s.x > v.w || s.y > v.h) d.glideTo({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
		});
		b.addEventListener('blur', () => { if (focused === id) { focused = null; outlineActive(); } });
		b.addEventListener('click', () => d.open(id, b));
		buttons.set(id, b);
		holder.append(b);
	}

	d.stageEl.addEventListener('pointermove', (e) => {
		// Not while a button is held: that is a drag across the plant, and the camera has the cursor.
		if (e.buttons) {
			if (hovered) { hovered = null; outlineActive(); }
			return;
		}
		const r = d.stageEl.getBoundingClientRect(), c = d.cam();
		const at = { x: c.x + (e.clientX - r.left) / c.zoom, y: c.y + (e.clientY - r.top) / c.zoom };
		const id = d.comradeAt(at) ? null : fixtureAt(patches, at);
		if (id === hovered) return;
		hovered = id;
		if (id) pointerLast = true;
		d.stageEl.style.cursor = id ? 'pointer' : '';
		outlineActive();
	});
	d.stageEl.addEventListener('pointerleave', () => {
		if (!hovered) return;
		hovered = null;
		d.stageEl.style.cursor = '';
		outlineActive();
	});

	/**
	 * Close the note.
	 *
	 * @param refocus Give focus back to whatever opened it (closed from the keyboard or its own button).
	 * @returns True when it was open.
	 */
	const closeNote = (refocus = false): boolean => {
		if (note.hidden) return false;
		note.hidden = true;
		noteFor = null;
		if (refocus) noteOpener?.focus();
		noteOpener = null;
		return true;
	};
	noteClose.addEventListener('click', () => closeNote(true));
	note.addEventListener('keydown', (e) => {
		// Keys stay in the note: the cockpit's own keys would pan the plant behind it.
		e.stopPropagation();
		if (e.key === 'Escape') closeNote(true);
	});

	/**
	 * Write the note's heading and sentences, only where they changed.
	 *
	 * @param title Heading.
	 * @param lines Sentences.
	 */
	const write = (title: string, lines: string[]): void => {
		setText(noteHead, title);
		note.setAttribute('aria-label', title);
		if (lines.join('\n') !== Array.from(noteBody.children, (p) => p.textContent).join('\n')) noteBody.replaceChildren(...lines.map((s) => el('p', '', s)));
		if (!note.hidden) noteSize = { w: note.offsetWidth, h: note.offsetHeight };
	};

	/** Place the label and the note beside the fixture they belong to, inside the stage. */
	const place = (): void => {
		const v = d.view();
		if (shown) {
			const words = d.label(shown);
			if (words !== labelWords || !labelSize.w) {
				labelWords = words;
				setText(label, words);
				labelSize = { w: label.offsetWidth, h: label.offsetHeight };
			}
			const a = anchor(shown);
			label.style.transform = `translate(${Math.round(Math.max(4, Math.min(a.x - labelSize.w / 2, v.w - labelSize.w - 4)))}px, ${Math.round(Math.max(4, a.y - labelSize.h - 8))}px)`;
		}
		if (noteFor) {
			const at = beside(box(noteFor), noteSize, v);
			note.style.transform = `translate(${at.x}px, ${at.y}px)`;
		}
	};

	/**
	 * Where a fixture's top middle is on screen.
	 *
	 * @param id Fixture.
	 * @returns Stage pixels.
	 */
	function anchor(id: FixtureId): { x: number; y: number } {
		const p = patches[id];
		return toScreen(p.x + p.w / 2, p.y);
	}

	/**
	 * A fixture's box on screen.
	 *
	 * @param id Fixture.
	 * @returns Stage pixels.
	 */
	function box(id: FixtureId): { left: number; top: number; right: number; bottom: number } {
		const p = patches[id], tl = toScreen(p.x, p.y), br = toScreen(p.x + p.w, p.y + p.h);
		return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
	}

	return {
		els: [holder, label, note],
		hit: (at) => fixtureAt(patches, at),
		setRinging(on) {
			if (on === ringing) return;
			ringing = on;
			ringFrom = clock;
			halo.visible = on;
			if (!on) { marks.visible = false; lamp.visible = false; lampGlow.visible = false; }
		},
		get ringing() { return ringing; },
		setPortrait(inside) { hangOver(portrait, portraitPatch(d.scene.base, inside)); },
		setFounded(f) { hangOver(notice, ministryPatch(d.scene.base, f)); },
		setCounts(c) {
			const key = c ? c.join(',') : '';
			if (key === counts) return;
			counts = key;
			const old = board.texture;
			const copy = parts.get('noticeboard')!.copy;
			if (!c) { board.visible = false; board.texture = Texture.EMPTY; copy.texture = blankBoard; }
			else {
				const p = noticeboardPatch(d.scene.base, c);
				board.texture = make(p);
				board.position.set(p.x, p.y);
				board.visible = true;
				// The wobbling copy carries the numbers too.
				copy.texture = board.texture;
			}
			if (old !== Texture.EMPTY) old.destroy(true);
		},
		showNote(id, title, lines, opener) {
			noteFor = id;
			noteOpener = opener;
			note.hidden = false;
			write(title, lines);
			place();
			// From the keyboard, into the note, so Escape and the close button are at hand.
			if (opener) note.focus();
		},
		updateNote: write,
		get noteFor() { return noteFor; },
		closeNote,
		anchor,
		box,
		button: (id) => buttons.get(id)!,
		get active() { return shown; },
		tick(dt) {
			clock += dt;
			const still = reduced();
			for (const [id, p] of parts) {
				const host = p.host ? d.stage.props.get(p.host) : null;
				const ring = id === 'telephone' ? (ringing ? ringAt(clock - ringFrom) : null) : null;
				const dx = id === shown && !still ? wobbleAt(clock - wobbleFrom) : 0;
				const hop = ring && !still ? ring.hop : 0;
				// The copy only shows while it is out of place (or ringing): otherwise the prop itself is there.
				p.copy.visible = dx !== 0 || hop !== 0;
				const at = patches[id];
				// The radiogram's copy is its live sprite's picture, so a lit dial stays lit as it wobbles.
				if (WHOLE.has(id) && host) { p.copy.texture = host.texture; p.copy.position.set(host.x + dx, host.y - hop); }
				else p.copy.position.set(at.x + dx, at.y - hop);
				p.ring.position.set(at.x - 1 + dx, at.y - 1 - hop);
				if (host) { p.copy.zIndex = host.zIndex + 0.25; p.ring.zIndex = host.zIndex + 0.5; }
				if (id === 'telephone') {
					halo.zIndex = (host?.zIndex ?? 0) + 0.2;
					marks.zIndex = (host?.zIndex ?? 0) + 0.6;
					marks.visible = !!ring && (still || ring.marks);
				}
			}
			// Flashing once a second; lit and still for those who asked for less motion.
			const lit = ringing && (still || Math.floor((clock - ringFrom) / LAMP_FLASH_MS) % 2 === 0);
			lamp.visible = lit;
			lampGlow.visible = lit;
			// The keyboard's buttons sit over their fixtures, so a screen magnifier follows the focus.
			for (const [id, b] of buttons) {
				const p = patches[id], a = toScreen(p.x, p.y), z = d.cam().zoom;
				b.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
				b.style.width = `${Math.round(p.w * z)}px`;
				b.style.height = `${Math.round(p.h * z)}px`;
				const words = d.label(id);
				if (b.getAttribute('aria-label') !== words) b.setAttribute('aria-label', words);
			}
			place();
		},
	};
}
