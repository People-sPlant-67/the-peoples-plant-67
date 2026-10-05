/**
 * Furnishing: the mode the Repair Brigade's tool wall opens. A drawer along the bottom
 * holds the catalogue. A piece is dragged from it onto the floor, or a poster onto a back wall,
 * and anything decorative already in the plant is dragged to move it. While something is held,
 * the tiles under it glow green where it fits and red where it does not, and a line says why.
 * ⟲ or R turns a piece; × or Delete takes it away (one of the plant's own goes back to its
 * place). "Put everything back" returns the plant to how it was built; Done closes the drawer.
 * The comrades carry on working throughout.
 *
 * The keyboard does it all too. The tile cursor comes first in the tab order: the arrows move it
 * (or what is held), Enter picks up what is under it or puts down what is held, R turns, Delete
 * takes away, Escape lets go and then closes. Enter on a drawer item picks it up at the cursor.
 */
import { Graphics, Sprite, Texture } from 'pixi.js';
import { drawText } from '../art/font';
import { type Facing, PIECE_KINDS, PIECE_NAMES, POSTER_KINDS, POSTER_NAMES, type PieceKind, type PosterKind, pieceFoot } from '../art/furniture';
import { project } from '../art/render';
import type { Footprint } from '../art/scene';
import type { V3 } from '../art/sdf';
import {
	type Layout, MISFIT_WORDS, type Misfit, type Put, POSTER_TOP, emptyLayout, fits, floorAt, homeFree, posterArt, posterFits, posterRects,
	roomFor, shifted, tilesUnder, wallPointAt, withPut, without,
} from '../world/layout';
import { tileCentre } from '../world/path';
import type { WallRect, WallSpot, World } from '../world/types';
import { HOME_POSTERS, MOVABLE_NAMES, MOVABLE_PROPS, WALL_LEN, WORLD_H, WORLD_W, wallRect, zoneAt } from '../world/zones';
import { type Cam, type Size, viewToWorld } from './camera';
import { bitmapCanvas, el, setText } from './dom';
import type { Furnishings } from './furnishings';
import { textureOf } from '../preview/textures';
import type { Stage } from './stage';

/** What furnishing needs from the cockpit. */
export interface FurnishDeps {
	world: World;
	stage: Pick<Stage, 'layer' | 'wall' | 'props'>;
	/** The stage's element: furnishing takes presses on the furniture before the camera can pan. */
	stageEl: HTMLElement;
	furnishings: Furnishings;
	cam(): Cam;
	view(): Size;
	glideTo(p: { x: number; y: number }): void;
	/** Where comrades are now: nothing is put down on anyone. */
	standing(): V3[];
	/** The layout changed: keep it. */
	save(layout: Layout): void;
	/** Furnishing opened: anything else open closes. */
	onOpen?(): void;
	/** Furnishing closed. */
	onClose?(): void;
	/** Make a texture from pixels; tests pass one that needs no canvas. */
	makeTexture?(w: number, h: number, rgba: Uint8ClampedArray): Texture;
	/** A new id for a piece or poster; tests pass a counter. */
	newId?(): string;
}

/** Furnishing, for the cockpit. */
export interface Furnish {
	/** The drawer, the floating buttons and the note, for the cockpit root. */
	readonly els: HTMLElement[];
	readonly active: boolean;
	/** Open furnishing (the tool wall was clicked). */
	open(opener: HTMLElement | null): void;
	/** Close it, letting go of anything held. */
	close(): void;
	/**
	 * A click on the stage that was not a drag, while furnishing: select what is there, or nothing.
	 *
	 * @param at Base-layer pixels.
	 */
	click(at: { x: number; y: number }): void;
	/** A key while furnishing; true when furnishing used it. */
	key(e: KeyboardEvent): boolean;
	/** Keep the glow, the ghost and the buttons in place. Call after the depth sort. */
	tick(dt: number): void;
	/** What is going on, for checks. */
	state(): { active: boolean; held: string | null; misfit: Misfit | null; selected: string | null; cursor: [number, number] };
}

/** What is picked up. */
interface Held {
	type: Put['type'];
	/** Its id: an existing thing's, or a new one's. */
	id: string;
	/** True while it is new from the drawer. */
	fresh: boolean;
	/** A piece's kind, a poster's kind, or one of the plant's own ids. */
	kind: string;
	facing: Facing;
	/** Base-layer pixels from the pointer to where it stands (floor) or its middle (wall). */
	offset: { x: number; y: number };
	/** Where it would go now. */
	tile: [number, number] | null;
	spot: WallSpot | null;
	misfit: Misfit | null;
	/** Moved by the pointer (it follows it) or the keyboard (it follows the cursor). */
	by: 'pointer' | 'keys';
}

/** Pixels a press may move before it is a drag. */
const SLOP = 4;
/** The glow's colours. */
const GOOD = 0x6fcf5a, BAD = 0xd8463a, CURSOR = 0xf4d27a;

/**
 * A poster drawn flat, lettering and all, for the drawer.
 *
 * @param kind Poster.
 * @returns Canvas.
 */
