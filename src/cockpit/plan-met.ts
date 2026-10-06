/**
 * The five-year plan fulfilled. When the noticeboard's three counts (inbox, approvals,
 * failed runs) all fall to zero after at least one was not, at most once a day: «ПЛАН ВЫПОЛНЕН!»
 * unrolls at the top of the screen, the Company Lead comes round the desk and has the Hero's star
 * pinned on (by The Commissar, or the nearest comrade), and as it goes on, fireworks over the plant.
 *
 * The watch only counts a fall it saw: counts already at zero when the plant opens, or read on a
 * failed check, never fire it. The day it last fired is kept in this browser.
 */
import { Sprite, Texture } from 'pixi.js';
import { BURST_COLOURS, BURST_FRAMES, burstFrame, planBanner, signPixels } from '../art/eggs';
import type { Anim, Dir } from '../art/avatar';
import type { Outfit } from '../art/outfits';
import type { V3 } from '../art/sdf';
import { feetOnScreen } from '../art/scene';
import { companyLead } from '../live/personas';
import type { World } from '../world/types';
import { textureOf } from '../preview/textures';
import { type Comrade, type Crew, MEDAL_HOLD, inScene } from './crew';
import { el } from './dom';
import type { Voice } from './sound-cues';
import type { Stage } from './stage';

/** localStorage key for the day the plan was last fulfilled. */
export const PLAN_KEY = 'plant67.planMet';

/** The noticeboard's counts: inbox, approvals, failed runs. */
export type Counts = [number, number, number];

/** What the watch needs. */
export interface PlanWatchDeps {
	/** Today, in the computer's own calendar. */
	today(): string;
	/** The day it last fired, or null. */
	load(): string | null;
	save(day: string): void;
	onMet(): void;
}

/**
 * Today as YYYY-MM-DD in the computer's own time zone.
 *
 * @param d A moment.
 * @returns Day.
 */
