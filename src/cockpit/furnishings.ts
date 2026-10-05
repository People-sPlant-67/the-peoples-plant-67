/**
 * The furniture in the plant: keeps the world, its scene and the stage in step with a
 * layout. Pieces from the catalogue are props like any other, so the depth sort, the pathfinder
 * and the walkability grid all see them; their pictures come from the sprite workers, one per
 * kind and turn. The plant's own movable props slide by whole tiles. Posters hang as sprites on
 * the wall layer, and the plant's own two are lifted off the base layer while they hang elsewhere.
 */
import { Sprite, Texture } from 'pixi.js';
import { textureOf } from '../preview/textures';
import type { Facing, PieceKind } from '../art/furniture';
import { type Frame, project } from '../art/render';
import type { Footprint, Prop } from '../art/scene';
import type { SpritePixels } from '../art/sprite-job';
import { type Layout, emptyLayout, feetOf, posterArt } from '../world/layout';
import { tileCentre } from '../world/path';
import type { Patch, WallSpot, World } from '../world/types';
import { MOVABLE_PROPS, OWN_PIECES, walkableFor, wallPatch } from '../world/zones';
import type { Usable } from './breaks';
import type { Stage } from './stage';

/** What the furniture needs from the cockpit. */
export interface FurnishingsDeps {
	world: World;
	stage: Pick<Stage, 'layer' | 'wall' | 'props' | 'refreshBase'>;
	/** A piece's pixels, turned, from the sprite workers; `top` is where it stands. */
	piece(kind: PieceKind, facing: Facing): Promise<SpritePixels>;
	/** Something stands somewhere new: the crew go round it. */
	refloor(): void;
	/** Make a texture from pixels; tests pass one that needs no canvas. */
	makeTexture?(w: number, h: number, rgba: Uint8ClampedArray): Texture;
}

/** A piece's picture, ready to draw. */
export interface PieceTexture {
	tex: Texture;
	/** Where it stands, in its own pixels. */
	ax: number;
	ay: number;
	/** Its pixels, for hit-testing. */
	px: SpritePixels;
}

/** The furniture, for the furnishing mode and the cockpit. */
export interface Furnishings {
	/** The layout shown. */
	readonly layout: Layout;
	/** Every prop's footprint as the plant was built. */
	readonly home: ReadonlyMap<string, Footprint>;
	/** Show a layout. It must already fit (see settle and fits). */
	set(layout: Layout): void;
	/** Everything standing now, by id. */
	feet(): Map<string, Footprint>;
	/** A piece's picture, or null while it is being drawn (it is asked for, and onReady says when). */
	texture(kind: PieceKind, facing: Facing, onReady?: () => void): PieceTexture | null;
	/** A poster's pixels hung at a spot. */
	posterPatch(kind: string, spot: WallSpot): Patch;
	/** What stands or hangs at a point on the base layer that furnishing can pick up, front-most first; null for nothing. */
	thingAt(x: number, y: number): string | null;
	/** Where a placed thing stands or hangs, on the base layer: its box. */
	boxOf(id: string): { x: number; y: number; w: number; h: number } | null;
	/** Fade a placed thing while it is picked up (the plant's own posters, part of the wall, stay). */
	setHeld(id: string | null): void;
	/** Every soda machine and chess table standing now, the plant's own and the owner's. */
	usable(): Usable[];
}

/**
 * Whether pixels are painted at a point.
 *
 * @param px Pixels and their size.
 * @param i Column.
 * @param j Row.
 * @returns True on a painted pixel.
 */
const solid = (px: { w: number; h: number; rgba: Uint8ClampedArray }, i: number, j: number): boolean => i >= 0 && j >= 0 && i < px.w && j < px.h && px.rgba[(j * px.w + i) * 4 + 3] > 0;

/**
 * Set up the furniture, showing the plant as built.
 *
 * @param d Dependencies.
 * @returns Furniture.
 */
