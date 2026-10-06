/**
 * Polls Paperclip for the roster and "needs you" counts and hands the cockpit a Snapshot
 * every tick. Runs inside the extension's content script, so every request is a same-origin
 * GET that rides on the browser's own sign-in to Paperclip (and to any access gateway in front of it).
 *
 * Everything with a side effect (fetch, clock, timers, page visibility) is injected, so the
 * same code runs under Node in the tests with a fake fetch and a fake clock.
 */
import { type Approvals, toApprovals } from './approvals';
import { type FetchLike, type Got, UUID, get as getWith } from './http';
import type { AgentState, Badges, Session, Snapshot } from './types';

export type { FetchLike, ResponseLike } from './http';

/** Timer functions, injectable so tests can drive time by hand. */
export interface Timers {
	set(fn: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

export interface PollerOptions {
	fetchImpl?: FetchLike;
	/** Normal gap between ticks. */
	intervalMs?: number;
	onSnapshot: (snapshot: Snapshot) => void;
	/**
	 * The company to draw, as chosen at setup. Null draws the first company listed. A chosen
	 * company that is not listed is an error ('company-gone'), never a quiet switch to another.
	 */
	companyId?: string | null;
	now?: () => number;
	/** True while the tab is hidden; ticks are skipped then. */
	isHidden?: () => boolean;
	timers?: Timers;
	/**
	 * Subscribe to "the tab became visible or hidden". Returns an unsubscribe function.
	 * Defaults to document's visibilitychange when a document exists, else a no-op.
	 */
	onVisibilityChange?: (cb: () => void) => () => void;
}

export interface Poller {
	/** Begin polling: discovers the company and takes the first snapshot straight away, even in a hidden tab. */
	start(): void;
	/** Stop polling. A request already in flight finishes but its result is dropped. */
	stop(): void;
	/** Poll now (unless a tick is already in flight) and restart the interval from here. */
	refresh(): Promise<void>;
}

/** Gap between ticks once the connection has failed BACKOFF_AFTER times in a row. */
export const BACKOFF_MS = 60_000;
/** Consecutive failed ticks before backing off. */
export const BACKOFF_AFTER = 3;

/**
 * Sentences for the "PAPERS, PLEASE" overlay, one per failed session state. The overlay's
 * stamp already says "Papers, please", so the sentences do not repeat it.
 */
export const MESSAGES: Record<Exclude<Session, 'ok'>, string> = {
	'access-lapsed': 'Your sign-in in front of Paperclip has lapsed, or Paperclip sent the plant to a login page. Open the Paperclip dashboard in this browser to sign in again, and the plant will pick up on its next check.',
	'signed-out': 'Paperclip refused the request, so your Paperclip session has probably expired. Sign in to the dashboard again, and the plant will pick up on its next check.',
	'unreachable': 'Paperclip could not be reached or sent back something unreadable. Check that the dashboard loads in this browser; the plant will keep trying.',
	'no-company': 'Paperclip answered, but this sign-in can see no company with a usable id. Check that your account belongs to the company in the dashboard; the plant will keep checking.',
	'company-gone': 'The company you chose for this plant is no longer listed in Paperclip. Press the ★ button, top right, and pick again. The plant will not guess.',
};

/**
 * Pull the list out of a response that may be a bare array or wrap it in a property
 * (same rule the original connection probe used).
 *
 * @param body Parsed JSON.
 * @returns Items that are objects; anything else in the list is dropped.
 */
export function listOf(body: unknown): Record<string, unknown>[] {
	let list: unknown[] = [];
	if (Array.isArray(body)) list = body;
	else if (body && typeof body === 'object') {
		for (const k of ['data', 'items', 'results', 'agents', 'companies']) {
			const v = (body as Record<string, unknown>)[k];
			if (Array.isArray(v)) { list = v; break; }
		}
	}
	return list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
}

/**
 * A string field, or null when missing or not a string.
 *
 * @param v Raw value.
 * @returns String or null.
 */
function str(v: unknown): string | null {
	return typeof v === 'string' ? v : null;
}

/**
 * A count field, or 0 when missing or not a finite number.
 *
 * @param v Raw value.
 * @returns Count.
 */
function count(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Trim a raw agent from the API to what the plant draws. Missing fields become null;
 * the status string is passed through untouched so new statuses surface rather than vanish.
 *
 * @param raw One item from the agents list.
 * @returns AgentState, or null when the item has no usable id.
 */
export function toAgentState(raw: Record<string, unknown>): AgentState | null {
	const id = str(raw.id);
	if (!id) return null;
	return {
		id,
		name: str(raw.name) ?? 'Unnamed comrade',
		title: str(raw.title),
		role: str(raw.role),
		status: str(raw.status) ?? 'unknown',
		pauseReason: str(raw.pauseReason),
		errorReason: str(raw.errorReason),
		lastHeartbeatAt: str(raw.lastHeartbeatAt),
		// The probe saw `reportsTo`; older payloads may use the longer name.
		reportsTo: str(raw.reportsTo) ?? str(raw.reportsToAgentId),
		urlKey: str(raw.urlKey),
	};
}

/**
 * Read the sidebar-badges body into Badges.
 *
 * @param body Parsed JSON.
 * @returns Badges, or null when the body is not an object.
 */
export function toBadges(body: unknown): Badges | null {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
	const b = body as Record<string, unknown>;
	return { inbox: count(b.inbox), approvals: count(b.approvals), failedRuns: count(b.failedRuns), joinRequests: count(b.joinRequests) };
}

/**
 * Default visibility subscription: the document's visibilitychange event, or nothing under Node.
 *
 * @param cb Called on every visibility change.
 * @returns Unsubscribe function.
 */
function documentVisibility(cb: () => void): () => void {
	if (typeof document === 'undefined') return () => {};
	document.addEventListener('visibilitychange', cb);
	return () => document.removeEventListener('visibilitychange', cb);
}

/**
 * Create a poller. Nothing happens until start().
 *
 * @param opts Options; see PollerOptions.
 * @returns start / stop / refresh controls.
 */
export function createPoller(opts: PollerOptions): Poller {
	const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
	const intervalMs = opts.intervalMs ?? 20_000;
	const now = opts.now ?? Date.now;
	const isHidden = opts.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
	const timers: Timers = opts.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
	const subscribe = opts.onVisibilityChange ?? documentVisibility;

	let running = false;
	let timer: unknown = null;
	let inFlight: Promise<void> | null = null;
	let failures = 0;
	let unsubscribe: (() => void) | null = null;
	let company: { id: string; name: string | null } | null = null;
	const chosen = opts.companyId ?? null;
	// Last good data, kept through failures so the plant doesn't empty when a sign-in lapses.
	let lastAgents: AgentState[] = [];
	let lastBadges: Badges | null = null;
	// True when the badges endpoint failed on the latest tick, so the counts shown are old.
	let badgesStale = false;
	let lastApprovals: Approvals | null = null;

	/**
	 * GET a same-origin path.
	 *
	 * @param path Path starting with /api/.
	 * @returns Parsed body, or the session state the failure implies.
	 */
	const get = (path: string): Promise<Got> => getWith(fetchImpl, path);

	/**
	 * Emit a snapshot built from the last good data, plus the session state.
	 *
	 * @param session Session state.
	 * @param message Overlay sentence, or null when ok.
	 */
	function emit(session: Session, message: string | null): void {
		if (!running) return;
		opts.onSnapshot({ at: now(), session, message, companyId: company?.id ?? null, companyName: company?.name ?? null, agents: lastAgents, badges: lastBadges, badgesStale, approvals: lastApprovals });
	}

	/**
	 * Find the company once: the one chosen at setup, or with none chosen, the first listed.
	 *
	 * @returns null on success, or the failed session state and message.
	 */
	async function discover(): Promise<{ session: Exclude<Session, 'ok'>; message: string } | null> {
		const got = await get('/api/companies');
		if (!got.ok) return { session: got.session, message: MESSAGES[got.session] };
		const list = listOf(got.body);
		if (chosen && list.length && !list.some((c) => str(c.id) === chosen)) return { session: 'company-gone', message: MESSAGES['company-gone'] };
		const pick = chosen ? list.find((c) => str(c.id) === chosen) : list[0];
		const id = pick ? str(pick.id) : null;
		if (!pick || !id || !UUID.test(id)) return { session: 'no-company', message: MESSAGES['no-company'] };
		company = { id, name: str(pick.name) };
		return null;
	}

	/**
	 * One poll: discover the company if needed, then fetch agents, badges and pending approvals in parallel.
	 * heartbeat-runs is deliberately never called: it is unpaginated and takes about 5s.
	 *
	 * The session follows the agents endpoint alone. Badges are extras: when they fail, the
	 * last counts are kept and marked stale, and the plant carries on with fresh agents.
	 *
	 * @returns True when the agents (and, if needed, the company) were read.
	 */
	async function poll(): Promise<boolean> {
		if (!company) {
			const failed = await discover();
			if (failed) { emit(failed.session, failed.message); return false; }
		}
		const cid = company!.id;
		const [agents, badges, approvals] = await Promise.all([
			get(`/api/companies/${cid}/agents`),
			get(`/api/companies/${cid}/sidebar-badges`),
			get(`/api/companies/${cid}/approvals?status=pending`),
		]);
		if (badges.ok) { lastBadges = toBadges(badges.body); badgesStale = false; }
		else badgesStale = true;
		// Like badges, approvals are extras: a failure keeps the last ones and the plant carries on.
		if (approvals.ok) lastApprovals = toApprovals(approvals.body);
		if (agents.ok) {
			lastAgents = listOf(agents.body).map(toAgentState).filter((a): a is AgentState => a !== null);
			emit('ok', null);
			return true;
		}
		// A 404 on the company's own agents means it went away; look it up afresh next time.
		// A badges 404 says nothing about the company (the endpoint may just not exist).
		if (agents.status === 404) company = null;
		emit(agents.session, MESSAGES[agents.session]);
		return false;
	}

	/** Schedule the next tick, backing off after repeated failures. */
	function schedule(): void {
		if (!running) return;
		if (timer !== null) timers.clear(timer);
		const delay = failures >= BACKOFF_AFTER ? Math.max(intervalMs, BACKOFF_MS) : intervalMs;
		timer = timers.set(() => { timer = null; void tick(); }, delay);
	}

	/**
	 * Run a poll unless one is in flight or the tab is hidden, then schedule the next.
	 *
	 * @param force Poll even in a hidden tab (the first poll, so a cockpit opened in a
	 *   background tab has the plant ready when it is looked at).
	 * @returns Resolves when this tick (or the one already in flight) is done.
	 */
	function tick(force = false): Promise<void> {
		if (!running) return Promise.resolve();
		// No overlapping requests: a slow Paperclip must not stack up polls.
		if (inFlight) return inFlight;
		if (isHidden() && !force) { schedule(); return Promise.resolve(); }
		inFlight = (async () => {
			try {
				const ok = await poll();
				failures = ok ? 0 : failures + 1;
			} catch (err) {
				// Only onSnapshot can throw here; keep polling rather than die silently.
				failures += 1;
				console.error('Plant poller tick failed.', err);
			} finally {
				inFlight = null;
				schedule();
			}
		})();
		return inFlight;
	}

	/** Refresh straight away when the tab comes back into view. */
	function onVisibility(): void {
		if (running && !isHidden()) void refresh();
	}

	/**
	 * Poll now and restart the interval.
	 *
	 * @returns Resolves when the poll is done.
	 */
	function refresh(): Promise<void> {
		if (!running) return Promise.resolve();
		if (timer !== null && !inFlight) { timers.clear(timer); timer = null; }
		return tick();
	}

	return {
		start() {
			if (running) return;
			running = true;
			unsubscribe = subscribe(onVisibility);
			void tick(true);
		},
		stop() {
			running = false;
			if (timer !== null) timers.clear(timer);
			timer = null;
			unsubscribe?.();
			unsubscribe = null;
		},
		refresh,
	};
}
