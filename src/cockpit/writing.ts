/**
 * Who is writing an answer in their Agent Chat, for the "…" thought bubble. Paperclip has no list
 * of chats, so this watches only the chats the owner has written in from the plant (remembered in
 * tracked.ts), and only recently written ones: one request per chat, one at a time.
 */
import { getThread } from '../live/directives';
import type { FetchLike } from '../live/http';
import type { TrackedList } from './tracked';

/** Gap between checks. */
export const WRITING_CHECK_MS = 8_000;
/** A chat is watched for this long after the owner last wrote in it (or while its comrade writes). */
export const WRITING_RECENT_MS = 6 * 60 * 60 * 1000;
/** Most chats checked each time (the most recently written in). */
export const WRITING_MAX = 6;
/** How long the open chat's word stands for a comrade this watch does not check itself. */
export const PANEL_WORD_MS = 20_000;
/** Failed reads in a row after which a comrade's "…" is dropped rather than kept. */
export const WRITING_FAILS_MAX = 3;

export interface WritingWatchOptions {
	fetchImpl: FetchLike;
	tracked: TrackedList;
	/** Called with the new set whenever someone starts or stops writing. */
	onChange: (writing: ReadonlySet<string>) => void;
	/** Called when a comrade stops writing: their answer has probably landed. */
	onDone?: (agentId: string) => void;
	isHidden?: () => boolean;
	now?: () => number;
	intervalMs?: number;
	/** Injectable timers, as in the poller. */
	timers?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
}

export interface WritingWatch {
	/** Comrades writing an answer now. */
	readonly writing: ReadonlySet<string>;
	/**
	 * What the open chat saw, which is fresher than the last check.
	 *
	 * @param agentId Comrade.
	 * @param active True while they write.
	 */
	see(agentId: string, active: boolean): void;
	/** Check now. Resolves when done; a check already running is joined. */
	check(): Promise<void>;
	/** Check now and then every WRITING_CHECK_MS while the tab is visible. */
	start(): void;
	/** Stop checking. */
	stop(): void;
}

/**
 * Create the watch. Nothing happens until start().
 *
 * @param o Options.
 * @returns Controls.
 */
export function createWritingWatch(o: WritingWatchOptions): WritingWatch {
	const isHidden = o.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
	const now = o.now ?? Date.now;
	const timers = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
	let writing = new Set<string>();
	/** When the open chat last said a comrade was writing. */
	const panelSaid = new Map<string, number>();
	/** Failed reads in a row, per comrade. */
	const fails = new Map<string, number>();
	let timer: unknown = null;
	let running = false;
	let busy: Promise<void> | null = null;

	/**
	 * Take a new set, and say who started or stopped.
	 *
	 * @param next Comrades writing now.
	 */
	const become = (next: Set<string>): void => {
		const done = [...writing].filter((id) => !next.has(id));
		const same = done.length === 0 && next.size === writing.size;
		writing = next;
		if (same) return;
		o.onChange(writing);
		for (const id of done) o.onDone?.(id);
	};

	/**
	 * One pass over the recent chats.
	 *
	 * @returns Resolves when every request is done.
	 */
	async function pass(): Promise<void> {
		const t = now();
		const chats = o.tracked.all()
			.filter((x) => x.chat && (writing.has(x.agentId) || t - Date.parse(x.issuedAt) < WRITING_RECENT_MS))
			.slice(0, WRITING_MAX);
		const next = new Set(writing);
		const checked = new Set<string>();
		for (const c of chats) {
			checked.add(c.agentId);
			const r = await getThread(o.fetchImpl, c.issueId);
			// A failed read keeps what was known (the poller already reports the connection), but
			// not for ever: a chat that cannot be read at all must not leave a "…" up.
			const failedN = r.ok ? 0 : (fails.get(c.agentId) ?? 0) + 1;
			if (failedN) fails.set(c.agentId, failedN); else fails.delete(c.agentId);
			const active = r.ok ? r.value.conversation?.state === 'active' : writing.has(c.agentId) && failedN < WRITING_FAILS_MAX;
			if (active) next.add(c.agentId); else next.delete(c.agentId);
		}
		// A comrade this pass did not check (a chat opened in Paperclip, or past WRITING_MAX) keeps
		// the open chat's word while it is fresh; the open chat repeats it every few seconds.
		for (const id of next) if (!checked.has(id) && t - (panelSaid.get(id) ?? 0) > PANEL_WORD_MS) next.delete(id);
		for (const id of fails.keys()) if (!checked.has(id)) fails.delete(id);
		become(next);
	}

	/** Check, then schedule the next check. */
	function tick(): void {
		timer = null;
		/** Schedule the check after this one, unless the watch was stopped. */
		const next = (): void => { if (running) timer = timers.set(tick, o.intervalMs ?? WRITING_CHECK_MS); };
		if (isHidden()) { next(); return; }
		void check().finally(next);
	}

	/**
	 * Check now, joining a check already running.
	 *
	 * @returns Resolves when done.
	 */
	function check(): Promise<void> {
		busy ??= pass().catch((err) => console.error('Plant writing check failed.', err)).finally(() => { busy = null; });
		return busy;
	}

	return {
		get writing() { return writing; },
		see(agentId, active) {
			if (active) panelSaid.set(agentId, now()); else panelSaid.delete(agentId);
			if (active === writing.has(agentId)) return;
			const next = new Set(writing);
			if (active) next.add(agentId); else next.delete(agentId);
			become(next);
		},
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