function posterThumb(kind: PosterKind): HTMLCanvasElement {
	const s = posterArt(kind);
	const b = s.b.map((r) => [...r]);
	for (const t of s.texts) drawText(t.s, t.x, t.y, (i, j) => { if (b[j]?.[i] !== undefined) b[j][i] = t.col; });
	return bitmapCanvas(b, 1);
}

/**
 * Set up furnishing, closed.
 *
 * @param d Dependencies.
 * @returns Furnishing.
 */
export function createFurnish(d: FurnishDeps): Furnish {
	const { world, stage, stageEl, furnishings: fx } = d;
	const base = world.scene.base;
	const L = world.tile;
	const makeTexture = d.makeTexture ?? textureOf;
	let counter = 0;
	const newId = d.newId ?? (() => `f${Date.now().toString(36)}-${(counter++).toString(36)}`);

	let active = false;
	let held: Held | null = null;
	let selected: string | null = null;
	let cursor: [number, number] = [3, 3];
	/** The facing a new piece starts with: the last one used. */
	let facing: Facing = 0;
	let opener: HTMLElement | null = null;
	/** A press on something in the plant, until it becomes a drag or a click. */
	let press: { pointer: number; x: number; y: number; id: string } | null = null;
	/** A press on a drawer item, until it becomes a drag or a click. */
	let drawerPress: { pointer: number; x: number; y: number; kind: string; poster: boolean; dragged: boolean } | null = null;
	/** The pointer over the stage, in its own pixels, or null. */
	let pointer: { x: number; y: number } | null = null;

	// The stage: the glow on the floor and walls, and the ghost of what is held.
	const glow = new Graphics();
	const ghost = new Sprite(Texture.EMPTY);
	ghost.alpha = 0.8;
	ghost.zIndex = 1e6;
	const wallGhost = new Sprite(Texture.EMPTY);
	wallGhost.alpha = 0.85;
	let wallGhostKey = '';

	// The drawer.
	const bar = el('section', 'p67-furnish');
	bar.hidden = true;
	bar.setAttribute('aria-label', 'Furnishing');
	const head = el('div', 'p67-furnish-head');
	const title = el('h2', 'p67-furnish-title', 'Furnishing');
	const hint = el('p', 'p67-furnish-hint', 'Drag a piece onto the floor or a poster onto a back wall. Drag anything decorative to move it; R turns a piece.');
	const cursorBtn = el('button', 'p67-furnish-cursor', 'Tile cursor');
	cursorBtn.type = 'button';
	cursorBtn.setAttribute('aria-label', 'Tile cursor: the right and left arrows move it along one side of the floor tiles, up and down along the other; Enter picks up what is here or puts down what you hold, R turns, Delete takes away.');
	head.append(title, hint, cursorBtn);
	const items = el('div', 'p67-furnish-items');
	const piecesRow = el('div', 'p67-furnish-row');
	piecesRow.setAttribute('role', 'group');
	piecesRow.setAttribute('aria-label', 'Pieces');
	const postersRow = el('div', 'p67-furnish-row');
	postersRow.setAttribute('role', 'group');
	postersRow.setAttribute('aria-label', 'Posters');
	items.append(piecesRow, postersRow);
	const actions = el('div', 'p67-furnish-actions');
	const resetBtn = el('button', 'p67-furnish-reset', 'Put everything back');
	resetBtn.type = 'button';
	const doneBtn = el('button', 'p67-furnish-done', 'Done');
	doneBtn.type = 'button';
	actions.append(resetBtn, doneBtn);
	const live = el('div', 'p67-sr');
	live.setAttribute('aria-live', 'polite');
	bar.append(head, items, actions, live);
	// Over the plant: the selected thing's buttons, and the note that says why something will not go.
	const controls = el('div', 'p67-furnish-controls');
	controls.hidden = true;
	const turnBtn = el('button', 'p67-furnish-turn', '⟲');
	turnBtn.type = 'button';
	turnBtn.setAttribute('aria-label', 'Turn it');
	const removeBtn = el('button', 'p67-furnish-remove', '×');
	removeBtn.type = 'button';
	controls.append(turnBtn, removeBtn);
	const note = el('div', 'p67-furnish-note');
	note.hidden = true;
	note.setAttribute('aria-hidden', 'true');

	/**
	 * A drawer item.
	 *
	 * @param kind Piece or poster kind.
	 * @param poster True for a poster.
	 * @returns Button.
	 */
	const item = (kind: string, poster: boolean): HTMLButtonElement => {
		const b = el('button', 'p67-furnish-item');
		b.type = 'button';
		b.dataset.kind = kind;
		const name = poster ? POSTER_NAMES[kind as PosterKind] : PIECE_NAMES[kind as PieceKind];
		b.setAttribute('aria-label', poster ? `Poster: ${name}` : name);
		b.title = name;
		if (poster) b.append(posterThumb(kind as PosterKind));
		b.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			drawerPress = { pointer: e.pointerId, x: e.clientX, y: e.clientY, kind, poster, dragged: false };
			b.setPointerCapture?.(e.pointerId);
		});
		b.addEventListener('pointermove', (e) => {
			if (!drawerPress || drawerPress.pointer !== e.pointerId) return;
			if (!drawerPress.dragged && Math.hypot(e.clientX - drawerPress.x, e.clientY - drawerPress.y) > SLOP) {
				drawerPress.dragged = true;
				pickNew(kind, poster, 'pointer');
			}
			if (held) follow(local(e));
		});
		b.addEventListener('pointerup', (e) => {
			if (!drawerPress || drawerPress.pointer !== e.pointerId) return;
			const dragged = drawerPress.dragged;
			drawerPress = null;
			if (b.hasPointerCapture?.(e.pointerId)) b.releasePointerCapture(e.pointerId);
			if (!dragged) return;
			// Let go over the plant: put it down; over the drawer or off the stage: put it back.
			const p = local(e), v = d.view();
			const over = document.elementFromPoint?.(e.clientX, e.clientY);
			if (p.x < 0 || p.y < 0 || p.x > v.w || p.y > v.h || (over && bar.contains(over))) cancel();
			else drop();
			b.dataset.dragged = '1';
		});
		b.addEventListener('click', (e) => {
			// A drag ends in a click too: it has already been dealt with.
			if (b.dataset.dragged) { delete b.dataset.dragged; return; }
			// Enter again on the item held by the keyboard puts it down.
			if (held?.fresh && held.kind === kind && held.by === 'keys') { drop(); return; }
			// A click from the keyboard has no count (detail 0): the piece starts at the tile cursor.
			pickNew(kind, poster, e.detail > 0 ? 'pointer' : 'keys');
			if (held?.by === 'keys') cursorBtn.focus();
		});
		return b;
	};
	for (const k of PIECE_KINDS) piecesRow.append(item(k, false));
	for (const k of POSTER_KINDS) postersRow.append(item(k, true));

	/** Draw the pieces' pictures into the drawer as they arrive from the workers. */
	const fillThumbs = (): void => {
		for (const b of Array.from(piecesRow.querySelectorAll<HTMLButtonElement>('.p67-furnish-item'))) {
			if (b.querySelector('canvas')) continue;
			const t = fx.texture(b.dataset.kind as PieceKind, 0, fillThumbs);
			if (!t) continue;
			const c = document.createElement('canvas');
			c.width = t.px.w; c.height = t.px.h;
			c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(t.px.rgba), t.px.w, t.px.h), 0, 0);
			b.prepend(c);
		}
	};

	/**
	 * A pointer event's point in the stage's own pixels.
	 *
	 * @param e Event.
	 * @returns Point.
	 */
	const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
		const r = stageEl.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	/**
	 * Base-layer pixels to the stage's own.
	 *
	 * @param x X.
	 * @param y Y.
	 * @returns Point.
	 */
	const toScreen = (x: number, y: number): { x: number; y: number } => {
		const c = d.cam();
		return { x: (x - c.x) * c.zoom, y: (y - c.y) * c.zoom };
	};
	/**
	 * Say something to screen readers.
	 *
	 * @param s Sentence.
	 */
	const say = (s: string): void => { live.textContent = ''; live.textContent = s; };

	/**
	 * The tile a footprint's middle is on.
	 *
	 * @param f Footprint.
	 * @returns Tile.
	 */
	const middleTile = (f: Footprint): [number, number] => [Math.floor((f.x0 + f.x1) / 2 / L), Math.floor((f.y0 + f.y1) / 2 / L)];
	/**
	 * Where one of the plant's own props stands, by tile, as built.
	 *
	 * @param id Prop.
	 * @returns Tile.
	 */
	const homeTile = (id: string): [number, number] => middleTile(fx.home.get(id)!);
	/**
	 * The poster spot a poster kind takes: the plant's own keep their height.
	 *
	 * @param kind Poster kind or the plant's own id.
	 * @param wall Wall.
	 * @param at Middle along it.
	 * @returns Spot.
	 */
	const spotFor = (kind: string, wall: WallSpot['wall'], at: number): WallSpot => ({ wall, at: Math.round(at / (L / 4)) * (L / 4), zTop: HOME_POSTERS.find((h) => h.id === kind)?.spot.zTop ?? POSTER_TOP });
	/**
	 * Where a held thing would stand or hang, by its own rules.
	 *
	 * @param h Held.
	 * @returns Footprint or the room on the wall.
	 */
	const footOf = (h: Held): Footprint | null => {
		if (!h.tile) return null;
		if (h.type === 'piece') return pieceFoot(h.kind as PieceKind, h.facing, tileCentre(world, h.tile[0], h.tile[1]));
		if (h.type === 'prop') { const t = homeTile(h.id); return shifted(fx.home.get(h.id)!, [h.tile[0] - t[0], h.tile[1] - t[1]], L); }
		return null;
	};
	/**
	 * The room a held poster would take on its wall.
	 *
	 * @param h Held.
	 * @returns Room, or null when it is off the walls.
	 */
	const rectOf = (h: Held): WallRect | null => (h.spot ? wallRect(posterArt(h.kind), h.spot) : null);

	/**
	 * Check what is held where it is now.
	 *
	 * @param h Held.
	 */
	const check = (h: Held): void => {
		const was = h.misfit;
		if (h.type === 'poster' || h.type === 'homePoster') {
			const r = rectOf(h);
			if (!r) h.misfit = 'wall';
			else {
				const others = [...posterRects(fx.layout)].filter(([k]) => k !== h.id).map(([, v]) => v);
				h.misfit = posterFits(world, r, others);
			}
		} else {
			const f = footOf(h);
			const now = fx.feet().get(h.id);
			const home = h.type === 'prop' ? fx.home.get(h.id) : undefined;
			const same = (a: Footprint | undefined): boolean => !!f && !!a && f.x0 === a.x0 && f.y0 === a.y0 && f.x1 === a.x1 && f.y1 === a.y1;
			// Put down where it already stands: always fine. One of the plant's own going home only needs it clear.
			if (same(now)) h.misfit = null;
			else if (same(home)) h.misfit = homeFree(fx.feet(), h.id, home!, d.standing());
			else h.misfit = f ? fits(world, fx.feet(), h.id, f, d.standing()) : 'floor';
		}
		if (h.misfit && h.misfit !== was) say(MISFIT_WORDS[h.misfit]);
		else if (!h.misfit && was) say('It fits here.');
	};

	/**
	 * Pick up something new from the drawer.
	 *
	 * @param kind Piece or poster kind.
	 * @param poster True for a poster.
	 * @param by What moves it.
	 */
	function pickNew(kind: string, poster: boolean, by: Held['by']): void {
		if (!active) return;
		cancel(false);
		if (!roomFor(fx.layout, poster)) { say(poster ? 'There is no room for more posters.' : 'There is no room for more pieces.'); return; }
		held = { type: poster ? 'poster' : 'piece', id: newId(), fresh: true, kind, facing, offset: { x: 0, y: poster ? 0 : 18 }, tile: null, spot: null, misfit: null, by };
		select(null);
		if (by === 'keys') moveHeldToCursor();
		else if (pointer) follow(pointer);
		say(`Holding ${poster ? `the poster ${POSTER_NAMES[kind as PosterKind]}` : PIECE_NAMES[kind as PieceKind].toLowerCase()}.`);
	}

	/**
	 * Pick up something already in the plant.
	 *
	 * @param id Thing.
	 * @param by What moves it.
	 * @param at Where the pointer took hold, base-layer pixels.
	 */
	function pickUp(id: string, by: Held['by'], at?: { x: number; y: number }): void {
		const piece = fx.layout.pieces.find((p) => p.id === id);
		const poster = fx.layout.posters.find((p) => p.id === id);
		const home = HOME_POSTERS.find((h) => h.id === id);
		let h: Held;
		if (piece) h = { type: 'piece', id, fresh: false, kind: piece.kind, facing: piece.facing, offset: { x: 0, y: 0 }, tile: piece.tile, spot: null, misfit: null, by };
		else if (poster || home) {
			const spot = poster?.spot ?? fx.layout.hung[id] ?? home!.spot;
			h = { type: poster ? 'poster' : 'homePoster', id, fresh: false, kind: poster?.kind ?? id, facing: 0, offset: { x: 0, y: 0 }, tile: null, spot, misfit: null, by };
		} else if (MOVABLE_PROPS.includes(id)) h = { type: 'prop', id, fresh: false, kind: id, facing: 0, offset: { x: 0, y: 0 }, tile: middleTile(fx.feet().get(id)!), spot: null, misfit: null, by };
		else return;
		if (at) {
			// Keep hold of it where it was grabbed, so it does not jump to the pointer.
			if (h.tile) {
				const [ax, ay] = project(base, tileCentre(world, h.tile[0], h.tile[1]));
				h.offset = { x: ax - at.x, y: ay - at.y };
			} else if (h.spot) {
				const r = wallRect(posterArt(h.kind), h.spot);
				const mid: V3 = h.spot.wall === 'ne' ? [h.spot.at, 0, (r.z0 + r.z1) / 2] : [0, h.spot.at, (r.z0 + r.z1) / 2];
				const [mx, my] = project(base, mid);
				h.offset = { x: mx - at.x, y: my - at.y };
			}
		}
		held = h;
		select(null);
		fx.setHeld(id);
		check(h);
	}

	/**
	 * Move what is held to follow the pointer.
	 *
	 * @param p Pointer, stage pixels.
	 */
	function follow(p: { x: number; y: number }): void {
		if (!held) return;
		const at = viewToWorld(d.cam(), p);
		const x = at.x + held.offset.x, y = at.y + held.offset.y;
		if (held.type === 'poster' || held.type === 'homePoster') {
			const w = wallPointAt(base, x, y);
			const spot = w ? spotFor(held.kind, w.wall, w.at) : null;
			if (spot?.wall === held.spot?.wall && spot?.at === held.spot?.at) return;
			held.spot = spot;
		} else {
			const f = floorAt(base, x, y);
			const tile: [number, number] = [Math.floor(f[0] / L), Math.floor(f[1] / L)];
			if (held.tile && tile[0] === held.tile[0] && tile[1] === held.tile[1]) return;
			held.tile = tile;
		}
		check(held);
	}

	/** Put a piece held by the keyboard on the cursor (a poster on the wall nearest it). */
	function moveHeldToCursor(): void {
		if (!held) return;
		if (held.type === 'poster' || held.type === 'homePoster') {
			const wall = cursor[1] <= cursor[0] ? 'ne' : 'nw';
			held.spot = spotFor(held.kind, wall, ((wall === 'ne' ? cursor[0] : cursor[1]) + 0.5) * L);
		} else held.tile = [cursor[0], cursor[1]];
		check(held);
	}

	/**
	 * Let go of what is held without putting it down.
	 *
	 * @param announce Say so.
	 */
	function cancel(announce = true): void {
		// A press on the plant still under way must not pick it up again on the next move. (A press on
		// the drawer stays: picking a new piece lets go of the old one first, mid-press.)
		press = null;
		if (!held) return;
		held = null;
		fx.setHeld(null);
		if (announce) say('Put back where it was.');
	}

	/** Put down what is held, if it fits; otherwise it goes back, and the note says why. */
	function drop(): void {
		const h = held;
		if (!h) return;
		check(h);
		if (h.misfit || (!h.tile && !h.spot)) {
			say(h.misfit ? `${MISFIT_WORDS[h.misfit]} It was not put down.` : 'It was not put down.');
			cancel(false);
			return;
		}
		let put: Put;
		if (h.type === 'piece') put = { type: 'piece', piece: { id: h.id, kind: h.kind as PieceKind, tile: h.tile!, facing: h.facing } };
		else if (h.type === 'prop') { const t = homeTile(h.id); put = { type: 'prop', id: h.id, by: [h.tile![0] - t[0], h.tile![1] - t[1]] }; }
		else if (h.type === 'poster') put = { type: 'poster', poster: { id: h.id, kind: h.kind as PosterKind, spot: h.spot! } };
		else put = { type: 'homePoster', id: h.id, spot: h.spot! };
		held = null;
		fx.setHeld(null);
		commit(withPut(fx.layout, put));
		if (h.type === 'piece') facing = h.facing;
		select(h.id);
		say('Put down.');
	}

	/**
	 * Show and keep a layout.
	 *
	 * @param l Layout.
	 */
	function commit(l: Layout): void {
		fx.set(l);
		d.save(l);
		if (undo) { undo = null; setText(resetBtn, 'Put everything back'); }
	}

	/**
	 * Select something in the plant (its buttons show), or nothing.
	 *
	 * @param id Thing, or null.
	 */
	function select(id: string | null): void {
		selected = id;
		controls.hidden = !id;
		if (!id) return;
		const piece = fx.layout.pieces.some((p) => p.id === id);
		turnBtn.hidden = !piece;
		const own = MOVABLE_PROPS.includes(id) || HOME_POSTERS.some((h) => h.id === id);
		removeBtn.setAttribute('aria-label', own ? 'Put it back where it was' : 'Take it away');
		removeBtn.title = removeBtn.getAttribute('aria-label')!;
		removeBtn.disabled = own && !fx.layout.moved[id] && !fx.layout.hung[id];
	}

	/**
	 * Turn a piece a quarter: the one held, else the one given.
	 *
	 * @param id Piece in the plant, when nothing is held.
	 */
	function turn(id: string | null): void {
		if (held) {
			if (held.type !== 'piece') { say('Only pieces from the drawer turn.'); return; }
			held.facing = ((held.facing + 1) % 4) as Facing;
			check(held);
			return;
		}
		const p = fx.layout.pieces.find((q) => q.id === id);
		if (!p) { if (id) say('Only pieces from the drawer turn.'); return; }
		const next = { ...p, facing: ((p.facing + 1) % 4) as Facing };
		const why = fits(world, fx.feet(), p.id, pieceFoot(next.kind, next.facing, tileCentre(world, p.tile[0], p.tile[1])), d.standing());
		if (why) { say(`It cannot turn there. ${MISFIT_WORDS[why]}`); flash(p.tile); return; }
		commit(withPut(fx.layout, { type: 'piece', piece: next }));
		facing = next.facing;
		say('Turned.');
	}

	/**
	 * Take something away: a catalogue piece or poster goes, one of the plant's own goes home.
	 *
	 * @param id Thing.
	 */
	function remove(id: string | null): void {
		if (!id) return;
		press = null;
		if (held?.id === id) { held = null; fx.setHeld(null); }
		const own = MOVABLE_PROPS.includes(id) || HOME_POSTERS.some((h) => h.id === id);
		if (own && !fx.layout.moved[id] && !fx.layout.hung[id]) { say('It is already where it began.'); return; }
		if (MOVABLE_PROPS.includes(id) && fx.layout.moved[id]) {
			const why = homeFree(fx.feet(), id, fx.home.get(id)!, d.standing());
			if (why) { say(`It cannot go back yet. ${MISFIT_WORDS[why]}`); return; }
		}
		if (HOME_POSTERS.some((h) => h.id === id) && fx.layout.hung[id]) {
			const home = HOME_POSTERS.find((h) => h.id === id)!;
			const others = [...posterRects(fx.layout)].filter(([k]) => k !== id).map(([, v]) => v);
			const why = posterFits(world, wallRect(home.sign(), home.spot), others);
			if (why) { say(`It cannot go back yet. ${MISFIT_WORDS[why]}`); return; }
		}
		commit(without(fx.layout, id));
		select(null);
		say(own ? 'Put back where it was.' : 'Taken away.');
	}

	/** A misfit shown on the floor for a moment after a refused turn. */
	let flashing: { tile: [number, number]; t: number } | null = null;
	/**
	 * Show a refused tile red for a moment.
	 *
	 * @param tile Tile.
	 */
	function flash(tile: [number, number]): void { flashing = { tile, t: 900 }; }

	/**
	 * What is under the cursor tile: a piece or prop on it, else a poster on the wall it touches.
	 *
	 * @returns Thing, or null.
	 */
	function thingAtCursor(): string | null {
		const [cx, cy] = cursor;
		const piece = fx.layout.pieces.find((p) => p.tile[0] === cx && p.tile[1] === cy);
		if (piece) return piece.id;
		const feet = fx.feet();
		for (const id of MOVABLE_PROPS) {
			const f = feet.get(id);
			if (f && tilesUnder(f, L).some(([x, y]) => x === cx && y === cy)) return id;
		}
		for (const [id, r] of posterRects(fx.layout)) {
			const along = r.wall === 'ne' ? (cy === 0 ? cx : -99) : (cx === 0 ? cy : -99);
			if (r.a0 < (along + 1) * L && r.a1 > along * L) return id;
		}
		return null;
	}

	/**
	 * Move the cursor (and what the keyboard holds) by a tile, and keep it in view.
	 *
	 * @param dx Tiles along screen x.
	 * @param dy Tiles along screen y.
	 */
	function nudge(dx: number, dy: number): void {
		if (held && (held.type === 'poster' || held.type === 'homePoster')) {
			// Along the walls with right and left: screen right runs up the north-east wall and back down the north-west.
			if (!dx) return;
			const s = held.spot ?? spotFor(held.kind, 'ne', L / 2);
			let along = (s.wall === 'ne' ? s.at : -s.at) + dx * (L / 2);
			const wall = along >= 0 ? 'ne' : 'nw';
			along = Math.max(-WALL_LEN.nw, Math.min(WALL_LEN.ne, along));
			held.spot = spotFor(held.kind, wall, Math.abs(along));
			held.by = 'keys';
			check(held);
			const r = wallRect(posterArt(held.kind), held.spot);
			const [x, y] = project(base, held.spot.wall === 'ne' ? [held.spot.at, 0, r.z0] : [0, held.spot.at, r.z0]);
			keepInView(x, y);
			return;
		}
		// Along the floor's own lines, so every tile can be reached: right and left run along x (down
		// to the right, up to the left), down and up along y (down to the left, up to the right).
		cursor = [Math.max(0, Math.min(WORLD_W - 1, cursor[0] + dx)), Math.max(0, Math.min(WORLD_H - 1, cursor[1] + dy))];
		if (held) { held.by = 'keys'; moveHeldToCursor(); }
		const [x, y] = project(base, tileCentre(world, cursor[0], cursor[1]));
		keepInView(x, y);
		const here = thingAtCursor();
		const zone = zoneAt(cursor[0], cursor[1]);
		if (!held) say(here ? `${nameOf(here)} is here.` : zone ? `${world.zones[zone].label}.` : 'Off the floor.');
	}

	/**
	 * Glide the camera when a point gets near the edge of the view.
	 *
	 * @param x Base-layer x.
	 * @param y Base-layer y.
	 */
	function keepInView(x: number, y: number): void {
		const s = toScreen(x, y), v = d.view();
		if (s.x < 80 || s.y < 80 || s.x > v.w - 80 || s.y > v.h - 200) d.glideTo({ x, y });
	}

	/**
	 * What a thing in the plant is called.
	 *
	 * @param id Thing.
	 * @returns Name.
	 */
	function nameOf(id: string): string {
		const p = fx.layout.pieces.find((q) => q.id === id);
		if (p) return PIECE_NAMES[p.kind];
		const q = fx.layout.posters.find((x) => x.id === id);
		if (q) return `The poster ${POSTER_NAMES[q.kind]}`;
		return MOVABLE_NAMES[id] ?? HOME_POSTERS.find((h) => h.id === id)?.name ?? 'Something';
	}

	// Presses on the furniture are furnishing's; the rest pan the plant as ever.
	stageEl.addEventListener('pointerdown', (e) => {
		if (!active || e.button !== 0) return;
		const p = local(e), at = viewToWorld(d.cam(), p);
		pointer = p;
		if (held) {
			// Held by a click on the drawer: this press puts it down where it is let go.
			e.stopPropagation();
			held.by = 'pointer';
			press = { pointer: e.pointerId, x: p.x, y: p.y, id: held.id };
			stageEl.setPointerCapture?.(e.pointerId);
			return;
		}
		const id = fx.thingAt(at.x, at.y);
		if (!id) return;
		e.stopPropagation();
		press = { pointer: e.pointerId, x: p.x, y: p.y, id };
		stageEl.setPointerCapture?.(e.pointerId);
	}, { capture: true });
	stageEl.addEventListener('pointermove', (e) => {
		if (!active) return;
		const p = local(e);
		pointer = p;
		if (press && press.pointer === e.pointerId && !held && Math.hypot(p.x - press.x, p.y - press.y) > SLOP) pickUp(press.id, 'pointer', viewToWorld(d.cam(), { x: press.x, y: press.y }));
		if (held && held.by === 'pointer') follow(p);
		else if (!press) {
			const at = viewToWorld(d.cam(), p);
			stageEl.style.cursor = fx.thingAt(at.x, at.y) ? 'grab' : '';
		}
	});
	stageEl.addEventListener('pointerup', (e) => {
		if (!active || !press || press.pointer !== e.pointerId) return;
		const id = press.id;
		// Done with the press before the capture goes, so losing it is not taken for a cancelled press.
		press = null;
		if (stageEl.hasPointerCapture?.(e.pointerId)) stageEl.releasePointerCapture(e.pointerId);
		if (held) { follow(local(e)); drop(); return; }
		select(id);
	});
	stageEl.addEventListener('pointerleave', () => { pointer = null; });
	/**
	 * A press the browser took away (a touch turned into a scroll, the capture lost): let go.
	 *
	 * @param e Event.
	 */
	const lost = (e: PointerEvent): void => {
		if (!active || (press?.pointer !== e.pointerId && drawerPress?.pointer !== e.pointerId)) return;
		const pointerHeld = held?.by === 'pointer';
		press = null;
		drawerPress = null;
		if (pointerHeld) cancel();
	};
	stageEl.addEventListener('pointercancel', lost);
	stageEl.addEventListener('lostpointercapture', lost);
	piecesRow.addEventListener('pointercancel', lost);
	postersRow.addEventListener('pointercancel', lost);

	turnBtn.addEventListener('click', () => turn(selected));
	removeBtn.addEventListener('click', () => remove(selected));
	/** What Put everything back took away, until something else changes: the button undoes it. */
	let undo: Layout | null = null;
	resetBtn.addEventListener('click', () => {
		cancel(false);
		select(null);
		if (undo) {
			const was = undo;
			commit(was);
			say('Put back as it was furnished.');
			return;
		}
		const was = fx.layout;
		commit(emptyLayout());
		undo = was;
		setText(resetBtn, 'Undo putting everything back');
		say('Everything is back where it began. The button now undoes that.');
	});
	doneBtn.addEventListener('click', () => api.close());
	cursorBtn.addEventListener('click', () => {
		// Enter or Space on the cursor (or a click on it): put down what is held, or pick up what is here.
		if (held) { held.by = 'keys'; moveHeldToCursor(); drop(); return; }
		const id = thingAtCursor();
		if (id) { pickUp(id, 'keys'); say(`Holding ${nameOf(id).toLowerCase()}.`); }
		else say('There is nothing here to pick up.');
	});

	/**
	 * Draw a tile's diamond on the floor.
	 *
	 * @param g Graphics.
	 * @param tx Tile x.
	 * @param ty Tile y.
	 * @param fill Colour, or null for an outline.
	 * @param alpha Opacity.
	 */
	const diamond = (g: Graphics, tx: number, ty: number, fill: number | null, alpha: number): void => {
		const pts = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]].flatMap(([x, y]) => project(base, [x * L, y * L, 0]).slice(0, 2));
		g.poly(pts);
		// A solid edge as well as the wash: a wash alone is lost on the Canteen's red and cream tiles.
		if (fill === null) g.stroke({ color: CURSOR, width: 1, alpha });
		else g.fill({ color: fill, alpha }).stroke({ color: fill, width: 1.5, alpha: 1 });
	};

	const api: Furnish = {
		els: [bar, controls, note],
		get active() { return active; },
		open(from) {
			if (active) return;
			active = true;
			opener = from;
			d.onOpen?.();
			bar.hidden = false;
			stage.wall.addChild(glow, wallGhost);
			stage.layer.addChild(ghost);
			fillThumbs();
			// The cursor starts in the middle of the view.
			const c = d.cam(), v = d.view();
			const f = floorAt(base, c.x + v.w / 2 / c.zoom, c.y + v.h / 2 / c.zoom);
			cursor = [Math.max(0, Math.min(WORLD_W - 1, Math.floor(f[0] / L))), Math.max(0, Math.min(WORLD_H - 1, Math.floor(f[1] / L)))];
			cursorBtn.focus();
			say('Furnishing. Tab to the drawer to pick a piece, or use the arrow keys and Enter on the plant.');
		},
		close() {
			if (!active) return;
			cancel(false);
			select(null);
			active = false;
			press = null;
			bar.hidden = true;
			note.hidden = true;
			glow.clear();
			glow.removeFromParent();
			ghost.removeFromParent();
			wallGhost.removeFromParent();
			stageEl.style.cursor = '';
			if (undo) { undo = null; setText(resetBtn, 'Put everything back'); }
			d.onClose?.();
			opener?.focus();
			opener = null;
		},
		click(at) {
			if (!active) return;
			select(fx.thingAt(at.x, at.y));
		},
		key(e) {
			if (!active || e.ctrlKey || e.metaKey || e.altKey) return false;
			const t = e.target as HTMLElement | null;
			if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return false;
			const k = e.key;
			if (k === 'Escape') { if (held) cancel(); else api.close(); return true; }
			if (k === 'r' || k === 'R') { turn(selected ?? thingAtCursor()); return true; }
			if (k === 'Delete' || k === 'Backspace') {
				if (held?.fresh) cancel();
				else remove(held?.id ?? selected ?? thingAtCursor());
				return true;
			}
			const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
			if (dirs[k]) { nudge(...dirs[k]); e.preventDefault(); return true; }
			return false;
		},
		tick(dt) {
			if (!active) return;
			glow.clear();
			ghost.visible = false;
			wallGhost.visible = false;
			// The keyboard's cursor.
			if (!held || held.by === 'keys') diamond(glow, cursor[0], cursor[1], null, 0.9);
			if (flashing) {
				flashing.t -= dt;
				diamond(glow, flashing.tile[0], flashing.tile[1], BAD, 0.45);
				if (flashing.t <= 0) flashing = null;
			}
			let noteAt: { x: number; y: number } | null = null;
			if (held) {
				const colour = held.misfit ? BAD : GOOD;
				if (held.type === 'poster' || held.type === 'homePoster') {
					if (held.spot) {
						const r = wallRect(posterArt(held.kind), held.spot);
						const corner = (a: number, z: number): V3 => (r.wall === 'ne' ? [a, 0, z] : [0, a, z]);
						const pts = [corner(r.a0, r.z1), corner(r.a1, r.z1), corner(r.a1, r.z0), corner(r.a0, r.z0)].flatMap((p) => project(base, p).slice(0, 2));
						glow.poly(pts).fill({ color: colour, alpha: 0.3 }).stroke({ color: colour, width: 1, alpha: 0.9 });
						const key = `${held.kind}@${held.spot.wall}${held.spot.at}`;
						if (key !== wallGhostKey) {
							const patch = fx.posterPatch(held.kind, held.spot);
							const old = wallGhost.texture;
							wallGhost.texture = makeTexture(patch.w, patch.h, patch.rgba);
							if (old !== Texture.EMPTY) old.destroy(true);
							wallGhost.position.set(patch.x, patch.y);
							wallGhostKey = key;
						}
						wallGhost.visible = true;
						stage.wall.addChild(wallGhost);
						noteAt = { x: pts[0], y: pts[1] };
					}
				} else if (held.tile) {
					const f = footOf(held);
					for (const [x, y] of f ? tilesUnder(f, L) : [held.tile]) diamond(glow, x, y, colour, 0.5);
					const [ax, ay] = project(base, tileCentre(world, held.tile[0], held.tile[1]));
					if (held.type === 'piece') {
						const t = fx.texture(held.kind as PieceKind, held.facing);
						if (t) { ghost.texture = t.tex; ghost.position.set(Math.round(ax) - t.ax, Math.round(ay) - t.ay); ghost.visible = true; }
						noteAt = { x: ax, y: ay - (t?.ay ?? 60) };
					} else {
						const sp = stage.props.get(held.id);
						const now = fx.feet().get(held.id)!, [cx, cy] = middleTile(now);
						const [ox, oy] = project(base, tileCentre(world, cx, cy));
						if (sp) { ghost.texture = sp.texture; ghost.position.set(sp.x + Math.round(ax - ox), sp.y + Math.round(ay - oy)); ghost.visible = true; }
						noteAt = { x: ax, y: ay - 70 };
					}
				}
				// Whatever is held draws over everything standing.
				stage.layer.addChild(ghost);
			}
			// The note says why it will not go.
			const why = held?.misfit ? MISFIT_WORDS[held.misfit] : '';
			setText(note, why);
			note.hidden = !why || !noteAt;
			if (noteAt && why) {
				const s = toScreen(noteAt.x, noteAt.y);
				note.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y - 34)}px) translateX(-50%)`;
			}
			// The selected thing's buttons sit over it.
			if (selected && !held) {
				const b = fx.boxOf(selected);
				if (!b) { controls.hidden = true; return; }
				controls.hidden = false;
				const s = toScreen(b.x + b.w / 2, b.y);
				controls.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(Math.max(4, s.y - 30))}px) translateX(-50%)`;
			} else controls.hidden = true;
		},
		state: () => ({ active, held: held?.id ?? null, misfit: held?.misfit ?? null, selected, cursor: [cursor[0], cursor[1]] }),
	};
	return api;
}
