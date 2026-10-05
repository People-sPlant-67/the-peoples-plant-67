/**
 * Bake the wasteland behind the plant once the plant is already on screen: the ground,
 * cut into pieces no wider or taller than PIECE (so no device's texture limit is tripped), then the
 * landmarks, furthest first. Normally a worker of its own does it all (bakeInWorker), so the page
 * only places finished pieces. Where no worker can start, or one fails or falls silent, the page
 * bakes it in idle-time slices instead (bakeBackdrop); startBackdrop chooses. All are pure over a
 * `place` callback; the stage turns each piece into a sprite.
 */
import { type BaseFrame, type WasteLayer, farthestFirst, renderLandmark, wasteGround, wasteLandmarks } from '../art/wasteland';

/** Longest side of one backdrop texture. */
export const PIECE = 1024;
/** Rows of ground filled per step in the page's own bake (about a millisecond each). */
const ROWS = 6;
/** Time one slice of the page's own bake may take before handing back (ms). */
const BUDGET_MS = 10;
/** A worker that has sent nothing for this long is taken to have failed (ms). */
export const WORKER_SILENCE_MS = 20_000;

/** A rectangle of pixels for the stage, in the plant base frame's pixel space. */
export type Piece = WasteLayer;

export interface BackdropOptions {
	/** The plant's base frame: the backdrop lines up with it. */
	base: BaseFrame;
	/** The railway's world y, which the yard's rails follow out of the goods doors. */
	trackY: number;
	/** Called with each piece, back to front. */
	place: (p: Piece) => void;
	/** Called once everything is placed. */
	done?: () => void;
	/** Takes away every piece placed so far (before the page starts over after a worker failed). */
	clear?: () => void;
	/** Runs a slice later. Defaults to requestIdleCallback, or a timeout where there is none. */
	schedule?: (fn: () => void) => void;
	/** Clock (ms), for the bake's time and the worker's silence. */
	now?: () => number;
}

export interface Backdrop {
	/** Everything is placed. */
	readonly done: boolean;
	/** How long the bake took from start to the last piece (ms), or null until done. */
	readonly ms: number | null;
	/** Who is baking: a worker of its own, or the page (no worker could, or one failed). */
	readonly how: 'worker' | 'page';
	/** Stop baking; nothing more is placed. */
	stop(): void;
}

/**
 * A layer's pieces, no bigger than PIECE on a side, row by row, one at a time.
 *
 * @param layer The layer.
 * @yields Pieces.
 */
export function* pieces(layer: Piece): Generator<Piece> {
	for (let y = 0; y < layer.h; y += PIECE) {
		for (let x = 0; x < layer.w; x += PIECE) {
			const w = Math.min(PIECE, layer.w - x), h = Math.min(PIECE, layer.h - y);
			const rgba = new Uint8ClampedArray(w * h * 4);
			for (let j = 0; j < h; j++) rgba.set(layer.rgba.subarray(((y + j) * layer.w + x) * 4, ((y + j) * layer.w + x + w) * 4), j * w * 4);
			yield { x: layer.x + x, y: layer.y + y, w, h, rgba };
		}
	}
}

/**
 * Cut a layer into pieces no bigger than PIECE on a side.
 *
 * @param layer The layer.
 * @returns Pieces, row by row.
 */
export function cut(layer: Piece): Piece[] {
	return [...pieces(layer)];
}

/**
 * The default way to run a slice later: when the browser is idle, or soon if it never is.
 *
 * @param fn Slice.
 */
function idle(fn: () => void): void {
	const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
	if (ric) ric(fn, { timeout: 250 }); else setTimeout(fn, 16);
}

/**
 * Bake the backdrop on the page, in idle-time slices: a few rows of ground at a time, then one
 * piece, then one landmark, per slice.
 *
 * @param o Options.
 * @returns Controls.
 */
export function bakeBackdrop(o: BackdropOptions): Backdrop {
	const now = o.now ?? (() => performance.now());
	const schedule = o.schedule ?? idle;
	const started = now();
	const ground = wasteGround(o.base, o.trackY);
	const marks = farthestFirst(wasteLandmarks());
	let cutting: Generator<Piece> | null = null;
	let stopped = false;
	let done = false;
	let ms: number | null = null;

	/** One slice of work, then the next is scheduled. */
	const slice = (): void => {
		if (stopped) return;
		if (!cutting) {
			const until = now() + BUDGET_MS;
			let filled = false;
			while (!filled && now() < until) filled = ground.next(ROWS);
			if (filled) cutting = pieces(ground.layer);
		} else {
			const next = cutting.next();
			if (!next.done) o.place(next.value);
			else if (marks.length) {
				const m = renderLandmark(o.base, marks.shift()!);
				o.place({ x: m.x, y: m.y, w: m.sprite.w, h: m.sprite.h, rgba: m.sprite.rgba });
			} else {
				done = true;
				ms = now() - started;
				o.done?.();
				return;
			}
		}
		schedule(slice);
	};
	schedule(slice);

	return {
		get done() { return done; },
		get ms() { return ms; },
		how: 'page',
		stop() { stopped = true; },
	};
}