export function createFurnishings(d: FurnishingsDeps): Furnishings {
	const { world, stage } = d;
	const makeTexture = d.makeTexture ?? textureOf;
	const scene = world.scene;
	const base = scene.base;
	const L = world.tile;
	const home = new Map(scene.props.map((p) => [p.id, p.foot]));
	const homeAt = new Map(scene.props.filter((p) => MOVABLE_PROPS.includes(p.id)).map((p) => [p.id, { x: p.x, y: p.y }]));
	/** A piece prop's stand-in frame: the cockpit draws pieces from textures, never from a frame. */
	const stub: Frame = { w: 1, h: 1, ax: 0, ay: 0, rgba: new Uint8ClampedArray(4), depth: new Float32Array(1), group: new Int16Array(1).fill(-1), groups: [], view: base.view };
	const textures = new Map<string, PieceTexture | Promise<void>>();
	/** Who is waiting for each picture. */
	const waiting = new Map<string, (() => void)[]>();
	/** Pieces on show: their prop and what they were drawn as. */
	const pieces = new Map<string, { prop: Prop; sprite: Sprite; key: string }>();
	/** Posters on the wall layer: sprite, pixels and what they show. */
	const posters = new Map<string, { sprite: Sprite; patch: Patch; key: string }>();
	/** The plant's own posters lifted off the base layer. */
	const lifted = new Set<string>();
	let layout = emptyLayout();
	/** What is picked up, faded where it stood. */
	let held: string | null = null;
	/** How faded a picked-up thing is. */
	const HELD_ALPHA = 0.25;

	/**
	 * Screen pixels of a whole-tile move.
	 *
	 * @param dx Tiles along x.
	 * @param dy Tiles along y.
	 * @returns Base-layer pixels.
	 */
	const step = (dx: number, dy: number): [number, number] => {
		const [ox, oy] = project(base, [0, 0, 0]), [px, py] = project(base, [dx * L, dy * L, 0]);
		return [Math.round(px - ox), Math.round(py - oy)];
	};

	/**
	 * Put a piece's picture on its sprite, once it is drawn.
	 *
	 * @param id Piece.
	 */
	const dress = (id: string): void => {
		const p = pieces.get(id);
		const t = p && textures.get(p.key);
		if (!p || !t || t instanceof Promise) return;
		const [kind, facing] = p.key.split('|');
		const at = layout.pieces.find((x) => x.id === id);
		if (!at || `${at.kind}|${at.facing}` !== `${kind}|${facing}`) return;
		const [fx, fy] = project(base, tileCentre(world, at.tile[0], at.tile[1]));
		p.sprite.texture = t.tex;
		p.prop.x = Math.round(fx) - t.ax; p.prop.y = Math.round(fy) - t.ay;
		p.sprite.position.set(p.prop.x, p.prop.y);
	};

	/**
	 * Take the plant's own posters off the base layer where they hang elsewhere or are picked up
	 * (the ghost shows them then), and put them back where they began.
	 */
	const lift = (): void => {
		let changed = false;
		for (const h of world.walls.posters) {
			const away = !!layout.hung[h.id] || held === h.id;
			if (away === lifted.has(h.id)) continue;
			const p = away ? h.under : h.over;
			for (let j = 0; j < p.h; j++) base.rgba.set(p.rgba.subarray(j * p.w * 4, (j + 1) * p.w * 4), ((p.y + j) * base.w + p.x) * 4);
			if (away) lifted.add(h.id); else lifted.delete(h.id);
			changed = true;
		}
		if (changed) stage.refreshBase();
	};
	/** How many times a picture that failed has been asked for again. */
	const retries = new Map<string, number>();

	const api: Furnishings = {
		get layout() { return layout; },
		home,
		set(next) {
			layout = next;
			const feet = feetOf(world, home, layout);
			// The plant's own props, slid to where they are now.
			for (const id of MOVABLE_PROPS) {
				const prop = scene.props.find((p) => p.id === id), at = homeAt.get(id);
				if (!prop || !at) continue;
				const [sx, sy] = step(...(layout.moved[id] ?? [0, 0]));
				prop.foot = feet.get(id)!;
				prop.x = at.x + sx; prop.y = at.y + sy;
				stage.props.get(id)?.position.set(prop.x, prop.y);
			}
			// Pieces: gone ones out, new ones in, every one at its place.
			const want = new Set(layout.pieces.map((p) => p.id));
			for (const [id, p] of pieces) {
				if (want.has(id)) continue;
				p.sprite.destroy();
				stage.props.delete(id);
				pieces.delete(id);
			}
			for (let k = scene.props.length - 1; k >= 0; k--) if (!home.has(scene.props[k].id)) scene.props.splice(k, 1);
			for (const p of layout.pieces) {
				const key = `${p.kind}|${p.facing}`;
				let on = pieces.get(p.id);
				if (!on) {
					const sprite = new Sprite(Texture.EMPTY);
					stage.layer.addChild(sprite);
					stage.props.set(p.id, sprite);
					on = { prop: { id: p.id, sprite: stub, x: 0, y: 0, foot: feet.get(p.id)! }, sprite, key };
					pieces.set(p.id, on);
				}
				on.key = key;
				on.prop.foot = feet.get(p.id)!;
				scene.props.push(on.prop);
				if (!api.texture(p.kind, p.facing, () => dress(p.id))) on.sprite.texture = Texture.EMPTY;
				dress(p.id);
			}
			// Posters: the plant's own lifted off the base where they hang elsewhere (see lift); every
			// other poster, and those, as sprites on the wall.
			const hung = new Map<string, { kind: string; spot: WallSpot }>([
				...Object.entries(layout.hung).map(([id, spot]): [string, { kind: string; spot: WallSpot }] => [id, { kind: id, spot }]),
				...layout.posters.map((p): [string, { kind: string; spot: WallSpot }] => [p.id, { kind: p.kind, spot: p.spot }]),
			]);
			for (const [id, p] of posters) {
				const h = hung.get(id);
				if (h && `${h.kind}@${h.spot.wall}${h.spot.at}/${h.spot.zTop}` === p.key) continue;
				p.sprite.destroy({ texture: true, textureSource: true });
				posters.delete(id);
			}
			for (const [id, h] of hung) {
				if (posters.has(id)) continue;
				const patch = api.posterPatch(h.kind, h.spot);
				const sprite = new Sprite(makeTexture(patch.w, patch.h, patch.rgba));
				sprite.position.set(patch.x, patch.y);
				stage.wall.addChild(sprite);
				posters.set(id, { sprite, patch, key: `${h.kind}@${h.spot.wall}${h.spot.at}/${h.spot.zTop}` });
			}
			world.grid.walkable.set(walkableFor(scene.props.map((p) => p.foot)));
			d.refloor();
			api.setHeld(held);
		},
		setHeld(id) {
			for (const [k, sp] of stage.props) if (pieces.has(k) || MOVABLE_PROPS.includes(k)) sp.alpha = k === id ? HELD_ALPHA : 1;
			for (const [k, p] of posters) p.sprite.alpha = k === id ? HELD_ALPHA : 1;
			held = id;
			lift();
		},
		feet: () => feetOf(world, home, layout),
		texture(kind, facing, onReady) {
			const key = `${kind}|${facing}`;
			const t = textures.get(key);
			if (t && !(t instanceof Promise)) return t;
			if (onReady) waiting.set(key, [...(waiting.get(key) ?? []), onReady]);
			if (!t) {
				textures.set(key, d.piece(kind, facing).then((px) => {
					textures.set(key, { tex: makeTexture(px.w, px.h, px.rgba), ax: px.top.x, ay: px.top.y, px });
					for (const f of waiting.get(key) ?? []) f();
					waiting.delete(key);
				}, (err: unknown) => {
					// Asked again in a moment, a few times, with whoever is waiting still waiting.
					textures.delete(key);
					console.error(err);
					const n = retries.get(key) ?? 0;
					retries.set(key, n + 1);
					if (n < 3) setTimeout(() => api.texture(kind, facing), 2000 * (n + 1));
				}));
			}
			return null;
		},
		posterPatch: (kind, spot) => wallPatch(base, posterArt(kind), spot),
		usable() {
			const out: Usable[] = OWN_PIECES.filter((o) => o.kind === 'soda' || o.kind === 'chess').map((o) => {
				const [dx, dy] = layout.moved[o.id] ?? [0, 0];
				return { id: o.id, kind: o.kind as Usable['kind'], facing: o.facing, at: tileCentre(world, o.tile[0] + dx, o.tile[1] + dy) };
			});
			for (const p of layout.pieces) if (p.kind === 'soda' || p.kind === 'chess') out.push({ id: p.id, kind: p.kind, facing: p.facing, at: tileCentre(world, p.tile[0], p.tile[1]) });
			return out;
		},
		thingAt(x, y) {
			// Front-most first: the depth sort's order is in the sprites' zIndex.
			const found: [number, string][] = [];
			for (const [id, p] of pieces) {
				const t = textures.get(p.key);
				if (t && !(t instanceof Promise) && solid(t.px, Math.floor(x - p.prop.x), Math.floor(y - p.prop.y))) found.push([p.sprite.zIndex, id]);
			}
			for (const id of MOVABLE_PROPS) {
				const prop = scene.props.find((p) => p.id === id);
				if (prop && solid(prop.sprite, Math.floor(x - prop.x), Math.floor(y - prop.y))) found.push([stage.props.get(id)?.zIndex ?? 0, id]);
			}
			if (found.length) return found.sort((a, b) => b[0] - a[0])[0][1];
			for (const [id, p] of posters) if (solid(p.patch, Math.floor(x - p.patch.x), Math.floor(y - p.patch.y))) return id;
			for (const h of world.walls.posters) if (!lifted.has(h.id) && differs(h.over, h.under, x, y)) return h.id;
			return null;
		},
		boxOf(id) {
			const p = pieces.get(id);
			if (p) { const t = textures.get(p.key); return t && !(t instanceof Promise) ? { x: p.prop.x, y: p.prop.y, w: t.px.w, h: t.px.h } : null; }
			const prop = MOVABLE_PROPS.includes(id) ? scene.props.find((q) => q.id === id) : undefined;
			if (prop) return { x: prop.x, y: prop.y, w: prop.sprite.w, h: prop.sprite.h };
			const w = posters.get(id)?.patch ?? world.walls.posters.find((h) => h.id === id)?.over;
			return w ? { x: w.x, y: w.y, w: w.w, h: w.h } : null;
		},
	};
	return api;
}

/**
 * Whether two same-sized grabs of the base layer differ at a point: where a poster painted the wall.
 *
 * @param a With the poster.
 * @param b Without.
 * @param x X, base-layer pixels.
 * @param y Y.
 * @returns True on the poster.
 */
function differs(a: Patch, b: Patch, x: number, y: number): boolean {
	const i = Math.floor(x - a.x), j = Math.floor(y - a.y);
	if (i < 0 || j < 0 || i >= a.w || j >= a.h) return false;
	const k = (j * a.w + i) * 4;
	return a.rgba[k] !== b.rgba[k] || a.rgba[k + 1] !== b.rgba[k + 1] || a.rgba[k + 2] !== b.rgba[k + 2];
}