export function dayOf(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Watch the counts for the plan being met.
 *
 * @param d Dependencies.
 * @returns Feed it every check's counts, and whether they are fresh (read on a good check, not stale).
 */
export function createPlanWatch(d: PlanWatchDeps): { see(counts: Counts | null, fresh: boolean): void } {
	let before: Counts | null = null;
	return {
		see(counts, fresh) {
			if (!counts || !fresh) return;
			const met = counts.every((n) => n === 0) && !!before && before.some((n) => n > 0);
			before = counts;
			if (!met || d.load() === d.today()) return;
			d.save(d.today());
			d.onMet();
		},
	};
}

/** How long the fireworks go on (ms), the gap between bursts (ms), and one frame of a burst (ms). */
export const FIREWORKS_MS = 7_000, BURST_GAP: [number, number] = [180, 450], BURST_FRAME_MS = 110;
/** How much bigger than drawn a burst shows. */
export const BURST_SCALE = 2;
/** How long the banner stays up (ms): at least this, and until the salute is over plus two seconds. */
export const BANNER_MS = 12_000;
/** Where the medal is pinned on: the carpet in front of the Company Lead's desk (tiles), and the pinner beside them (world units). */
export const MEDAL_AT: [number, number] = [3.3, 4.3], PINNER_OFF: [number, number] = [-6, -30];
/** The longest the two take to get there (ms), the pinning (ms), and the salute (ms). */
export const MEDAL_WALK_MS = 15_000, PIN_MS = 1_600, SALUTE_MS = 3_000;

/** The outfits with the Hero's star added, made once each so their frames are shared. */
const heroes = new Map<string, Outfit>();

/**
 * An outfit with the Hero of Socialist Labour's star on, as the Company Lead wears it once pinned.
 *
 * @param o Outfit.
 * @returns The same outfit when it already has the star.
 */
export function heroOf(o: Outfit): Outfit {
	if (o.extras?.includes('heroStar')) return o;
	let h = heroes.get(o.id);
	if (!h) { h = { ...o, id: `${o.id}*hero`, extras: [...(o.extras ?? []), 'heroStar'] }; heroes.set(o.id, h); }
	return h;
}

/** What the celebration needs from the cockpit. */
export interface CelebrationDeps {
	crew: Crew;
	world: World;
	stage: Pick<Stage, 'bubbles'>;
	/** Where the banner goes on the page. */
	root: HTMLElement;
	/** The camera now, and the view's size, for where the fireworks go. */
	cam(): { x: number; y: number; zoom: number };
	view(): { w: number; h: number };
	glideTo(p: { x: number; y: number }): void;
	prefetch(o: Outfit, anim: Anim, dir: Dir): void;
	/** Where a base-layer point is across the screen, 0 to 1, or null off screen. */
	screenX(x: number, y: number): number | null;
	play(voice: Voice, pan: number, gain: number): void;
	reducedMotion?(): boolean;
	rng?: () => number;
	makeTexture?(w: number, h: number, rgba: Uint8ClampedArray): Texture;
}

/** The celebration, for the cockpit. */
export interface Celebration {
	/** The plan is met: begin. */
	start(): void;
	tick(dt: number): void;
	/** For checks: bursts in the air, the medal's stage and who, and whether the banner is up. */
	state(): { bursts: number; medal: { stage: MedalStage; lead: string; pinner: string | null } | null; banner: boolean };
}

/** The medal's stages. */
export type MedalStage = 'walk' | 'pin' | 'salute';

/**
 * Set up the celebration.
 *
 * @param d Dependencies.
 * @returns Celebration.
 */
export function createCelebration(d: CelebrationDeps): Celebration {
	const rng = d.rng ?? Math.random;
	const reduced = d.reducedMotion ?? (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
	const makeTexture = d.makeTexture ?? textureOf;
	const L = d.world.tile;
	const scene = d.world.scene;
	/** Burst textures by colour and frame, made on first use. */
	const burstTex = new Map<string, Texture>();
	/**
	 * One frame of a burst in one colour.
	 *
	 * @param c Colour index.
	 * @param f Frame.
	 * @returns Texture (64 × 64, centred).
	 */
	const burstOf = (c: number, f: number): Texture => {
		const key = `${c}|${f}`;
		let t = burstTex.get(key);
		if (!t) { const b = burstFrame(f, BURST_COLOURS[c], c); t = makeTexture(b.w, b.h, b.rgba); burstTex.set(key, t); }
		return t;
	};
	const bursts: { sprite: Sprite; c: number; t: number }[] = [];
	let show = 0, nextBurst = 0, fired = false;
	/** The fireworks go up: as the star is pinned on, or at once when there is no medal. */
	const fire = (): void => {
		if (fired) return;
		fired = true;
		if (!reduced()) { show = FIREWORKS_MS; nextBurst = 0; }
	};

	/** Where the banner's words are said for screen readers: there from the start, so a change is announced. */
	const said = el('div', 'p67-sr');
	said.setAttribute('role', 'status');
	d.root.append(said);

	let medal: { stage: MedalStage; lead: string; pinner: string | null; t: number } | null = null;
	let banner: { el: HTMLElement; t: number } | null = null;

	/**
	 * Whether a comrade can take part: here, seen, not in a scene, not in Siberia.
	 *
	 * @param c Comrade.
	 * @returns True when free.
	 */
	const free = (c: Comrade | undefined): c is Comrade => !!c && !c.hidden && !c.gone && !inScene(c) && c.place.zone !== 'siberia';

	/** Let the two go. */
	const endMedal = (): void => {
		if (!medal) return;
		fire();
		d.crew.release(medal.lead, MEDAL_HOLD);
		if (medal.pinner) d.crew.release(medal.pinner, MEDAL_HOLD);
		medal = null;
	};

	/** The Company Lead and someone to pin the star on them walk to the carpet. */
	const beginMedal = (): void => {
		const boss = companyLead(d.crew.list().filter((c) => !c.gone).map((c) => c.agent));
		const lead = boss ? d.crew.get(boss.id) : undefined;
		if (!free(lead) || !d.crew.hold(lead.id, MEDAL_HOLD)) return;
		const at: V3 = [MEDAL_AT[0] * L, MEDAL_AT[1] * L, 0];
		if (!d.crew.walk(lead.id, at)) { d.crew.release(lead.id, MEDAL_HOLD); return; }
		d.crew.pose(lead.id, null, 'S');
		// The salute is done with the star on: ready that outfit's frames now.
		d.prefetch(heroOf(lead.outfit), 'salute', 'S');
		d.prefetch(heroOf(lead.outfit), 'idle', 'S');
		// The Commissar pins it on if he is about; otherwise whoever is nearest.
		const others = d.crew.list().filter((c) => c.id !== lead.id && free(c));
		const rep = others.find((c) => c.place.zone === 'roam');
		const near = others.sort((a, b) => Math.hypot(a.pos[0] - lead.pos[0], a.pos[1] - lead.pos[1]) - Math.hypot(b.pos[0] - lead.pos[0], b.pos[1] - lead.pos[1]));
		let pinner: string | null = null;
		for (const c of rep ? [rep, ...near.filter((x) => x !== rep)] : near) {
			if (!d.crew.hold(c.id, MEDAL_HOLD)) continue;
			if (d.crew.walk(c.id, [at[0] + PINNER_OFF[0], at[1] + PINNER_OFF[1], 0])) {
				d.crew.pose(c.id, null, 'SW');
				d.prefetch(c.outfit, 'token', 'SW');
				d.prefetch(c.outfit, 'salute', 'SW');
				pinner = c.id;
				break;
			}
			d.crew.release(c.id, MEDAL_HOLD);
		}
		medal = { stage: 'walk', lead: lead.id, pinner, t: 0 };
		const [x, y] = feetOnScreen(scene, at);
		d.glideTo({ x, y: y - 30 });
	};

	/**
	 * The star goes on the Company Lead's chest, kept until they next change or the plant is reopened.
	 *
	 * @param id The Company Lead.
	 */
	const pinOn = (id: string): void => {
		const c = d.crew.get(id);
		if (!c) return;
		if (heroOf(c.outfit) !== c.outfit) d.crew.dressAs(id, heroOf(c.outfit));
		const [x, y] = feetOnScreen(scene, c.pos);
		const sx = d.screenX(x, y - 40);
		d.play('ding', sx === null ? 0 : sx * 2 - 1, 0.5);
	};

	/** «ПЛАН ВЫПОЛНЕН!» unrolls at the top of the screen. */
	const raiseBanner = (): void => {
		banner?.el.remove();
		const px = signPixels(planBanner());
		const canvas = document.createElement('canvas');
		canvas.width = px.w;
		canvas.height = px.h;
		canvas.style.width = `${px.w * 4}px`;
		canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px.rgba), px.w, px.h), 0, 0);
		const box = el('div', 'p67-planmet');
		canvas.setAttribute('aria-hidden', 'true');
		box.append(canvas);
		// Said into a live region already on the page, so screen readers announce it.
		said.textContent = 'The plan is fulfilled. Nobody is waiting on you.';
		d.root.append(box);
		banner = { el: box, t: 0 };
	};

	return {
		start() {
			raiseBanner();
			if (medal) return;
			fired = false;
			beginMedal();
			if (!medal) fire();
		},
		tick(dt) {
			// Fireworks, up in the top of the view.
			if (show > 0) {
				show -= dt;
				nextBurst -= dt;
				if (nextBurst <= 0) {
					nextBurst = BURST_GAP[0] + rng() * (BURST_GAP[1] - BURST_GAP[0]);
					const cam = d.cam(), v = d.view();
					const x = cam.x + (0.15 + rng() * 0.7) * (v.w / cam.zoom), y = cam.y + (0.1 + rng() * 0.25) * (v.h / cam.zoom);
					const sprite = new Sprite(Texture.EMPTY);
					// Twice the size, still on the pixel grid: one-pixel sparks are lost against the brick.
					sprite.scale.set(BURST_SCALE);
					sprite.position.set(Math.round(x - 32 * BURST_SCALE), Math.round(y - 32 * BURST_SCALE));
					d.stage.bubbles.addChild(sprite);
					bursts.push({ sprite, c: Math.floor(rng() * BURST_COLOURS.length), t: 0 });
					const sx = d.screenX(x, y);
					if (sx !== null) d.play('crackle', sx * 2 - 1, 0.4);
				}
			}
			for (let k = bursts.length - 1; k >= 0; k--) {
				const b = bursts[k];
				b.t += dt;
				const f = Math.floor(b.t / BURST_FRAME_MS);
				if (f >= BURST_FRAMES || reduced()) { b.sprite.destroy(); bursts.splice(k, 1); continue; }
				b.sprite.texture = burstOf(b.c, f);
			}
			// The banner: up, then rolled away.
			if (banner) {
				banner.t += dt;
				// It stays up until the medal is on and the salute over.
				if (medal) banner.t = Math.min(banner.t, BANNER_MS - 2000);
				if (banner.t >= BANNER_MS && !banner.el.classList.contains('p67-planmet-out')) banner.el.classList.add('p67-planmet-out');
				if (banner.t >= BANNER_MS + 600) { banner.el.remove(); banner = null; said.textContent = ''; }
			}
			// The medal.
			if (!medal) return;
			const lead = d.crew.get(medal.lead);
			if (!lead || lead.held !== MEDAL_HOLD) { endMedal(); return; }
			const pinner = medal.pinner ? d.crew.get(medal.pinner) : undefined;
			if (medal.pinner && (!pinner || pinner.held !== MEDAL_HOLD)) medal.pinner = null;
			medal.t += dt;
			if (medal.stage === 'walk') {
				const there = !lead.path.length && (!pinner || !pinner.path.length);
				if (!there && medal.t < MEDAL_WALK_MS) return;
				if (lead.path.length) { endMedal(); return; }
				if (pinner?.path.length) { d.crew.release(pinner.id, MEDAL_HOLD); medal.pinner = null; }
				medal.stage = 'pin';
				medal.t = 0;
				if (medal.pinner) d.crew.pose(medal.pinner, 'token', 'SW');
				else { medal.t = PIN_MS; }
				return;
			}
			if (medal.stage === 'pin') {
				if (medal.t < PIN_MS) return;
				pinOn(medal.lead);
				fire();
				medal.stage = 'salute';
				medal.t = 0;
				d.crew.pose(medal.lead, 'salute', 'S');
				if (medal.pinner) d.crew.pose(medal.pinner, 'salute', 'SW');
				return;
			}
			if (medal.t >= SALUTE_MS) endMedal();
		},
		state: () => ({
			bursts: bursts.length,
			medal: medal ? { stage: medal.stage, lead: medal.lead, pinner: medal.pinner } : null,
			banner: !!banner,
		}),
	};
}
