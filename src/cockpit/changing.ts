/**
 * Changing at the cloakroom. When the owner keeps a new look, the comrade puts down
 * whatever they are doing and marches to the гардероб in the Palace of Culture. There the old
 * outfit comes off a piece at a time (hat, top, legs, each with a puff), leaving them in the nude
 * behind the mosaic, while the attendant turns her back behind her newspaper; then the new outfit
 * goes on a piece at a time, she turns round, and they march back to work. One comrade at the
 * counter at a time; anyone else waits their turn where they are. Their real work is not touched:
 * this is only what the plant shows.
 */
import type { Outfit } from '../art/outfits';
import type { Crew } from './crew';
import type { World } from '../world/types';

/** The scene name the crew knows a changing comrade is held by. */
export const CHANGING = 'changing';
/** How long each piece takes to come off or go on (ms): about 15 seconds at the counter in all. */
export const STEP_MS = 1500;
/** How long they stand there with nothing on (ms). */
export const BARE_MS = 4000;
/** A comrade who cannot be held (a ceremony has them) is asked again after this long (ms). */
export const RETRY_MS = 1000;

/**
 * The outfits a change goes through, in order: as they were, hat off, top off, legs off (the
 * mosaic), legs on, top on, hat on. Each has an id of its own, so its frames are rendered apart.
 *
 * @param from What they wear now.
 * @param to What they will wear.
 * @returns Seven outfits.
 */
export function stepOutfits(from: Outfit, to: Outfit): Outfit[] {
	const id = (k: number): string => `${from.id}>${to.id}#${k}`;
	const hatOff: Outfit = { ...from, id: id(1), headwear: 'none', mouth: null };
	const topOff: Outfit = { ...hatOff, id: id(2), torso: 'bare', extras: [], scarf: null };
	const bare: Outfit = { ...topOff, id: id(3), legs: 'bare' };
	const legsOn: Outfit = { ...to, id: id(4), headwear: 'none', mouth: null, torso: 'bare', extras: [], scarf: null };
	const topOn: Outfit = { ...to, id: id(5), headwear: 'none', mouth: null };
	return [from, hatOff, topOff, bare, legsOn, topOn, to];
}

/** Where a change has got to. */
export type Stage = 'queued' | 'walking' | 'changing';

/** What changing needs from the cockpit. */
export interface ChangingDeps {
	crew: Crew;
	world: World;
	/** Turn the attendant away (true) or back round (false). */
	attendant(away: boolean): void;
	/** The comrade has reached the counter: the attendant hands over a token. */
	token?(): void;
	/** A piece came off or went on: a puff and a rustle at the comrade. */
	puff(id: string): void;
	/**
	 * Start rendering an outfit's standing frames facing the room, so it is ready in time.
	 *
	 * @param o Outfit.
	 * @param still True for a step worn only at the counter: no walk cycle is ever needed for it.
	 */
	prefetch(o: Outfit, still: boolean): void;
	/** The change is over: what prefetch started can go (whatever a comrade wears stays). */
	unfetch(o: Outfit): void;
	/** Something to say on the card changed. */
	onChange?(id: string): void;
}

/** The cloakroom's changing, for the cockpit. */
export interface Changing {
	/**
	 * Send a comrade to change. A change already under way for them is finished first, then this
	 * one follows; for someone waiting, only the newest look is kept.
	 *
	 * @param id Comrade.
	 * @param to What they will wear (their kept look, or their own).
	 */
	start(id: string, to: Outfit): void;
	/**
	 * Call the change off: they leave the roster, and a ceremony needs them (a farewell, a trial).
	 * Someone at the counter is dressed in a whole outfit again and handed back.
	 *
	 * @param id Comrade.
	 */
	cancel(id: string): void;
	/** What a comrade's change has got to, or null when they are not changing. */
	stageOf(id: string): Stage | null;
	/** The card's words for a comrade who is changing, or null. */
	words(id: string): string | null;
	/** Move everything along. */
	tick(dt: number): void;
	/** Comrades queued or changing, for checks. */
	readonly ids: string[];
}

/** One comrade's change. */
interface Errand {
	id: string;
	to: Outfit;
	stage: Stage;
	/** The outfits it goes through (set when they reach the counter). */
	steps: Outfit[];
	/** Which step is on now. */
	step: number;
	/** Time left in the current step, or until the next try to hold them (ms). */
	wait: number;
	/** Outfits prefetched for this change, let go when it ends. */
	fetched: Outfit[];
}

/**
 * How long a step stays on before the next.
 *
 * @param k Step index (0 dressed as they came, 3 nothing on).
 * @returns Milliseconds.
 */
const stepMs = (k: number): number => (k === 3 ? BARE_MS : STEP_MS);

/**
 * Set up the cloakroom's changing.
 *
 * @param d Dependencies.
 * @returns Changing.
 */