/**
 * Every piece of the backdrop, back to front, in one go: what a worker runs.
 *
 * @param base The plant's base frame.
 * @param trackY The railway's world y.
 * @param emit Called with each piece.
 */
export function backdropPieces(base: BaseFrame, trackY: number, emit: (p: Piece) => void): void {
	const ground = wasteGround(base, trackY);
	while (!ground.next(256));
	for (const p of pieces(ground.layer)) emit(p);
	for (const m of farthestFirst(wasteLandmarks())) {
		const s = renderLandmark(base, m);
		emit({ x: s.x, y: s.y, w: s.sprite.w, h: s.sprite.h, rgba: s.sprite.rgba });
	}
}

/** What the page asks a worker for. */
export interface BackdropRequest { backdrop: { base: BaseFrame; trackY: number } }
/** What the worker sends back: a piece (its pixels transferred), the end, or a failure. */
export type BackdropReply =
	| { backdropPiece: { x: number; y: number; w: number; h: number; rgba: ArrayBuffer } }
	| { backdropDone: true }
	| { backdropFailed: string };

/** The slice of a Worker used here. */
export type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

/**
 * Bake the backdrop in a worker of its own, which is let go once it is done or has failed.
 *
 * @param worker A fresh worker running sprite-worker.ts.
 * @param o Options (schedule is not used).
 * @param onFail Called once if the worker fails to load, reports a failure, or falls silent for
 *   WORKER_SILENCE_MS; it has been let go by then, and has placed only whole pieces.
 * @returns Controls.
 */
export function bakeInWorker(worker: WorkerLike, o: BackdropOptions, onFail: (why: string) => void = () => {}): Backdrop {
	const now = o.now ?? (() => performance.now());
	const started = now();
	let done = false;
	let over = false;
	let ms: number | null = null;
	let silence: ReturnType<typeof setTimeout> | null = null;
	/** Let the worker go. */
	const end = (): void => {
		over = true;
		if (silence) clearTimeout(silence);
		worker.onmessage = null;
		worker.onerror = null;
		worker.terminate();
	};
	/**
	 * Give up on the worker, once.
	 *
	 * @param why What went wrong.
	 */
	const fail = (why: string): void => { if (over) return; end(); onFail(why); };
	/** Restart the silence watch: a worker busy on a big piece still answers well within it. */
	const watch = (): void => {
		if (silence) clearTimeout(silence);
		silence = setTimeout(() => fail('The worker fell silent.'), WORKER_SILENCE_MS);
	};
	worker.onmessage = (e: MessageEvent<BackdropReply>) => {
		if (over) return;
		const r = e.data;
		if ('backdropPiece' in r) { watch(); o.place({ ...r.backdropPiece, rgba: new Uint8ClampedArray(r.backdropPiece.rgba) }); }
		else if ('backdropDone' in r) { done = true; ms = now() - started; end(); o.done?.(); }
		else fail(r.backdropFailed);
	};
	// A worker its page's security policy forbids does not throw: it fires an error instead.
	worker.onerror = (e: ErrorEvent) => { e.preventDefault?.(); fail(e.message || 'The worker could not start.'); };
	watch();
	const { w, h, ax, ay, view } = o.base;
	worker.postMessage({ backdrop: { base: { w, h, ax, ay, view }, trackY: o.trackY } } satisfies BackdropRequest);
	return {
		get done() { return done; },
		get ms() { return ms; },
		how: 'worker',
		stop() { end(); },
	};
}

/**
 * Bake the backdrop in a worker if one will start and finish, else on the page.
 *
 * @param makeWorker Starts a fresh worker running sprite-worker.ts.
 * @param o Options.
 * @returns Controls, which follow whichever bake is running.
 */
export function startBackdrop(makeWorker: () => WorkerLike, o: BackdropOptions): Backdrop {
	let current: Backdrop;
	/**
	 * Hand the bake to the page, which starts over: whatever the worker placed is taken away first,
	 * so no piece is kept twice.
	 *
	 * @param why What went wrong with the worker.
	 */
	const onPage = (why: string): void => {
		console.warn(`The wasteland is being drawn on the page instead of in a worker: ${why}`);
		o.clear?.();
		current = bakeBackdrop(o);
	};
	try { current = bakeInWorker(makeWorker(), o, onPage); } catch { current = bakeBackdrop(o); }
	return {
		get done() { return current.done; },
		get ms() { return current.ms; },
		get how() { return current.how; },
		stop() { current.stop(); },
	};
}
