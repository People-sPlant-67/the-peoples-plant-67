/**
 * Art-spike previewer: one comrade on a backdrop, every animation and direction, integer
 * zoom, frame stepping, a contact sheet and a reference drop zone for side-by-side critique.
 * Scenes draw as a base layer plus depth-sorted prop sprites, so the comrade can walk behind
 * furniture ("Walk the floor").
 */

import { Application, Container, Graphics, Sprite, Texture, TextureStyle } from 'pixi.js';
import { BUBBLE_MS, bubbleFrame } from '../art/bubble';
import { ANIMS, type Anim, DIRS, type Dir, SPRITE, YAW } from '../art/avatar';
import { type Scene, plantCorner, siberia } from '../art/env';
import { type Outfit, ALEXEI, describeOutfit, randomOutfit } from '../art/outfits';
import { toCanvas } from '../art/render';
import { drawOrder, feetOnScreen } from '../art/scene';
import type { V3 } from '../art/sdf';
import { type SpritePixels, spriteKey } from '../art/sprite-job';
import { CHECKER_SQUARE, checkerStage } from './checker-stage';
import { CancelledError, isCancelled } from './render-queue';
import { moduleWorker } from './module-worker';
import { PRI, createSpriteClient } from './sprite-client';
import { pixelsToCanvas, propSprites } from './textures';

TextureStyle.defaultOptions.scaleMode = 'nearest';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
	outfit: ALEXEI as Outfit,
	seed: 67,
	anim: 'work' as Anim,
	dir: 'SE' as Dir,
	zoom: 2,
	playing: true,
	frame: 0,
	elapsed: 0,
	backdrop: 'plant' as 'plant' | 'siberia' | 'checker',
	/** Walking the scene's patrol loop instead of standing at the featured spot. */
	walking: false,
	/** Distance travelled along the patrol loop, in world units. */
	walked: 0,
};

/** Walking pace in world units per second: about one and a half tiles, close to Habbo's stroll. */
const WALK_SPEED = 64;

/** A rendered comrade frame, plus where a speech bubble's tail goes in it (sprite pixels). */
interface CachedFrame { tex: Texture; canvas: HTMLCanvasElement; top: { x: number; y: number } }
/** Frames of the current outfit that have arrived from the render workers, by `spriteKey`. */
const cache = new Map<string, CachedFrame>();
/** Renders comrade frames off the main thread. Scenes still render here: once per backdrop, ~150ms. */
const sprites = createSpriteClient(moduleWorker);
/** The frame on the comrade now. May be missing from `cache` for a moment after an outfit change. */
let shown: CachedFrame | null = null;
/** The previous outfit's frame kept on screen until the new outfit's first frame arrives. */
let retired: CachedFrame | null = null;
/** Outfit, animation and direction whose frames were last queued, so `show` queues only on change. */
let scheduled = '';
/** Outfit whose pending frames get cancelled on the next outfit change. */
let liveOutfit = '';
const bootAt = performance.now();
let firstFrameAt = 0;

/**
 * Report a failed render in the status line. Cancellations are routine and are ignored.
 *
 * @param {unknown} err Rejection reason.
 */
function renderFailed(err: unknown): void {
	if (isCancelled(err)) return;
	console.error(err);
	$('status').textContent = `A comrade frame failed to render, so the comrade may freeze on an old frame. ${(err as Error).message}`;
}

/**
 * Frame of the current outfit, from the cache or the render workers. Never renders on the
 * main thread. Rejects with a CancelledError if the outfit changes before the frame lands.
 *
 * @param {Anim} anim Animation.
 * @param {Dir} dir Direction.
 * @param {number} f Frame.
 * @param {number} priority Queue level from PRI.
 * @returns {Promise<CachedFrame>} Texture, canvas and head-top point.
 */
