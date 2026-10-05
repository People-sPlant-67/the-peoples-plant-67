/**
 * Layered scenes. A scene is a static base layer (floor, walls, wall signage: things nothing
 * can stand behind) plus one sprite per prop, each tagged with its floor footprint so props
 * and any number of agents can be depth-sorted every frame. Without this, an agent walking
 * behind the workbench would be painted over it.
 */

import { type Frame, type View, fitBounds, project, render } from './render';
import type { Prim, V3 } from './sdf';

/** Axis-aligned floor rectangle in world units (x/y on the floor), plus the lowest z. */
export interface Footprint {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** Lowest point, so something resting on top of another thing can sort after it. */
	z0: number;
}

/** One separately drawn scene object. */
export interface Prop {
	id: string;
	/** The prop alone, rendered with the scene's view and pixel density. */
	sprite: Frame;
	/** Top-left of `sprite` in base-layer pixels. Whole numbers, so pixels stay aligned. */
	x: number;
	y: number;
	foot: Footprint;
}

export interface Scene {
	/** Floor, walls, pipes and wall signage. Drawn first, never in front of anything. */
	base: Frame;
	props: Prop[];
	/**
	 * Base and every prop flattened into one image, for callers that only need a still
	 * backdrop. Its rgba is the composite; depth and group describe the base layer only.
	 */
	frame: Frame;
	/** Where the featured agent stands and faces. */
	actor: V3;
	actorDir: 'SE' | 'S';
	/** Props the featured agent works at from its stand spot, so it draws over them there (the hammer lands on the anvil). */
	workProps: string[];
	/** A demo loop for the preview that passes behind props, so occlusion can be checked by eye. */
	patrol: V3[];
	/** Screen-space emitters for the preview's particle effects, in base-layer pixels. */
	emitters: { kind: 'snow' | 'smoke'; x: number; y: number }[];
}

/** An agent to be sorted among the props. */
export interface Actor {
	id: string;
	/** Feet position in world units. */
	pos: V3;
	/** Half-width of the agent's floor footprint. Defaults to ACTOR_RADIUS. */
	radius?: number;
	/** Prop ids this agent must draw over regardless of position (it is working at them). */
	over?: string[];
	/** Prop ids that must draw over this agent regardless of position (sat on the far side of a table). */
	under?: string[];
	/** A footprint of its own, for something bigger than a comrade (the train). */
	foot?: Footprint;
}

/**
 * Default half-width of a comrade's floor footprint. Shoulders sit at ±9.8 with arms about 3.5
 * thick, and swinging arms reach further; at the old value of 6 the sort thought bodies were
 * clear of props they visibly overlapped.
 */
export const ACTOR_RADIUS = 11;

export type Drawable = { kind: 'prop'; id: string; prop: Prop } | { kind: 'actor'; id: string; actor: Actor };

/**
 * Union of the primitives' bounding boxes on the floor plane.
 *
 * @param {Prim[]} prims Primitives.
 * @returns {Footprint} Footprint.
 */
export function footprintOf(prims: Prim[]): Footprint {
	const f: Footprint = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, z0: Infinity };
	for (const p of prims) {
		f.x0 = Math.min(f.x0, p.min[0]); f.y0 = Math.min(f.y0, p.min[1]);
		f.x1 = Math.max(f.x1, p.max[0]); f.y1 = Math.max(f.y1, p.max[1]);
		f.z0 = Math.min(f.z0, p.min[2]);
	}
	// Parts sunk into the floor (a column's base) still stand on it; otherwise the height
	// test in behind() would always put them first.
	f.z0 = Math.max(0, f.z0);
	return f;
}

/**
 * Render a base layer and one sprite per prop on a shared canvas frame.
 *
 * The canvas is fitted to every primitive, so the base is the same size and anchor as the
 * old single-image scene and existing screen coordinates still hold. Each prop is fitted to
 * its own primitives with integer anchors, so its pixels sample exactly the same rays as the
 * matching base-layer pixels would.
 *
 * @param {Prim[]} base Primitives nothing can stand behind.
 * @param {{id: string, prims: Prim[]}[]} props Primitives grouped by object.
 * @param {View} view Scene view.
 * @param {boolean} flat Render everything into the base in one pass with no props, the way
 *   scenes were drawn before layering. Only for comparing the two in tests.
 * @returns {{base: Frame, props: Prop[]}} Rendered layers.
 */
