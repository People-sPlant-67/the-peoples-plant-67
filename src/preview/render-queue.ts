/**
 * Priority render queue with de-duplication and cancellation. Knows nothing about sprites,
 * workers or the DOM: work is handed to an injected executor, so the scheduling rules can be
 * tested in Node with a fake one (tests/render-queue.test.ts).
 *
 * Rules:
 * - Lower priority numbers run first. Level 0 (the frame on screen now) runs newest-first,
 *   because when someone clicks through directions quickly only the latest click matters.
 *   Every other level runs in request order, so an animation fills in frame by frame.
 * - A second request for a key already queued or running shares the first one's promise.
 *   If it is more urgent, the queued job moves up; a running job is left alone.
 * - `cancel(group)` rejects every job in the group with a CancelledError. Queued jobs never
 *   run. A running job cannot be interrupted (a worker is mid-render), so its result is
 *   thrown away when it lands.
 * - At most `concurrency` jobs run at once: one per worker in the pool.
 */

/** Rejection reason for jobs dropped by `cancel`. Callers usually ignore it. */
export class CancelledError extends Error {
	/**
	 * @param {string} key Key of the job that was cancelled.
	 */
	constructor(key: string) {
		super(`The render job "${key}" was cancelled because its group was dropped.`);
		this.name = 'CancelledError';
	}
}

/**
 * Whether a rejection is just a cancellation, which callers should not report as a failure.
 *
 * @param {unknown} err Rejection reason.
 * @returns {boolean} True for a CancelledError.
 */
export function isCancelled(err: unknown): boolean {
	return err instanceof CancelledError;
}

/** Does the work for one request. Must not assume it runs on any particular thread. */
export type Executor<Req, Res> = (req: Req) => Promise<Res>;

interface Job<Req, Res> {
	key: string;
	group: string;
	req: Req;
	priority: number;
	/** Request sequence number; refreshed when a level-0 request repeats, so it counts as newest. */
	seq: number;
	running: boolean;
	cancelled: boolean;
	promise: Promise<Res>;
	resolve: (r: Res) => void;
	reject: (e: unknown) => void;
}

export class RenderQueue<Req, Res> {
	/** Queued and running jobs by key. A job leaves when it settles or is cancelled. */
	private readonly jobs = new Map<string, Job<Req, Res>>();
	private active = 0;
	private seq = 0;

	/**
	 * @param {Executor} exec Runs one request.
	 * @param {number} concurrency Maximum jobs in flight at once (at least 1).
	 */
	constructor(private readonly exec: Executor<Req, Res>, private readonly concurrency = 1) {
		if (!(concurrency >= 1)) throw new Error(`A render queue needs a concurrency of at least 1, not ${concurrency}.`);
	}

	/** Jobs waiting to start. */
	get queued(): number {
		// Counted, not derived from `active`: a cancelled job still running has already left `jobs`.
		let n = 0;
		for (const j of this.jobs.values()) if (!j.running) n++;
		return n;
	}

	/** Jobs currently running. */
	get running(): number {
		return this.active;
	}

	/**
	 * Ask for a result. Shares the promise of an identical request already in the queue.
	 *
	 * @param {string} key Identity of the work; equal keys must mean equal results.
	 * @param {string} group Cancellation group (for sprites, the outfit id).
	 * @param {Req} req Request passed to the executor if this key is not already pending.
	 * @param {number} priority 0 is most urgent.
	 * @returns {Promise<Res>} Settles with the executor's result, or rejects with its error or a CancelledError.
	 */
	request(key: string, group: string, req: Req, priority: number): Promise<Res> {
		const hit = this.jobs.get(key);
		if (hit) {
			if (!hit.running) {
				if (priority < hit.priority) hit.priority = priority;
				if (priority === 0) hit.seq = ++this.seq;
			}
			return hit.promise;
		}
		let resolve!: (r: Res) => void, reject!: (e: unknown) => void;
		const promise = new Promise<Res>((a, b) => { resolve = a; reject = b; });
		// Callers often fire and forget prebake requests; a cancelled one must not surface as an
		// unhandled rejection. Anyone who awaits the promise still sees the rejection.
		promise.catch(() => {});
		this.jobs.set(key, { key, group, req, priority, seq: ++this.seq, running: false, cancelled: false, promise, resolve, reject });
		this.pump();
		return promise;
	}

	/**
	 * Push every queued job that is more urgent than `priority` down to it. Used when the
	 * view moves on: the old animation's frames are still worth rendering, just later.
	 *
	 * @param {number} priority Level to demote to.
	 */
	demote(priority: number): void {
		for (const j of this.jobs.values()) if (!j.running && j.priority < priority) j.priority = priority;
	}

	/**
	 * Drop every job in a group. Queued jobs never run; running ones have their result discarded.
	 *
	 * @param {string} group Group to drop.
	 * @returns {number} How many jobs were cancelled.
	 */
	cancel(group: string): number {
		let n = 0;
		for (const j of [...this.jobs.values()]) {
			if (j.group !== group) continue;
			j.cancelled = true;
			// Remove even a running job, so a fresh request for the same key starts a new job
			// instead of joining one whose promise is already rejected.
			this.jobs.delete(j.key);
			j.reject(new CancelledError(j.key));
			n++;
		}
		return n;
	}

	/**
	 * Start queued jobs until the concurrency limit is reached.
	 */
	private pump(): void {
		while (this.active < this.concurrency) {
			const j = this.next();
			if (!j) return;
			this.start(j);
		}
	}

	/**
	 * Most urgent queued job: lowest priority, then newest at level 0 and oldest elsewhere.
	 * A linear scan: a few thousand queued frames cost well under a millisecond per pick.
	 *
	 * @returns {Job | undefined} The job to run next, if any.
	 */
	private next(): Job<Req, Res> | undefined {
		let best: Job<Req, Res> | undefined;
		for (const j of this.jobs.values()) {
			if (j.running) continue;
			if (!best || j.priority < best.priority) { best = j; continue; }
			if (j.priority === best.priority && (j.priority === 0 ? j.seq > best.seq : j.seq < best.seq)) best = j;
		}
		return best;
	}

	/**
	 * Run one job and, when it settles, free its slot and start the next.
	 *
	 * @param {Job} j Job to run.
	 */
	private start(j: Job<Req, Res>): void {
		j.running = true;
		this.active++;
		// Through a microtask, so an executor that throws synchronously becomes a rejection.
		Promise.resolve()
			.then(() => this.exec(j.req))
			.then((r) => { if (!j.cancelled) j.resolve(r); }, (e) => { if (!j.cancelled) j.reject(e); })
			.finally(() => {
				this.active--;
				if (this.jobs.get(j.key) === j) this.jobs.delete(j.key);
				this.pump();
			});
	}
}
