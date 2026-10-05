/**
 * Draws the crew: one sprite per comrade on the stage's depth-sorted layer, re-sorted among
 * the props every frame with drawOrder, the red "!" bubble over anyone who needs the owner, and a
 * ring under the selected comrade. All behaviour lives in crew.ts; this only mirrors it.
 */
import { Sprite, Texture } from 'pixi.js';
import { SPRITE } from '../art/avatar';
import { BUBBLE_MS, WRITING_PHASES, WRITING_PHASE_MS, bubbleFrame } from '../art/bubble';
import { type Actor, type Scene, drawOrder, feetOnScreen } from '../art/scene';
import { type Comrade, type Crew, atAnvil } from './crew';
import type { FrameBank } from './frames';
import { type PickBox, pickAt, pickBox } from './pick';
import type { Stage } from './stage';

/** The red "!" (needs you), the sealed letter (has replied), or "…" (writing an answer in their chat). */
export type BubbleKind = 'alert' | 'reply' | 'writing';

/** Per-comrade drawing state. */
interface Drawn {
	sprite: Sprite;
	bubble: Sprite;
	/** Outfit the sprite's frames belong to, so a change of clothes can be noticed. */
	outfitId: string;
	/** The outfit still on screen after a change of clothes, until the new one's frames land; null otherwise. */
	prevOutfitId: string | null;
	/** Animation and direction last queued with the frame bank. */
	wanted: string;
	/** Head-top point of the frame on screen, or null before the first frame lands. */
	top: { x: number; y: number } | null;
	/** Frame-bank key of the texture on screen, or null before the first frame lands. */
	shown: string | null;
	/** Bubble pop: which bubble, frame index (-1 when hidden) and time in that frame. */
	pop: { kind: BubbleKind; f: number; t: number };
	feet: [number, number];
}

export interface ComradeView {
	/**
	 * Mirror the crew onto the stage. Call once per rendered frame.
	 *
	 * @param crew Crew.
	 * @param dt Milliseconds since the last frame.
	 * @param selected Comrade whose card is open.
	 * @param replies Comrades with an unread reply to a directive.
	 * @param extras Figures drawn in with the comrades (The Commissar, a ceremony's guests).
	 * @param writing Comrades writing an answer in their chat.
	 */
	sync(crew: Crew, dt: number, selected: string | null, replies?: ReadonlySet<string>, extras?: { actor: Actor; sprite: Sprite }[], writing?: ReadonlySet<string>): void;
	/** The comrade under a world point, front-most first. */
	pick(p: { x: number; y: number }): string | null;
	/** Feet of a comrade in world pixels, for the camera and minimap. */
	feetOf(id: string): { x: number; y: number } | null;
	/** A comrade's place in this frame's depth sort, or null when not drawn (a marcher's flag goes with it). */
	zOf(id: string): number | null;
	/** Milliseconds from creation until the first comrade frame was shown, or null. */
	readonly firstFrameMs: number | null;
}

/**
 * Create the view.
 *
 * @param stage Stage.
 * @param scene The plant's scene (for projection and props).
 * @param frames Frame bank.
 * @param onPop Called when a bubble appears (or changes) over a comrade.
 * @returns View.
 */
