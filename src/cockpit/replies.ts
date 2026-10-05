/**
 * The reply check behind the reply bubble: every REPLY_CHECK_MS, while the tab is visible, look
 * at the newest comment on the most recent directives and flag a comrade who has written since
 * the owner last looked. One request per directive, one at a time, at most REPLY_CHECK_MAX.
 */
import { latestMessage } from '../live/directives';
import type { FetchLike } from '../live/http';
import type { TrackedList } from './tracked';

/** Gap between checks. */
export const REPLY_CHECK_MS = 30_000;
/** Most directives checked each time (the newest ones). */
export const REPLY_CHECK_MAX = 8;

export interface ReplyWatchOptions {
	fetchImpl: FetchLike;
	tracked: TrackedList;
	/** Called after a check that changed who has unread replies. */
	onChange: () => void;
	isHidden?: () => boolean;
	intervalMs?: number;
	/** Injectable timers, as in the poller. */
	timers?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
}

export interface ReplyWatch {
	/** Check now. Resolves when done; a check already running is joined, not repeated. */
	check(): Promise<void>;
	start(): void;
	stop(): void;
}

/**
 * Create the watch. Nothing happens until start().
 *
 * @param o Options.
 * @returns Controls.
 */
export function createReplyWatch(o: ReplyWatchOptions): ReplyWatch {
	const isHidden = o.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
	const timers = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
	let timer: unknown = null;
	let running = false;
	let busy: Promise<void> | null = null;

	/**
	 * One pass over the newest directives that are not already flagged.
	 *
	 * @returns Resolves when every request is done.
	 */
	async function pass(): Promise<void> {
		let changed = false;
		for (const t of o.tracked.all().filter((x) => !x.unread).slice(0, REPLY_CHECK_MAX)) {
			const r = await latestMessage(o.fetchImpl, t.issueId);
			// A failure here is not worth a message: the poller already reports the connection.
			if (!r.ok || !r.value) continue;
			if (o.tracked.sawLatest(t.issueId, r.value.at, r.value.author.kind === 'agent')) changed = true;
		}
		if (changed) o.onChange();
	}

	/** Check, then schedule the next check. */
	function tick(): void {
		timer = null;
		/** Schedule the check after this one, unless the watch was stopped. */
		const next = (): void => { if (running) timer = timers.set(tick, o.intervalMs ?? REPLY_CHECK_MS); };
		if (isHidden()) { next(); return; }
		void check().finally(next);
	}

	/**
	 * Check now, joining a check already running.
	 *
	 * @returns Resolves when done.
	 */
	function check(): Promise<void> {
		busy ??= pass().catch((err) => console.error('Plant reply check failed.', err)).finally(() => { busy = null; });
		return busy;
	}

	return {
		check,
		start() {
			if (running) return;
			running = true;
			tick();
		},
		stop() {
			running = false;
			if (timer !== null) timers.clear(timer);
			timer = null;
		},
	};
}