function want(anim: Anim, dir: Dir, f: number, priority: number): Promise<CachedFrame> {
	const o = state.outfit;
	const key = spriteKey(o.id, anim, dir, f);
	const hit = cache.get(key);
	if (hit) return Promise.resolve(hit);
	return sprites.request(o, anim, dir, f, priority).then((px) => {
		// A frame that finished just before its outfit was dropped must not be cached: nothing
		// would ever destroy its texture.
		if (state.outfit.id !== o.id) throw new CancelledError(key);
		// Two callers can await the same render; only the first makes a texture.
		let c = cache.get(key);
		if (!c) { c = toCached(px); cache.set(key, c); }
		return c;
	});
}

/**
 * Turn worker pixels into a canvas (for the contact sheet) and a texture (for the stage).
 *
 * @param {SpritePixels} px Pixels and head-top point.
 * @returns {CachedFrame} Cached frame.
 */
function toCached(px: SpritePixels): CachedFrame {
	const canvas = pixelsToCanvas(px);
	return { tex: Texture.from(canvas), canvas, top: px.top };
}

/**
 * Queue the frames the viewer is likely to need next, most likely first: the rest of this
 * animation and direction, then this animation in every direction, then everything else.
 * Work queued for the previous view is demoted, not dropped: it is still this outfit.
 */
function schedule(): void {
	const { anim, dir } = state;
	sprites.demote(PRI.PREBAKE);
	const ask = (a: Anim, d: Dir, p: number) => {
		for (let f = 0; f < ANIMS[a].length; f++) want(a, d, f, p).catch(renderFailed);
	};
	ask(anim, dir, PRI.ANIM);
	for (const d of DIRS) if (d !== dir) ask(anim, d, PRI.SHEET);
	for (const a of Object.keys(ANIMS) as Anim[]) if (a !== anim) for (const d of DIRS) ask(a, d, PRI.PREBAKE);
}

interface LiveScene {
	scene: Scene;
	tex: Texture;
	/** One sprite per prop, keyed by prop id, already placed in base-layer pixels. */
	props: Map<string, Sprite>;
}
const scenes: Partial<Record<'plant' | 'siberia', LiveScene>> = {};

/**
 * Lazily render a backdrop scene: its base texture and a sprite per prop.
 *
 * @param {'plant' | 'siberia'} k Scene key.
 * @returns {LiveScene} Scene, base texture and prop sprites.
 */
function sceneOf(k: 'plant' | 'siberia'): LiveScene {
	let s = scenes[k];
	if (!s) {
		const t0 = performance.now();
		const scene = k === 'plant' ? plantCorner() : siberia();
		const props = propSprites(scene);
		s = { scene, tex: Texture.from(toCanvas(scene.base)), props };
		scenes[k] = s;
		console.info(`[plant] scene ${k} rendered in ${Math.round(performance.now() - t0)}ms (${scene.base.w}×${scene.base.h}, ${scene.props.length} props)`);
	}
	return s;
}

/** Checker stage size and comrade spot, derived from the sprite and bubble sizes. */
const CHECKER = checkerStage();

/**
 * Checkerboard canvas for judging silhouettes and outlines on a neutral ground, sized by
 * `checkerStage` so the whole sprite and a popped bubble always fit.
 *
 * @returns {HTMLCanvasElement} Canvas.
 */
function checker(): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = CHECKER.w; c.height = CHECKER.h;
	const ctx = c.getContext('2d')!;
	const q = CHECKER_SQUARE;
	for (let y = 0; y < c.height; y += q) for (let x = 0; x < c.width; x += q) {
		ctx.fillStyle = ((x + y) / q) % 2 ? '#8e8c86' : '#a3a19b';
		ctx.fillRect(x, y, q, q);
	}
	return c;
}
const checkerTex = Texture.from(checker());

const app = new Application();
try {
	await app.init({ width: 400, height: 300, background: '#101114', antialias: false, resolution: 1 });
} catch (err) {
	$('status').textContent = `The renderer could not start, so nothing can be shown. The browser said: ${(err as Error).message}`;
	throw err;
}
$('stage').appendChild(app.canvas);

