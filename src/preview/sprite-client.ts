/**
 * Sprite render client for the page: a RenderQueue in front of a small pool of render
 * workers. The page asks for frames by outfit, animation, direction and frame and gets a
 * promise; it never renders on the main thread unless workers are unavailable.
 */

import type { Anim, Dir } from '../art/avatar';
import type { Outfit } from '../art/outfits';
import type { Facing, PieceKind } from '../art/furniture';
import { type AmbientRequest, type JobRequest, type SpritePixels, ambientKey, renderJob, spriteKey } from '../art/sprite-job';
import { type Executor, RenderQueue } from './render-queue';
import type { WorkerIn, WorkerOut } from './sprite-worker';

/** Queue levels, most urgent first. */
export const PRI = {
	/** The frame the comrade should be showing right now. */
	VISIBLE: 0,
	/** The rest of the current animation in the current direction: needed within milliseconds. */
	ANIM: 1,
	/** The current animation in the other directions: the contact sheet and a turn. */
	SHEET: 2,
	/** Every other animation, baked in the background. */
	PREBAKE: 3,
} as const;

export interface SpriteClient {
	/**
	 * Ask for one frame. Identical requests in flight share one render.
	 *
	 * @returns Pixels and head-top point; rejects with a CancelledError if the outfit is dropped.
	 */
	request(outfit: Outfit, anim: Anim, dir: Dir, frame: number, priority: number): Promise<SpritePixels>;
	/**
	 * Ask for a furniture piece, turned. Its `top` is where it stands: the middle of its tile.
	 *
	 * @returns Pixels.
	 */
	piece(kind: PieceKind, facing: Facing, priority: number): Promise<SpritePixels>;
	/**
	 * Ask for a piece of the life around the plant: smoke, a pigeon, the far train, a landmark.
	 *
	 * @returns Pixels.
	 */
	ambient(req: AmbientRequest, priority: number): Promise<SpritePixels>;
	/** Push queued work that is more urgent than `priority` down to it. */
	demote(priority: number): void;
	/** Cancel every pending frame of an outfit. */
	drop(outfitId: string): void;
	/** How the frames are rendered, for the status line. */
	describe(): string;
}

/**
 * Size of the worker pool: leave a core for the page, and stop at 4 because an outfit is only
 * 144 frames and more workers mostly add start-up cost and memory.
 *
 * @returns {number} Worker count, 1 to 4.
 */
function poolSize(): number {
	const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
	return Math.max(1, Math.min(4, cores - 1));
}

/**
 * Executor that renders on the calling thread, one frame per macrotask so the page can
 * repaint between frames. The fallback when Web Workers cannot start.
 *
 * @returns {Executor} Executor.
 */
function inlineExecutor(): Executor<JobRequest, SpritePixels> {
	return (req) => new Promise((resolve, reject) => {
		setTimeout(() => { try { resolve(renderJob(req)); } catch (e) { reject(e); } }, 0);
	});
}

interface Slot {
	worker: Worker;
	/** The one job this worker is running (the queue never gives a worker two at once). */
	pending: { id: number; req: JobRequest; resolve: (p: SpritePixels) => void; reject: (e: unknown) => void } | null;
	/** Set after the first reply, so a load failure can be told apart from a bad frame. */
	alive: boolean;
}

/**
 * Create the client with a worker pool, falling back to main-thread rendering if a worker
 * cannot be constructed or its script fails to load (for example under a stricter CSP).
 *
 * @param {() => Worker} makeWorker Builds one render worker running sprite-worker.ts: see
 *   module-worker.ts for pages Vite serves, and extension-entry.ts for the Blob URL version.
 * @param {number} size Worker count; defaults to cores minus one, capped at 4.
 * @returns {SpriteClient} Client.
 */
export function createSpriteClient(makeWorker: () => Worker, size = poolSize()): SpriteClient {
	const inline = inlineExecutor();
	let broken = typeof Worker === 'undefined';
	let reason = broken ? 'this browser has no Web Workers' : '';
	const slots: Slot[] = [];
	let nextId = 0;

	/**
	 * Give up on workers for good and render on the main thread from now on.
	 *
	 * @param {string} why Reason, for the console and status line.
	 */
	const fallBack = (why: string): void => {
		if (broken) return;
		broken = true;
		reason = why;
		console.warn(`[plant] Sprite workers are unavailable (${why}), so frames render on the main thread and the page may stutter.`);
		for (const s of slots) {
			s.worker.terminate();
			// Jobs caught mid-flight would otherwise never settle and hold their queue slot forever.
			const p = s.pending;
			s.pending = null;
			if (p) inline(p.req).then(p.resolve, p.reject);
		}
	};

	if (!broken) {
		try {
			for (let k = 0; k < size; k++) {
				const slot: Slot = { worker: makeWorker(), pending: null, alive: false };
				slot.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
					const p = slot.pending;
					slot.alive = true;
					if (!p || p.id !== e.data.id) return;
					slot.pending = null;
					const m = e.data;
					if (m.ok) p.resolve({ w: m.w, h: m.h, rgba: new Uint8ClampedArray(m.rgba), top: m.top });
					else p.reject(new Error(`A comrade frame could not be rendered: ${m.message}`));
				};
				slot.worker.onerror = (e) => {
					e.preventDefault();
					// Never replied: the script itself failed to load, so no frame will ever come
					// from any worker. Switch to the main thread; fallBack redoes pending jobs there.
					if (!slot.alive) { fallBack(e.message || 'the worker script failed to load'); return; }
					const p = slot.pending;
					slot.pending = null;
					if (p) p.reject(new Error(`A render worker crashed: ${e.message}`));
				};
				slots.push(slot);
			}
		} catch (err) {
			fallBack((err as Error).message);
		}
	}

	const viaWorkers: Executor<JobRequest, SpritePixels> = (req) => {
		if (broken) return inline(req);
		// The queue's concurrency equals the pool size, so a free slot always exists here.
		const slot = slots.find((s) => !s.pending);
		if (!slot) return Promise.reject(new Error('Every render worker is busy; the queue let too many jobs through.'));
		return new Promise((resolve, reject) => {
			const id = ++nextId;
			slot.pending = { id, req, resolve, reject };
			slot.worker.postMessage({ id, req } satisfies WorkerIn);
		});
	};

	const queue = new RenderQueue<JobRequest, SpritePixels>(viaWorkers, broken ? 1 : slots.length);
	return {
		request: (outfit, anim, dir, frame, priority) =>
			queue.request(spriteKey(outfit.id, anim, dir, frame), outfit.id, { outfit, anim, dir, frame }, priority),
		piece: (kind, facing, priority) => queue.request(`piece|${kind}|${facing}`, 'furniture', { piece: kind, facing }, priority),
		ambient: (req, priority) => {
			return queue.request(`ambient|${ambientKey(req)}`, 'ambient', req, priority);
		},
		demote: (p) => queue.demote(p),
		drop: (id) => { queue.cancel(id); },
		describe: () => (broken ? `on the main thread, because ${reason}` : `in ${slots.length} background worker${slots.length === 1 ? '' : 's'}`),
	};
}
