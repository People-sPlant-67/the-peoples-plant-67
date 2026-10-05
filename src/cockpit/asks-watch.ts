/**
 * Questions waiting on the owner, for the ВОПРОС poster: interactions still pending in
 * the conversations the owner started from the plant (remembered in tracked.ts). Paperclip lists
 * interactions one issue at a time, so this watches the most recent few, one request each, one at
 * a time, now and then. A question the watch has not seen before rings the bell.
 */
import type { FetchLike } from '../live/http';
import { listInteractions } from '../live/interactions';
import type { TrackedList } from './tracked';

/** Gap between checks. */
export const ASKS_CHECK_MS = 30_000;
/** Most conversations checked each time (the most recent). */
export const ASKS_MAX = 8;
/** A conversation is watched for this long after the owner started it. */
export const ASKS_RECENT_MS = 14 * 24 * 60 * 60 * 1000;

/** A comrade's waiting questions: how many, and the conversation holding the oldest. */
export interface Asked {
	agentId: string;
	count: number;
	issueId: string;
	/** True when that conversation is the comrade's Agent Chat. */
	chat: boolean;
}

export interface AsksWatchOptions {
	fetchImpl: FetchLike;
	tracked: TrackedList;
	/**
	 * Called after a check that changed what waits.
	 *
	 * @param fresh How many questions the watch had not seen before.
	 */
	onChange: (fresh: number) => void;
	/** Called when questions not seen before arrive (never for what a conversation's first good read finds). */
	onNew?: (n: number) => void;
	isHidden?: () => boolean;
	now?: () => number;
	intervalMs?: number;
	timers?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
}

export interface AsksWatch {
	/** Each comrade with questions waiting. */
	readonly waiting: ReadonlyMap<string, Asked>;
	/** Checks finished so far: before the first, nothing is known. */
	readonly checks: number;
	/** Check now. Resolves when done; a check already running is joined. */
	check(): Promise<void>;
	/** Check now and then every ASKS_CHECK_MS while the tab is visible. */
	start(): void;
	stop(): void;
}

/**
 * Create the watch. Nothing happens until start().
 *
 * @param o Options.
 * @returns Controls.
 */
export function createAsksWatch(o: AsksWatchOptions): AsksWatch {
	const isHidden = o.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
	const now = o.now ?? Date.now;
	const timers = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
	/** Pending interaction ids per conversation, as last read. */
	const pending = new Map<string, { agentId: string; chat: boolean; ids: string[]; oldest: string }>();
	let waiting = new Map<string, Asked>();
	/** Every pending id ever seen, so the bell rings once per question. */
	const heard = new Set<string>();
	/** Conversations read successfully at least once: what a first read finds was already waiting. */
	const known = new Set<string>();
	let checks = 0;
	let timer: unknown = null;
	let running = false;
	let busy: Promise<void> | null = null;

	/** Sum the conversations into one entry per comrade; the oldest question decides where to go. */
	const sum = (): Map<string, Asked> => {
		const out = new Map<string, Asked & { oldest: string }>();
		for (const [issueId, p] of pending) {
			if (!p.ids.length) continue;
			const a = out.get(p.agentId);
			if (!a) out.set(p.agentId, { agentId: p.agentId, count: p.ids.length, issueId, chat: p.chat, oldest: p.oldest });
			else {
				a.count += p.ids.length;
				if (p.oldest < a.oldest) { a.issueId = issueId; a.chat = p.chat; a.oldest = p.oldest; }
			}
		}
		return new Map([...out].map(([k, { oldest: _o, ...a }]) => [k, a]));
	};

	/**
	 * One pass over the recent conversations.
	 *
	 * @returns Resolves when every request is done.
	 */
	async function pass(): Promise<void> {
		const t = now();
		const recent = o.tracked.all().filter((x) => t - Date.parse(x.issuedAt) < ASKS_RECENT_MS).slice(0, ASKS_MAX);
		const keep = new Set(recent.map((x) => x.issueId));
		for (const id of pending.keys()) if (!keep.has(id)) { pending.delete(id); known.delete(id); }
		let fresh = 0;
		for (const c of recent) {
			const r = await listInteractions(o.fetchImpl, c.issueId);
			// A failed read keeps what was known: the poller already reports the connection.
			if (!r.ok) continue;
			const open = r.value.filter((i) => i.status === 'pending');
			const first = !known.has(c.issueId);
			known.add(c.issueId);
			for (const i of open) if (!heard.has(i.id)) { heard.add(i.id); if (!first) fresh++; }
			pending.set(c.issueId, { agentId: c.agentId, chat: !!c.chat, ids: open.map((i) => i.id), oldest: open[0]?.createdAt ?? '' });
		}
		const next = sum();
		const same = next.size === waiting.size && [...next].every(([k, a]) => {
			const b = waiting.get(k);
			return !!b && b.count === a.count && b.issueId === a.issueId;
		});
		waiting = next;
		if (fresh) o.onNew?.(fresh);
		checks++;
		if (!same) o.onChange(fresh);
	}

	/** Check, then schedule the next check. */
	function tick(): void {
		timer = null;
		/** Schedule the check after this one, unless the watch was stopped. */
		const next = (): void => { if (running) timer = timers.set(tick, o.intervalMs ?? ASKS_CHECK_MS); };
		if (isHidden()) { next(); return; }
		void check().finally(next);
	}

	/**
	 * Check now, joining a check already running.
	 *
	 * @returns Resolves when done.
	 */
	function check(): Promise<void> {
		busy ??= pass().catch((err) => console.error('Plant question check failed.', err)).finally(() => { busy = null; });
		return busy;
	}

	return {
		get waiting() { return waiting; },
		get checks() { return checks; },
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