const world = new Container();
const bg = new Sprite();
/** Props and comrades, painted back to front by zIndex, which `sortLayer` sets. */
const layer = new Container();
layer.sortableChildren = true;
const actor = new Sprite();
const fx = new Graphics();
const bubble = new Sprite();
bubble.visible = false;
world.addChild(bg, layer, fx, bubble);

/** Bubble playback: frame index, time in frame, and how long to hold the final frame. */
const pop = { kind: 'reply' as 'reply' | 'alert', f: -1, t: 0, hold: 2200 };
const bubbleCache = new Map<string, { tex: Texture; b: ReturnType<typeof bubbleFrame> }>();

/**
 * Texture for one bubble frame. There are only ten (5 frames × 2 kinds), so they are made once.
 *
 * @param {number} f Frame index.
 * @param {'reply' | 'alert'} kind Bubble kind.
 * @returns {{tex: Texture, b: object}} Texture and frame geometry.
 */
function bubbleTex(f: number, kind: 'reply' | 'alert'): { tex: Texture; b: ReturnType<typeof bubbleFrame> } {
	const key = `${kind}${f}`;
	let hit = bubbleCache.get(key);
	if (!hit) {
		const b = bubbleFrame(f, kind);
		const c = document.createElement('canvas');
		c.width = b.w; c.height = b.h;
		c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.rgba), b.w, b.h), 0, 0);
		hit = { tex: Texture.from(c), b };
		bubbleCache.set(key, hit);
	}
	return hit;
}

/**
 * Advance the bubble pop animation.
 *
 * @param {number} dt Milliseconds since the last tick.
 */
function tickBubble(dt: number): void {
	if (pop.f < 0) return;
	pop.t += dt;
	const d = pop.f < 4 ? BUBBLE_MS[pop.f] : pop.hold;
	if (pop.t < d) return;
	pop.t -= d;
	pop.f++;
	if (pop.f > 4) { pop.f = -1; bubble.visible = false; return; }
	showBubble();
}

/**
 * Draw the current bubble frame with its tail tip just above the comrade's head or hat in
 * the frame on screen now. Called whenever the comrade moves or changes frame or direction,
 * so the bubble rides the walk and the idle bob instead of hanging at a fixed height.
 */
function showBubble(): void {
	if (pop.f < 0) return;
	// Before the comrade's first frame lands there is no head to point at.
	if (!shown) return;
	const { tex, b } = bubbleTex(pop.f, pop.kind);
	const { top } = shown;
	bubble.texture = tex;
	bubble.visible = true;
	bubble.position.set(actor.x + top.x - b.tipX, actor.y + top.y - b.tipY);
}
app.stage.addChild(world);

interface Particle { x: number; y: number; vx: number; vy: number; life: number; kind: 'snow' | 'smoke' }
let particles: Particle[] = [];

/**
 * Point on the scene's patrol loop a given distance along it, and the heading there.
 *
 * @param {V3[]} path Closed loop of floor points.
 * @param {number} d Distance along the loop, wrapped.
 * @returns {{pos: V3, dir: Dir}} Position and the nearest of the 8 facings.
 */
function alongPatrol(path: V3[], d: number): { pos: V3; dir: Dir } {
	const seg = path.map((p, k) => {
		const q = path[(k + 1) % path.length];
		return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) };
	});
	const total = seg.reduce((a, g) => a + g.len, 0);
	d = ((d % total) + total) % total;
	for (const { p, q, len } of seg) {
		if (d > len) { d -= len; continue; }
		const t = d / len;
		const deg = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
		// Snap the heading to the facing whose model yaw is closest, wrapping at ±180°.
		const dir = DIRS.reduce((best, k) => {
			const off = (x: Dir) => Math.abs(((deg - YAW[x] + 540) % 360) - 180);
			return off(k) < off(best) ? k : best;
		});
		return { pos: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, 0], dir };
	}
	return { pos: path[0], dir: state.dir };
}