export function createComradeView(stage: Stage, scene: Scene, frames: FrameBank, onPop?: (id: string, kind: 'alert' | 'reply') => void): ComradeView {
	const drawn = new Map<string, Drawn>();
	/**
	 * One bubble frame as a texture.
	 *
	 * @param f Pop frame.
	 * @param kind Bubble.
	 * @param phase For "…", which dot is dark.
	 * @returns Texture and its pixels' measures.
	 */
	const bakeOne = (f: number, kind: BubbleKind, phase = 0) => {
		const b = bubbleFrame(f, kind, phase);
		const c = document.createElement('canvas');
		c.width = b.w; c.height = b.h;
		c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.rgba), b.w, b.h), 0, 0);
		return { tex: Texture.from(c), b };
	};
	/**
	 * The five pop frames of one bubble as textures.
	 *
	 * @param kind Bubble.
	 * @returns Frames.
	 */
	const bake = (kind: BubbleKind) => [0, 1, 2, 3, 4].map((f) => bakeOne(f, kind));
	const bubbleTex: Record<BubbleKind, ReturnType<typeof bake>> = { alert: bake('alert'), reply: bake('reply'), writing: bake('writing') };
	/** The settled "…" bubble with each dot dark in turn. */
	const writingTex = Array.from({ length: WRITING_PHASES }, (_, p) => bakeOne(4, 'writing', p));
	const born = performance.now();
	let firstFrameMs: number | null = null;
	let boxes: PickBox[] = [];
	/** Each drawn comrade's place in the depth sort, this frame. */
	const sorted = new Map<string, number>();

	/**
	 * Start drawing a comrade.
	 *
	 * @param c Comrade.
	 * @returns Drawing state.
	 */
	const add = (c: Comrade): Drawn => {
		const sprite = new Sprite(Texture.EMPTY);
		const bubble = new Sprite(Texture.EMPTY);
		bubble.visible = false;
		stage.layer.addChild(sprite);
		stage.bubbles.addChild(bubble);
		frames.retain(c.outfit.id);
		const d: Drawn = { sprite, bubble, outfitId: c.outfit.id, prevOutfitId: null, wanted: '', top: null, shown: null, pop: { kind: 'alert', f: -1, t: 0 }, feet: [0, 0] };
		drawn.set(c.id, d);
		return d;
	};

	/**
	 * Stop drawing a comrade who has left, freeing their frames if nobody else wears the outfit.
	 *
	 * @param id Comrade id.
	 * @param d Drawing state.
	 */
	const remove = (id: string, d: Drawn): void => {
		d.sprite.destroy();
		d.bubble.destroy();
		frames.release(d.outfitId);
		if (d.prevOutfitId) frames.release(d.prevOutfitId);
		drawn.delete(id);
	};

	/**
	 * Advance and place a comrade's bubble: the red "!" while they need the owner, otherwise the letter
	 * while they have an unread reply, otherwise "…" while they write an answer in their chat. It
	 * pops in when it appears (or changes) and stays on its last frame until it goes; the "…" dots
	 * take turns.
	 *
	 * @param c Comrade.
	 * @param d Drawing state.
	 * @param dt Milliseconds since the last frame.
	 * @param replied Whether the comrade has an unread reply.
	 * @param writes Whether the comrade is writing an answer.
	 */
	const bubble = (c: Comrade, d: Drawn, dt: number, replied: boolean, writes: boolean): void => {
		const kind: BubbleKind | null = c.needsYou ? 'alert' : replied ? 'reply' : writes ? 'writing' : null;
		if (!kind || !d.top) { d.pop = { kind: 'alert', f: -1, t: 0 }; d.bubble.visible = false; return; }
		if (d.pop.f < 0 || d.pop.kind !== kind) {
			d.pop = { kind, f: 0, t: 0 };
			// The "…" arrives quietly: it is not news, only a comrade at work.
			if (kind !== 'writing') onPop?.(c.id, kind);
		}
		d.pop.t += dt;
		while (d.pop.f < 4 && d.pop.t >= BUBBLE_MS[d.pop.f]) { d.pop.t -= BUBBLE_MS[d.pop.f]; d.pop.f++; }
		const { tex, b } = kind === 'writing' && d.pop.f === 4
			? writingTex[Math.floor(d.pop.t / WRITING_PHASE_MS) % WRITING_PHASES]
			: bubbleTex[kind][d.pop.f];
		d.bubble.texture = tex;
		d.bubble.visible = true;
		d.bubble.position.set(d.sprite.x + d.top.x - b.tipX, d.sprite.y + d.top.y - b.tipY);
	};

	return {
		get firstFrameMs() { return firstFrameMs; },
		sync(crew, dt, selected, replies = new Set(), extras = [], writing = new Set()) {
			const list = crew.list();
			const ids = new Set(list.map((c) => c.id));
			for (const [id, d] of drawn) if (!ids.has(id)) remove(id, d);

			const actors: Actor[] = [];
			for (const c of list) {
				const d = drawn.get(c.id) ?? add(c);
				if (d.outfitId !== c.outfit.id) {
					// New clothes (the cloakroom, or a rename matched another persona). The old outfit
					// stays on screen until the new one's frames land, so a change never blinks blank.
					frames.retain(c.outfit.id);
					// A change before the last one landed: the one never shown goes; the one on screen stays.
					if (d.prevOutfitId) frames.release(d.outfitId); else d.prevOutfitId = d.outfitId;
					d.outfitId = c.outfit.id;
					d.wanted = '';
				}
				const view = `${c.anim}|${c.dir}`;
				if (view !== d.wanted) { d.wanted = view; frames.want(c.outfit, c.anim, c.dir); }
				// Hold the last frame on screen until the wanted one arrives from the workers.
				const f = frames.get(c.outfit, c.anim, c.dir, c.frame);
				if (f) {
					d.sprite.texture = f.tex;
					d.top = f.top;
					d.shown = f.key;
					if (d.prevOutfitId) { frames.release(d.prevOutfitId); d.prevOutfitId = null; }
					if (firstFrameMs === null) firstFrameMs = performance.now() - born;
				} else if (d.shown) frames.touch(d.shown);
				const [fx, fy] = feetOnScreen(scene, c.pos);
				d.feet = [fx, fy];
				d.sprite.position.set(fx - SPRITE.ax, fy - SPRITE.ay);
				d.sprite.visible = !c.hidden;
				// An airbrushing fades in steps rather than smoothly, to keep the pixel look, and greys as it goes.
				const a = Math.round(c.alpha * 4) / 4;
				d.sprite.alpha = a;
				d.sprite.tint = a < 1 ? 0xb8b0a0 : 0xffffff;
				if (c.hidden) { d.bubble.visible = false; continue; }
				actors.push({ id: c.id, pos: c.pos, over: atAnvil(c) ? scene.workProps : c.stack?.over, under: c.stack?.under });
				bubble(c, d, dt, replies.has(c.id), writing.has(c.id));
			}

			// Back-to-front order among props and comrades, every frame: comrades walk behind and
			// in front of furniture as they go.
			const extra = new Map(extras.map((e) => [e.actor.id, e.sprite]));
			const order = drawOrder(scene.props, [...actors, ...extras.map((e) => e.actor)]);
			boxes = [];
			sorted.clear();
			order.forEach((item, z) => {
				if (item.kind === 'prop') { const sp = stage.props.get(item.id); if (sp) sp.zIndex = z; return; }
				const ex = extra.get(item.id);
				if (ex) { ex.zIndex = z; return; }
				const d = drawn.get(item.id);
				if (!d) return;
				d.sprite.zIndex = z;
				sorted.set(item.id, z);
				boxes.push(pickBox(item.id, d.feet[0], d.feet[1], d.top ? SPRITE.ay - d.top.y : 60));
			});

			stage.floor.clear();
			const sel = selected ? drawn.get(selected) : undefined;
			if (sel) stage.floor.ellipse(sel.feet[0], sel.feet[1], 15, 7.5).stroke({ color: 0xf4d27a, width: 1, alpha: 0.95 });
		},
		pick: (p) => pickAt(boxes, p),
		zOf: (id) => sorted.get(id) ?? null,
		feetOf(id) {
			const d = drawn.get(id);
			return d ? { x: d.feet[0], y: d.feet[1] } : null;
		},
	};
}
