/**
 * Scenes: short scripted sequences (a train arrival, a quiet departure, a trial) that take
 * comrades out of placement's hands for a while. A scene is a list of steps run in order; a
 * scene starts only when everything it needs is free (its comrades, the train, the court), so
 * two trains never share the platform and two trials never share the dock.
 *
 * Pure and DOM-free: effects (doors, train, stamps, the photo) are reported through `fx` and
 * drawn by the app. Tested in tests/cockpit-scenes.test.ts.
 */
import type { Anim, Dir } from '../art/avatar';
import type { V3 } from '../art/sdf';
import { type Crew, inScene } from './crew';

/** Longest a scene waits for walkers to arrive before carrying on regardless. */
export const ARRIVE_TIMEOUT_MS = 60_000;
/** Most ceremonies played back after an absence; the rest go into the "while you were away" notice. */
export const REPLAY_CAP = 3;

/** One thing a scene does. Steps run one after another; walks start and the scene carries on. */
export type Step =
	| { do: 'walk'; id: string; to: V3 }
	| { do: 'place'; id: string; pos: V3 }
	| { do: 'pose'; id: string; anim: Anim | null; dir?: Dir | null }
	| { do: 'hide'; id: string }
	| { do: 'show'; id: string }
	/** Wait until these comrades have stopped walking. */
	| { do: 'arrive'; ids: string[] }
	| { do: 'wait'; ms: number }
	/** Wait until a condition holds (a verdict, an approval). Checked every step. */
	| { do: 'until'; test: () => boolean }
	/** Tell the app to play an effect, then wait `ms` for it. */
	| { do: 'fx'; name: string; args?: Record<string, unknown>; ms?: number }
	/** Decide the rest of the scene now, from whatever has happened so far. */
	| { do: 'branch'; pick: () => Step[] }
	| { do: 'release'; id: string }
	/** Stop needing a resource before the scene ends (the train, once it has gone). */
	| { do: 'drop'; use: Resource }
	/** Wait until a resource is free, then take it. */
	| { do: 'claim'; use: Resource }
	/** Bring more comrades into the scene (those free to come), then continue with `then(got)`. */
	| { do: 'summon'; ids: () => string[]; then: (got: string[]) => Step[] };

/** Things only one scene can use at a time, besides its comrades. */
export type Resource = 'train' | 'court';

export interface Scene {
	/** Unique id; also the owner name when holding comrades. */
	id: string;
	/** What it is, for the notice and the tests. */
	kind: 'arrival' | 'departure' | 'trial' | 'tribunal';
	/** Comrades it holds for its whole run. */
	cast: string[];
	uses: Resource[];
	steps: Step[];
	/** A ceremony counts towards the replay cap; background scenes do not. */
	ceremony: boolean;
	/** One line for the "while you were away" notice if it is dropped from a replay. */
	summary: string;
	/** The name of the comrade it is about, for the record. */
	who: string;
	/** Called once when the scene ends, however it ends. */
	onEnd?: () => void;
}

export interface Director {
	/** Add a scene to the queue. A scene with the same id already queued or running is ignored. */
	enqueue(s: Scene): void;
	/** Advance running scenes and start queued ones whose needs are free. */
	step(dt: number): void;
	/** Stop a scene now (queued or running), releasing its comrades. */
	cancel(id: string): void;
	has(id: string): boolean;
	/** Ids of running scenes. */
	running(): string[];
	/** Ids of every scene, running first, then queued in order. */
	ids(): string[];
	/**
	 * Keep at most REPLAY_CAP queued ceremonies (the oldest), dropping the rest.
	 *
	 * @returns The scenes dropped, for the notice (and the record).
	 */
	trimBacklog(): Scene[];
}

/** A scene in progress. */
interface Run {
	scene: Scene;
	steps: Step[];
	/** Time spent on the current step, ms. */
	t: number;
	/** The current step's effect has been played. */
	fired: boolean;
	/** Resources still in use (a scene can let the train go early, or claim the court late). */
	uses: Resource[];
	/** Comrades held, including any summoned during the run. */
	cast: string[];
}

/**
 * Create the director.
 *
 * @param crew Crew to hold and move comrades in.
 * @param fx Plays an effect (the app draws it).
 * @returns Director.
 */