/**
 * Put the comrade's feet at a world position and re-sort props and comrade by depth.
 * The checker backdrop has no world, so the comrade stands at a fixed spot there.
 */
function placeActor(): void {
	if (state.backdrop === 'checker') { actor.position.set(CHECKER.x, CHECKER.y); showBubble(); return; }
	const live = sceneOf(state.backdrop);
	const { scene } = live;
	let pos = scene.actor;
	if (state.walking) {
		const w = alongPatrol(scene.patrol, state.walked);
		pos = w.pos;
		if (w.dir !== state.dir) { state.dir = w.dir; refreshButtons(); show(); }
	}
	const [fx0, fy0] = feetOnScreen(scene, pos);
	actor.position.set(fx0 - SPRITE.ax, fy0 - SPRITE.ay);
	// At the featured spot the comrade is working the anvil, so the hammer must land on top of it.
	const order = drawOrder(scene.props, [{ id: 'comrade', pos, over: state.walking ? [] : scene.workProps }]);
	order.forEach((d, z) => {
		const sp = d.kind === 'actor' ? actor : live.props.get(d.id);
		if (sp) sp.zIndex = z;
	});
	showBubble();
}

/**
 * Place the backdrop, props and actor, and resize the stage to the backdrop at the current zoom.
 */
function layout(): void {
	let w: number, h: number;
	layer.removeChildren();
	if (state.backdrop === 'checker') {
		bg.texture = checkerTex;
		w = CHECKER.w; h = CHECKER.h;
	} else {
		const live = sceneOf(state.backdrop);
		bg.texture = live.tex;
		w = live.scene.base.w; h = live.scene.base.h;
		for (const sp of live.props.values()) layer.addChild(sp);
	}
	layer.addChild(actor);
	placeActor();
	world.scale.set(state.zoom);
	app.renderer.resize(w * state.zoom, h * state.zoom);
	particles = [];
	state.elapsed = 0;
	showBubble();
}

/**
 * Show the current frame and refresh the readouts.
 */
function show(): void {
	const n = ANIMS[state.anim].length;
	state.frame %= n;
	const view = `${state.outfit.id}|${state.anim}|${state.dir}`;
	// Queue the background work first: schedule() demotes everything already queued, and the
	// visible frame below must end up above it.
	if (view !== scheduled) { scheduled = view; schedule(); }
	const { anim, dir, frame } = state;
	const c = cache.get(spriteKey(state.outfit.id, anim, dir, frame));
	if (c) {
		actor.texture = c.tex;
		shown = c;
		if (retired) { retired.tex.destroy(true); retired = null; }
		if (!firstFrameAt) {
			firstFrameAt = performance.now();
			$('status').textContent = `The plant is ready. The first comrade frame arrived ${Math.round(firstFrameAt - bootAt)}ms after start-up; frames render ${sprites.describe()}.`;
		}
	} else {
		// Not rendered yet: keep the last frame on screen (a blank placeholder the very first
		// time) and swap in when it lands, if the viewer is still on this frame.
		const asked = performance.now();
		want(anim, dir, frame, PRI.VISIBLE).then(() => {
			// How long the viewer saw a stale frame; readable in DevTools' Performance panel.
			performance.measure('plant:frame-wait', { start: asked });
			if (state.anim === anim && state.dir === dir && state.frame % ANIMS[anim].length === frame) show();
		}).catch(renderFailed);
	}
	showBubble();
	$('frame-no').textContent = `Showing frame ${state.frame + 1} of ${n}, held for ${ANIMS[state.anim][state.frame]}ms.`;
}

/**
 * Snowfall and chimney smoke, only in Siberia. Pixel particles on integer coordinates.
 *
 * @param {number} dt Milliseconds since the last tick.
 */
