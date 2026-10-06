/**
 * The owner's setup while the plant runs: it holds what the founding form chose, keeps it, and
 * shows each change in the plant (the portrait on the wall and in the paper, the own seat on the
 * roster), and it inspects the Ministry of Operational Hygiene on a schedule, hanging the plaque
 * or the poster to match.
 *
 * A change of company reloads the plant: the cockpit draws one company per visit, and a reload
 * starts the crew, the ceremonies and the furniture clean for the new one, rather than playing
 * every old comrade off by train and every new one in.
 */
import type { Portrait } from '../art/archetypes';
import type { FetchLike } from '../live/http';
import { type Inspection, inspect, verdict } from '../live/inspection';
import { setOwnSeat } from '../live/personas';
import type { AgentState, Snapshot } from '../live/types';
import { REGIMES } from '../live/regimes';
import { type Setup, addressOf, saveSetup } from './setup-store';

/** Gap between inspections while the Ministry is not founded (ms). */
export const INSPECT_MS = 10_000;
/** Gap between inspections once it is founded: enough to notice a piece taken down (ms). */
export const INSPECT_FOUNDED_MS = 300_000;
/** The portrait is repainted this long after the last brush stroke, not on every one (ms). */
export const REPAINT_MS = 120;
/** While the inspection page shows, Paperclip is asked again this often (ms). */
export const WATCH_MS = 8_000;

export interface MinistryDeps {
	fetchImpl: FetchLike;
	/** The setup loaded at boot. */
	initial: Setup;
	/** Keep the setup. Defaults to saveSetup. */
	save?(s: Setup): void;
	/** Show the portrait and how the owner is addressed (the wall and Pravda). */
	paintPortrait(inside: Portrait | null, address: string): void;
	/** Hang the plaque (founded) or the poster. */
	paintFounded(founded: boolean): void;
	/** The own seat changed: look again now, so people move. */
	refresh(): void;
	/** The company changed: start the plant again for it. */
	reload(): void;
	/** Anything the founding form shows changed. */
	onChange(): void;
	now?(): number;
	timers?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
}

export interface Ministry {
	readonly setup: Setup;
	/** Take a change from the founding form. */
	apply(next: Setup): void;
	/** The latest inspection, or null before the first (or since the regime changed). */
	readonly inspection: Inspection | null;
	/** The roster from the last good snapshot. */
	readonly roster: AgentState[];
	/** The company the plant draws, from the last good snapshot. */
	readonly drawn: string | null;
	/** Take in a snapshot: the roster and company, and an inspection when one is due. */
	see(s: Snapshot): void;
	/** Inspect now (after the one in flight, if any). */
	reinspect(): Promise<void>;
	/**
	 * The inspection page is showing (inspect now and every WATCH_MS), or has stopped showing.
	 *
	 * @param on Showing.
	 */
	watch(on: boolean): void;
}

/**
 * Build the controller.
 *
 * @param d Dependencies.
 * @returns Ministry.
 */
export function createMinistry(d: MinistryDeps): Ministry {
	const save = d.save ?? saveSetup;
	const now = d.now ?? Date.now;
	const timers = d.timers ?? { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
	let setup = d.initial;
	setOwnSeat(setup.seatAgentId);
	let inspection: Inspection | null = null;
	let roster: AgentState[] = [];
	/** The company the plant draws, from the last good snapshot. */
	let drawn: string | null = null;
	let inspectedAt = -Infinity;
	let running: Promise<void> | null = null;
	let again = false;
	let repaint: unknown = null;
	let watching: unknown = null;
	/** The company changed and the plant is about to begin again: nothing more is inspected or kept. */
	let leaving = false;

	/**
	 * Keep a setup and show what changed. The inspection writes through here; the founding form
	 * goes through apply, which also handles a change of company.
	 *
	 * @param next Setup.
	 */
	function store(next: Setup): void {
		const prev = setup;
		setup = next;
		save(next);
		if (next.portrait !== prev.portrait || next.name !== prev.name || next.title !== prev.title) {
			if (repaint !== null) timers.clear(repaint);
			repaint = timers.set(() => { repaint = null; d.paintPortrait(setup.portrait, addressOf(setup)); }, REPAINT_MS);
		}
		if (next.seatAgentId !== prev.seatAgentId) { setOwnSeat(next.seatAgentId); d.refresh(); }
		if (next.founded !== prev.founded) d.paintFounded(next.founded);
		d.onChange();
		// A new regime: only the threshold check is in doubt until Paperclip is read again. The rest
		// (the Director above all) still stands, so the order stays folded meanwhile.
		if (next.regime !== prev.regime) {
			if (inspection) inspection = { ...inspection, threshold: { state: 'unknown', note: 'Checking the ledger against your new regime.' } };
			inspectedAt = -Infinity;
			void reinspect();
		}
	}

	/**
	 * Take a change from the founding form. A company other than the one drawn (or one chosen
	 * while none is drawn, as when the old one has gone) forgets what belonged to the old company
	 * (its seat, its ledger and Lessons, its plaque), reopens the form on Connect so the seat can
	 * be chosen from the new roster, and begins the plant again for it. One reload, never a loop:
	 * the poller starts on the company just kept.
	 *
	 * @param next Setup.
	 */
	function apply(next: Setup): void {
		// The plant is about to begin again for a new company: what it keeps is already settled.
		if (leaving) return;
		const moved = next.companyId !== setup.companyId && next.companyId !== drawn;
		if (!moved) { store(next); return; }
		leaving = true;
		store({ ...next, seatAgentId: null, known: { ledger: null, lessons: null }, founded: false, step: 'connect' });
		timers.set(d.reload, 0);
		// Should the reload not happen (a page that asks before leaving), the plant carries on.
		timers.set(() => { leaving = false; }, 10_000);
	}

	/**
	 * One inspection for the company drawn and the regime chosen. An answer that comes back after
	 * the regime or the company changed is for the old one, and is dropped.
	 */
	async function run(): Promise<void> {
		if (!drawn || leaving) return;
		const regime = setup.regime, company = drawn;
		inspectedAt = now();
		try {
			const got = await inspect(d.fetchImpl, company, roster, REGIMES[regime].strikes, setup.known);
			if (regime !== setup.regime || leaving || company !== drawn) return;
			inspection = got.inspection;
			const founded = verdict(got.inspection, setup.founded);
			const known = got.known.ledger !== setup.known.ledger || got.known.lessons !== setup.known.lessons;
			if (founded !== setup.founded || known) store({ ...setup, founded, known: got.known });
			else d.onChange();
		} catch (err) {
			console.error('[plant] The inspection failed.', err);
		}
	}

	/**
	 * Inspect now, or once the inspection in flight is done.
	 *
	 * @returns Resolves when the inspections asked for are done.
	 */
	function reinspect(): Promise<void> {
		if (running) { again = true; return running; }
		running = (async () => {
			do { again = false; await run(); } while (again);
			running = null;
		})();
		return running;
	}

	return {
		get setup() { return setup; },
		apply,
		get inspection() { return inspection; },
		get roster() { return roster; },
		get drawn() { return drawn; },
		see(s) {
			if (s.session !== 'ok') return;
			roster = s.agents;
			drawn = s.companyId;
			const gap = setup.founded ? INSPECT_FOUNDED_MS : INSPECT_MS;
			if (!running && now() - inspectedAt >= gap) void reinspect();
		},
		reinspect,
		watch(on) {
			if (watching !== null) { timers.clear(watching); watching = null; }
			if (!on) return;
			const tick = (): void => { void reinspect(); watching = timers.set(tick, WATCH_MS); };
			tick();
		},
	};
}