export function createDirector(crew: Crew, fx: (name: string, args: Record<string, unknown>) => void): Director {
	const queue: Scene[] = [];
	const runs = new Map<string, Run>();

	/**
	 * Whether a scene's needs are free now.
	 *
	 * @param s Scene.
	 * @returns True when it can start.
	 */
	const free = (s: Scene): boolean => {
		for (const r of runs.values()) {
			if (s.uses.some((u) => r.uses.includes(u))) return false;
			if (s.cast.some((id) => r.cast.includes(id))) return false;
		}
		// A comrade on a break is free: the scene takes them from it.
		return s.cast.every((id) => { const c = crew.get(id); return !!c && (!inScene(c) || c.held === s.id); });
	};

	/**
	 * End a scene: release whoever it still holds and call its onEnd.
	 *
	 * @param id Scene id.
	 */
	const finish = (id: string): void => {
		const r = runs.get(id);
		if (!r) return;
		runs.delete(id);
		for (const cid of r.cast) crew.release(cid, id);
		r.scene.onEnd?.();
	};

	/**
	 * Run a scene's steps until one has to wait.
	 *
	 * @param r Run.
	 * @param dt Milliseconds since the last step.
	 */
	const advance = (r: Run, dt: number): void => {
		r.t += dt;
		for (let guard = 0; guard < 200 && r.steps.length; guard++) {
			const s = r.steps[0];
			let done = true;
			switch (s.do) {
				case 'walk': crew.walk(s.id, s.to); break;
				case 'place': crew.place(s.id, s.pos); break;
				case 'pose': crew.pose(s.id, s.anim, s.dir ?? null); break;
				case 'hide': crew.setHidden(s.id, true); break;
				case 'show': crew.setHidden(s.id, false); break;
				case 'release':
					crew.release(s.id, r.scene.id);
					// Released comrades leave the cast, so a later summon can bring them back.
					r.cast = r.cast.filter((id) => id !== s.id);
					break;
				case 'arrive': done = r.t >= ARRIVE_TIMEOUT_MS || s.ids.every((id) => !crew.get(id)?.path.length); break;
				case 'wait': done = r.t >= s.ms; break;
				case 'until': done = s.test(); break;
				case 'fx':
					// Fire once on entering the step, then wait out its length.
					if (!r.fired) { r.fired = true; fx(s.name, s.args ?? {}); }
					done = r.t >= (s.ms ?? 0);
					break;
				case 'branch': r.steps.splice(1, 0, ...s.pick()); break;
				case 'drop': r.uses = r.uses.filter((u) => u !== s.use); break;
				case 'claim':
					done = ![...runs.values()].some((o) => o !== r && o.uses.includes(s.use));
					if (done && !r.uses.includes(s.use)) r.uses.push(s.use);
					break;
				case 'summon': {
					const got = s.ids().filter((id) => !r.cast.includes(id) && crew.hold(id, r.scene.id));
					r.cast.push(...got);
					r.steps.splice(1, 0, ...s.then(got));
					break;
				}
			}
			if (!done) return;
			r.steps.shift();
			r.t = 0;
			r.fired = false;
			dt = 0;
		}
		if (!r.steps.length) finish(r.scene.id);
	};

	return {
		enqueue(s) {
			if (runs.has(s.id) || queue.some((q) => q.id === s.id)) return;
			queue.push(s);
		},
		step(dt) {
			for (let i = 0; i < queue.length;) {
				const s = queue[i];
				// A comrade who vanished before their scene started (and was not kept) has nothing to play.
				if (s.cast.some((id) => !crew.get(id))) { queue.splice(i, 1); s.onEnd?.(); continue; }
				if (!free(s)) { i++; continue; }
				queue.splice(i, 1);
				for (const id of s.cast) crew.hold(id, s.id);
				const r: Run = { scene: s, steps: [...s.steps], t: 0, fired: false, uses: [...s.uses], cast: [...s.cast] };
				runs.set(s.id, r);
				advance(r, 0);
			}
			for (const r of [...runs.values()]) advance(r, dt);
		},
		cancel(id) {
			const q = queue.findIndex((s) => s.id === id);
			if (q >= 0) {
				const [s] = queue.splice(q, 1);
				for (const cid of s.cast) crew.release(cid, s.id);
				s.onEnd?.();
			}
			finish(id);
		},
		has: (id) => runs.has(id) || queue.some((s) => s.id === id),
		running: () => [...runs.keys()],
		ids: () => [...runs.keys(), ...queue.map((s) => s.id)],
		trimBacklog() {
			const ceremonies = queue.filter((s) => s.ceremony);
			const drop = ceremonies.slice(REPLAY_CAP);
			for (const s of drop) {
				queue.splice(queue.indexOf(s), 1);
				// Dropped ceremonies still have to leave the stage: release (a gone comrade is removed).
				for (const cid of s.cast) { crew.setHidden(cid, false); crew.release(cid, s.id); }
				s.onEnd?.();
			}
			return drop;
		},
	};
}