function tickParticles(dt: number): void {
	fx.clear();
	if (state.backdrop !== 'siberia') return;
	const { scene } = sceneOf('siberia');
	const W = scene.base.w, H = scene.base.h;
	if (particles.filter((p) => p.kind === 'snow').length < 90 && Math.random() < 0.6) {
		particles.push({ x: Math.random() * W, y: -2, vx: -3 + Math.random() * 2, vy: 10 + Math.random() * 8, life: 1e9, kind: 'snow' });
	}
	const smoke = scene.emitters.find((e) => e.kind === 'smoke');
	if (smoke && Math.random() < 0.08) particles.push({ x: smoke.x, y: smoke.y, vx: 2 + Math.random() * 2, vy: -6 - Math.random() * 3, life: 3000, kind: 'smoke' });
	const s = dt / 1000;
	particles = particles.filter((p) => {
		p.x += p.vx * s; p.y += p.vy * s; p.life -= dt;
		if (p.kind === 'snow') p.x += Math.sin(p.y / 9) * 0.1;
		return p.y < H && p.life > 0 && p.x > -4 && p.x < W + 4;
	});
	for (const p of particles) {
		const x = Math.round(p.x), y = Math.round(p.y);
		if (p.kind === 'snow') fx.rect(x, y, 1, 1).fill({ color: 0xffffff, alpha: 0.9 });
		else {
			const r = p.life > 2000 ? 1 : 2;
			fx.rect(x, y, r, r).fill({ color: 0x9aa4ad, alpha: Math.min(0.7, p.life / 3000) });
		}
	}
}

app.ticker.add((t) => {
	const dt = t.deltaMS;
	if (state.playing && state.walking) {
		state.walked += (WALK_SPEED * dt) / 1000;
		placeActor();
	}
	if (state.playing) {
		state.elapsed += dt;
		const d = ANIMS[state.anim][state.frame % ANIMS[state.anim].length];
		if (state.elapsed >= d) {
			state.elapsed -= d;
			state.frame = (state.frame + 1) % ANIMS[state.anim].length;
			show();
		}
	}
	tickParticles(dt);
	tickBubble(dt);
});

let sheetJob = 0;

/**
 * Draw the contact sheet (all 8 directions × every frame) for the current animation.
 * Rendered in slices so the page stays responsive.
 */
async function drawSheet(): Promise<void> {
	const job = ++sheetJob;
	const frames = ANIMS[state.anim].length;
	const Z = 2, cw = SPRITE.w * Z, ch = SPRITE.h * Z, lab = 18;
	const cv = $('sheet') as HTMLCanvasElement;
	cv.width = 40 + frames * cw; cv.height = DIRS.length * (ch + lab);
	const ctx = cv.getContext('2d')!;
	ctx.imageSmoothingEnabled = false;
	ctx.fillStyle = '#2a2c31'; ctx.fillRect(0, 0, cv.width, cv.height);
	$('sheet-title').textContent = `Contact sheet for ${state.outfit.label}: the ${state.anim} animation in 8 directions and ${frames} frames, at 2×.`;
	const anim = state.anim;
	const cells: Promise<void>[] = [];
	for (let d = 0; d < DIRS.length; d++) {
		ctx.fillStyle = '#9a958a'; ctx.font = '12px system-ui';
		ctx.fillText(DIRS[d], 8, d * (ch + lab) + lab + ch / 2);
		for (let f = 0; f < frames; f++) {
			const x = 40 + f * cw, y = d * (ch + lab) + lab;
			// A slightly lighter cell marks a frame still on its way from the workers.
			ctx.fillStyle = '#34363c'; ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
			// Already queued by schedule() at the right level; asking again only joins that job.
			cells.push(want(anim, DIRS[d], f, DIRS[d] === state.dir ? PRI.ANIM : PRI.SHEET).then((c) => {
				if (job !== sheetJob) return;
				ctx.fillStyle = '#2a2c31'; ctx.fillRect(x, y, cw, ch);
				ctx.drawImage(c.canvas, x, y, cw, ch);
			}).catch(renderFailed));
		}
	}
	await Promise.all(cells);
}