export function renderLayers(base: Prim[], props: { id: string; prims: Prim[] }[], view: View, flat = false): { base: Frame; props: Prop[] } {
	const all = [...base, ...props.flatMap((p) => p.prims)];
	const fit = fitBounds(all, view, 3);
	if (flat) return { base: render(all, { ...fit, view }), props: [] };
	const baseFrame = render(base, { ...fit, view });
	const out = props.map(({ id, prims }) => {
		const pf = fitBounds(prims, view, 3);
		const sprite = render(prims, { ...pf, view });
		return { id, sprite, x: fit.ax - pf.ax, y: fit.ay - pf.ay, foot: footprintOf(prims) };
	});
	return { base: baseFrame, props: out };
}

/**
 * Footprint of an actor standing at `pos`.
 *
 * @param {Actor} a Actor.
 * @returns {Footprint} Footprint.
 */
function actorFoot(a: Actor): Footprint {
	if (a.foot) return a.foot;
	const r = a.radius ?? ACTOR_RADIUS;
	return { x0: a.pos[0] - r, y0: a.pos[1] - r, x1: a.pos[0] + r, y1: a.pos[1] + r, z0: a.pos[2] };
}

/**
 * Which of two footprints is further from the camera.
 *
 * The camera looks towards -x and -y, so a box entirely at smaller x, or entirely at smaller
 * y, is behind. Boxes separated on x one way and y the other cannot overlap on screen, so
 * their order does not matter. Overlapping footprints fall back to height, then to the axis
 * they overlap least on: that is the side they actually meet on. Comparing centres instead
 * put an agent standing just past the end of a long bench behind it.
 *
 * @param {Footprint} a First footprint.
 * @param {Footprint} b Second footprint.
 * @returns {number} Negative if `a` is behind `b`, positive if in front, 0 if either order is fine.
 */
export function behind(a: Footprint, b: Footprint): number {
	const sx = a.x1 <= b.x0 ? -1 : b.x1 <= a.x0 ? 1 : 0;
	const sy = a.y1 <= b.y0 ? -1 : b.y1 <= a.y0 ? 1 : 0;
	if (sx && sy && sx !== sy) return 0;
	if (sx || sy) return sx || sy;
	// Only a clear height gap counts: rounded boxes dip a fraction below the floor, which is noise.
	if (Math.abs(a.z0 - b.z0) > 4) return a.z0 - b.z0;
	const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
	const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
	const d = ox <= oy ? (a.x0 + a.x1) - (b.x0 + b.x1) : (a.y0 + a.y1) - (b.y0 + b.y1);
	return d || (a.x0 + a.x1 + a.y0 + a.y1) - (b.x0 + b.x1 + b.y0 + b.y1);
}

/**
 * Back-to-front draw order for props and agents.
 *
 * Pairwise footprint tests are not transitive, so a plain sort can produce nonsense; this is
 * a topological sort on "is behind" edges, taking the furthest-back ready item first. If
 * three long objects ever form a pinwheel cycle, the furthest-back remaining item is drawn to
 * break it. O(n²), which is nothing for a room of dozens of agents.
 *
 * @param {Prop[]} props Scene props.
 * @param {Actor[]} actors Agents at their current positions.
 * @returns {Drawable[]} Items in painting order.
 */