export function createChanging(d: ChangingDeps): Changing {
	const errands: Errand[] = [];
	const spot = d.world.marks.cloak;

	/**
	 * Start rendering an outfit for a change, once.
	 *
	 * @param e Errand.
	 * @param o Outfit.
	 * @param still Worn only at the counter.
	 */
	const warm = (e: Errand, o: Outfit, still = false): void => {
		if (e.fetched.some((f) => f.id === o.id)) return;
		e.fetched.push(o);
		d.prefetch(o, still);
	};
	/**
	 * Take an errand off the list and let its prefetched outfits go.
	 *
	 * @param e Errand.
	 */
	const drop = (e: Errand): void => {
		errands.splice(errands.indexOf(e), 1);
		for (const o of e.fetched) d.unfetch(o);
	};

	/**
	 * End a change: hand them back to the wardrobe and to placement, who walks them back.
	 *
	 * @param e Errand.
	 */
	const finish = (e: Errand): void => {
		// Another change waiting for them: they keep what they just put on until it is their turn.
		const again = errands.some((x) => x !== e && x.id === e.id);
		d.crew.dressAs(e.id, again ? e.to : null);
		d.crew.release(e.id, CHANGING);
		drop(e);
		d.attendant(false);
		d.onChange?.(e.id);
	};

	return {
		start(id, to) {
			const waiting = errands.find((e) => e.id === id && e.stage === 'queued');
			if (waiting) { waiting.to = to; warm(waiting, to); return; }
			// The wardrobe already says the new look: keep them in what they have on until they change.
			const c = d.crew.get(id);
			if (!c) return;
			if (!errands.some((e) => e.id === id)) d.crew.dressAs(id, c.outfit);
			const e: Errand = { id, to, stage: 'queued', steps: [], step: 0, wait: 0, fetched: [] };
			errands.push(e);
			warm(e, to);
			d.onChange?.(id);
		},
		cancel(id) {
			for (const e of errands.filter((x) => x.id === id)) {
				d.crew.dressAs(id, null);
				if (e.stage !== 'queued') { d.crew.release(id, CHANGING); d.attendant(false); }
				drop(e);
			}
			d.onChange?.(id);
		},
		stageOf: (id) => errands.find((e) => e.id === id)?.stage ?? null,
		words(id) {
			const e = errands.find((x) => x.id === id);
			if (!e) return null;
			if (e.stage === 'changing') return 'Changing at the cloakroom.';
			if (e.stage === 'walking') return 'Off to the cloakroom to change.';
			return 'Waiting for a turn at the cloakroom.';
		},
		get ids() { return errands.map((e) => e.id); },
		tick(dt) {
			// Anyone who has left the roster is dropped (a held one is removed on release).
			for (const e of [...errands]) {
				const c = d.crew.get(e.id);
				if (!c || c.gone) {
					d.crew.dressAs(e.id, null);
					if (e.stage !== 'queued') { d.crew.release(e.id, CHANGING); d.attendant(false); }
					drop(e);
				}
			}
			const busy = errands.find((e) => e.stage !== 'queued');
			if (!busy) {
				// The counter is free: the first in line who can go now goes. Someone a ceremony holds (a
				// hire waiting at the desk, the accused) is tried again later, without holding up the rest.
				for (const e of errands) e.wait -= dt;
				let next: Errand | null = null;
				for (const [k, e] of errands.entries()) {
					// A second change for the same comrade waits behind their first.
					if (e.wait > 0 || errands.slice(0, k).some((x) => x.id === e.id)) continue;
					if (d.crew.hold(e.id, CHANGING)) { next = e; break; }
					e.wait = RETRY_MS;
				}
				if (!next) return;
				next.stage = 'walking';
				if (!d.crew.walk(next.id, spot.pos)) d.crew.place(next.id, spot.pos);
				d.crew.pose(next.id, 'idle', spot.dir);
				d.onChange?.(next.id);
				return;
			}
			const c = d.crew.get(busy.id)!;
			if (busy.stage === 'walking') {
				if (c.path.length) return;
				// At the counter: a token for their clothes, and what they wear now is where the change starts.
				busy.stage = 'changing';
				d.token?.();
				busy.steps = stepOutfits(c.outfit, busy.to);
				// The steps between are only ever worn standing here; the last is walked home in.
				busy.steps.slice(1, -1).forEach((o) => warm(busy, o, true));
				busy.step = 0;
				busy.wait = STEP_MS;
				d.onChange?.(busy.id);
				return;
			}
			busy.wait -= dt;
			if (busy.wait > 0) return;
			busy.step++;
			if (busy.step >= busy.steps.length) { finish(busy); return; }
			d.crew.dressAs(busy.id, busy.steps[busy.step]);
			d.puff(busy.id);
			// She turns away as the last piece comes off, and back once something is on again.
			if (busy.step === 3) d.attendant(true);
			if (busy.step === 4) d.attendant(false);
			busy.wait = stepMs(busy.step);
		},
	};
}