/**
 * Drop the previous comrade: cancel its queued frames and destroy its textures. Without this
 * every reroll leaks up to 144 GPU textures. The frame on screen survives as `retired` until
 * the new comrade's first frame replaces it, so the stage never shows a destroyed texture.
 */
function retireOldOutfit(): void {
	if (liveOutfit && liveOutfit !== state.outfit.id) sprites.drop(liveOutfit);
	liveOutfit = state.outfit.id;
	for (const [k, v] of cache) {
		if (k.startsWith(`${state.outfit.id}|`)) continue;
		cache.delete(k);
		if (v === shown) { if (retired && retired !== v) retired.tex.destroy(true); retired = v; } else v.tex.destroy(true);
	}
}

/**
 * Put a new comrade on the stage: release the old one, describe the new one, and redraw.
 * It takes the outfit rather than reading `state.outfit`, so a caller cannot change the
 * outfit without the cleanup running.
 *
 * @param {Outfit} o The new outfit.
 */
function changeOutfit(o: Outfit): void {
	state.outfit = o;
	retireOldOutfit();
	$('outfit-info').textContent = describeOutfit(state.outfit);
	show();
	void drawSheet();
}

// Controls
const compassOrder: (Dir | '')[] = ['NW', 'N', 'NE', 'W', '', 'E', 'SW', 'S', 'SE'];
for (const d of compassOrder) {
	const b = document.createElement('button');
	b.type = 'button';
	b.textContent = d || '·';
	b.disabled = !d;
	if (d) b.dataset.dir = d;
	b.onclick = () => { if (d) { state.dir = d; refreshButtons(); show(); } };
	$('compass').appendChild(b);
}

/**
 * Sync button highlight state.
 */
function refreshButtons(): void {
	document.querySelectorAll<HTMLButtonElement>('#compass button').forEach((b) => b.classList.toggle('on', b.dataset.dir === state.dir));
	document.querySelectorAll<HTMLButtonElement>('#zoom button').forEach((b) => b.classList.toggle('on', Number(b.dataset.z) === state.zoom));
	$('play').textContent = state.playing ? 'Pause' : 'Play';
}

document.querySelectorAll<HTMLButtonElement>('#zoom button').forEach((b) => {
	b.onclick = () => { state.zoom = Number(b.dataset.z); refreshButtons(); layout(); };
});
$('pop-reply').onclick = () => { pop.kind = 'reply'; pop.f = 0; pop.t = 0; showBubble(); };
$('pop-alert').onclick = () => { pop.kind = 'alert'; pop.f = 0; pop.t = 0; showBubble(); };
$('play').onclick = () => { state.playing = !state.playing; refreshButtons(); };
$('step').onclick = () => { state.playing = false; state.frame = (state.frame + 1) % ANIMS[state.anim].length; refreshButtons(); show(); };
($('anim') as HTMLSelectElement).onchange = (e) => {
	state.anim = (e.target as HTMLSelectElement).value as Anim;
	state.frame = 0; state.elapsed = 0; show(); void drawSheet();
};
/**
 * Reset the comrade to the backdrop's featured pose: hammering in the plant, shivering in Siberia.
 */
function featuredPose(): void {
	if (state.backdrop === 'siberia') { state.anim = 'shiver'; state.dir = 'S'; }
	if (state.backdrop === 'plant') { state.anim = 'work'; state.dir = 'SE'; }
	($('anim') as HTMLSelectElement).value = state.anim;
	state.frame = 0;
}