export function drawOrder(props: Prop[], actors: Actor[]): Drawable[] {
	const items: Drawable[] = [
		...props.map((prop): Drawable => ({ kind: 'prop', id: prop.id, prop })),
		...actors.map((actor): Drawable => ({ kind: 'actor', id: actor.id, actor })),
	];
	const feet = items.map((d) => (d.kind === 'prop' ? d.prop.foot : actorFoot(d.actor)));
	const key = feet.map((f) => f.x0 + f.x1 + f.y0 + f.y1);
	const n = items.length;
	const after: number[][] = items.map(() => []);
	const indeg = new Array<number>(n).fill(0);
	const edge = (from: number, to: number): void => { after[from].push(to); indeg[to]++; };
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const a = items[i], b = items[j];
			// A working agent draws over its bench whatever the footprints say.
			if (a.kind === 'actor' && b.kind === 'prop' && a.actor.over?.includes(b.id)) { edge(j, i); continue; }
			if (b.kind === 'actor' && a.kind === 'prop' && b.actor.over?.includes(a.id)) { edge(i, j); continue; }
			if (a.kind === 'actor' && b.kind === 'prop' && a.actor.under?.includes(b.id)) { edge(i, j); continue; }
			if (b.kind === 'actor' && a.kind === 'prop' && b.actor.under?.includes(a.id)) { edge(j, i); continue; }
			const c = behind(feet[i], feet[j]);
			if (c < 0) edge(i, j);
			else if (c > 0) edge(j, i);
		}
	}
	const done = new Array<boolean>(n).fill(false);
	const out: Drawable[] = [];
	for (let k = 0; k < n; k++) {
		let pick = -1, cycle = -1;
		for (let i = 0; i < n; i++) {
			if (done[i]) continue;
			if (indeg[i] === 0 && (pick < 0 || key[i] < key[pick])) pick = i;
			if (cycle < 0 || key[i] < key[cycle]) cycle = i;
		}
		if (pick < 0) pick = cycle;
		done[pick] = true;
		out.push(items[pick]);
		for (const t of after[pick]) indeg[t]--;
	}
	return out;
}

/**
 * Alpha-composite `src` onto `dst` at an integer offset.
 *
 * @param {Uint8ClampedArray} dst Destination rgba.
 * @param {number} dw Destination width.
 * @param {number} dh Destination height.
 * @param {Frame} src Source frame.
 * @param {number} x Left.
 * @param {number} y Top.
 */
function over(dst: Uint8ClampedArray, dw: number, dh: number, src: Frame, x: number, y: number): void {
	for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) {
		const dx = x + i, dy = y + j;
		if (dx < 0 || dy < 0 || dx >= dw || dy >= dh) continue;
		const s = (j * src.w + i) * 4, d = (dy * dw + dx) * 4;
		const a = src.rgba[s + 3] / 255;
		if (!a) continue;
		for (let c = 0; c < 3; c++) dst[d + c] = src.rgba[s + c] * a + dst[d + c] * (1 - a);
		dst[d + 3] = Math.max(dst[d + 3], src.rgba[s + 3]);
	}
}

/**
 * Flatten a base and its props, back to front, into one frame.
 *
 * @param {Frame} base Base layer.
 * @param {Prop[]} props Props.
 * @returns {Frame} Composite; depth and group buffers are the base layer's.
 */
export function flatten(base: Frame, props: Prop[]): Frame {
	const rgba = new Uint8ClampedArray(base.rgba);
	for (const d of drawOrder(props, [])) if (d.kind === 'prop') over(rgba, base.w, base.h, d.prop.sprite, d.prop.x, d.prop.y);
	return { ...base, rgba };
}

/**
 * Composite a scene with agents in it, each correctly in front of or behind the props.
 * For offline stills and reels; the live preview sorts Pixi sprites with `drawOrder` instead.
 *
 * @param {Scene} s Scene.
 * @param {{actor: Actor, sprite: Frame}[]} agents Each agent and its rendered frame, whose anchor (ax, ay) is the feet.
 * @returns {Frame} Composite the size of the base layer.
 */
export function compose(s: Scene, agents: { actor: Actor; sprite: Frame }[]): Frame {
	const rgba = new Uint8ClampedArray(s.base.rgba);
	const sprites = new Map(agents.map((a) => [a.actor.id, a.sprite]));
	for (const d of drawOrder(s.props, agents.map((a) => a.actor))) {
		if (d.kind === 'prop') { over(rgba, s.base.w, s.base.h, d.prop.sprite, d.prop.x, d.prop.y); continue; }
		const sp = sprites.get(d.id)!;
		const [fx, fy] = feetOnScreen(s, d.actor.pos);
		over(rgba, s.base.w, s.base.h, sp, fx - sp.ax, fy - sp.ay);
	}
	return { ...s.base, rgba };
}

/**
 * Where an actor's feet land in base-layer pixels.
 *
 * @param {Scene} s Scene.
 * @param {V3} pos Feet position in world units.
 * @returns {[number, number]} Whole-pixel x and y.
 */
export function feetOnScreen(s: Scene, pos: V3): [number, number] {
	const [x, y] = project(s.base, pos);
	return [Math.round(x), Math.round(y)];
}