// "Walk the floor" toggle. Built here rather than in index.html so the scene work stays in one file.
const walkBtn = document.createElement('button');
walkBtn.type = 'button';
walkBtn.id = 'walk';
walkBtn.title = 'The comrade walks a loop that passes behind the furniture, to check props hide them properly.';
$('backdrop').closest('label')!.after(walkBtn);

/**
 * Sync the walk toggle's label and availability with the backdrop.
 */
function refreshWalk(): void {
	walkBtn.disabled = state.backdrop === 'checker';
	walkBtn.textContent = state.walking ? 'Stop walking' : 'Walk the floor';
	walkBtn.classList.toggle('on', state.walking);
}
walkBtn.onclick = () => {
	state.walking = !state.walking;
	state.walked = 0;
	if (state.walking) { state.anim = 'walk'; ($('anim') as HTMLSelectElement).value = 'walk'; state.frame = 0; state.playing = true; }
	else featuredPose();
	refreshWalk(); refreshButtons(); layout(); show(); void drawSheet();
};

($('backdrop') as HTMLSelectElement).onchange = (e) => {
	state.backdrop = (e.target as HTMLSelectElement).value as typeof state.backdrop;
	if (state.backdrop === 'checker') state.walking = false;
	if (state.walking) { state.anim = 'walk'; state.frame = 0; state.walked = 0; } else featuredPose();
	refreshWalk(); refreshButtons(); layout(); show(); void drawSheet();
};
($('outfit') as HTMLSelectElement).onchange = (e) => {
	changeOutfit((e.target as HTMLSelectElement).value === 'alexei' ? ALEXEI : randomOutfit(state.seed));
};
$('reroll').onclick = () => {
	state.seed = (Math.random() * 1e9) >>> 0;
	($('outfit') as HTMLSelectElement).value = 'random';
	changeOutfit(randomOutfit(state.seed));
};

// Reference image drop zone
const REF_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
let refUrl = '';

/**
 * Size the reference to the chosen zoom, halving Retina screenshots so pixels match 1:1.
 */
function sizeRef(): void {
	const img = $('ref-img') as HTMLImageElement;
	if (!img.naturalWidth) return;
	const z = Number(($('ref-zoom') as HTMLSelectElement).value);
	const k = ($('ref-retina') as HTMLInputElement).checked ? 0.5 : 1;
	img.style.width = `${img.naturalWidth * k * z}px`;
}

/**
 * Load a reference image, or explain why it could not be shown.
 *
 * @param {File} file Dropped or chosen file.
 */
function loadRef(file: File): void {
	const err = $('ref-error');
	err.textContent = '';
	if (!REF_TYPES.includes(file.type)) {
		err.textContent = `"${file.name}" is not a PNG, JPEG, GIF or WebP image, so it was not loaded.`;
		return;
	}
	const img = $('ref-img') as HTMLImageElement;
	if (refUrl) URL.revokeObjectURL(refUrl);
	refUrl = URL.createObjectURL(file);
	img.onload = sizeRef;
	img.onerror = () => {
		err.textContent = `"${file.name}" could not be read as an image. It may be damaged; try taking the screenshot again.`;
		img.removeAttribute('src');
	};
	img.src = refUrl;
}
const drop = $('drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => {
	e.preventDefault(); drop.classList.remove('over');
	const f = e.dataTransfer?.files[0];
	if (f) loadRef(f);
};
($('ref-file') as HTMLInputElement).onchange = (e) => {
	const f = (e.target as HTMLInputElement).files?.[0];
	if (f) loadRef(f);
};
($('ref-zoom') as HTMLSelectElement).onchange = sizeRef;
($('ref-retina') as HTMLInputElement).onchange = sizeRef;

($('anim') as HTMLSelectElement).value = state.anim;
refreshButtons();
refreshWalk();
layout();
changeOutfit(state.outfit);
// The status line is updated again by show() when the comrade's first frame arrives.
$('status').textContent = 'The plant is ready. The comrade is still rendering.';
