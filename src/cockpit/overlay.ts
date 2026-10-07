/**
 * "PAPERS, PLEASE": a full-screen notice when the connection to Paperclip has really gone,
 * not on a single blip. It opens after FAILURES_TO_SHOW failed snapshots in a row (at once if
 * the plant has never had data), and closes by itself on the first good one. It is
 * see-through, so the last known positions stay visible behind it, and it links to the
 * dashboard so signing in again is one click.
 */
import type { Snapshot } from '../live/types';
import { NEW_TAB, RELINK, STOPPED } from '../bridge/words';
import type { Host } from './host';

/** Consecutive failed snapshots before the notice opens. One is a blip (a laptop waking). */
export const FAILURES_TO_SHOW = 2;

/** What the overlay remembers between snapshots. */
export interface Watch {
	/** Failed snapshots in a row. */
	failures: number;
	/** Whether any good snapshot has arrived yet (even one with nobody on the roster). */
	hadData: boolean;
}

/**
 * Decide whether the notice should be up after a snapshot. Pure, for the tests.
 *
 * @param w State before this snapshot.
 * @param s Snapshot.
 * @returns New state, and whether to show the notice.
 */
export function watch(w: Watch, s: Snapshot): { next: Watch; show: boolean } {
	if (s.session === 'ok') return { next: { failures: 0, hadData: true }, show: false };
	const failures = w.failures + 1;
	return { next: { failures, hadData: w.hadData }, show: failures >= FAILURES_TO_SHOW || !w.hadData };
}

export interface Overlay {
	el: HTMLElement;
	/** True while the notice is on screen. */
	readonly open: boolean;
	/**
	 * Take in a snapshot.
	 *
	 * @returns True when this snapshot closed a notice that was up (the connection came back).
	 */
	update(snapshot: Snapshot): boolean;
}

/** Used if a failed snapshot ever arrives without a message of its own. */
const FALLBACK = 'The plant cannot read Paperclip right now. It will keep trying.';

/**
 * Build the overlay (hidden until the connection has really failed).
 *
 * @param chooseCompany Opens the founding form on Connect, for when the chosen company has gone.
 * @param host The server: a host with a restart sentence (the bridge) has no sign-in to fix.
 * @returns Overlay.
 */
export function createOverlay(host: Pick<Host, 'server' | 'recovery'>, chooseCompany?: () => void): Overlay {
	const local = host.recovery.kind === 'local' ? host.recovery : null;
	const el = document.createElement('div');
	el.className = 'p67-overlay';
	el.hidden = true;
	el.setAttribute('role', 'alertdialog');
	el.setAttribute('aria-label', 'Papers, please');
	const box = document.createElement('div');
	box.className = 'p67-papers';
	const stamp = document.createElement('h2');
	stamp.textContent = 'PAPERS, PLEASE';
	const msg = document.createElement('p');
	// The command to run, on a line of its own so a long folder path is never cut off.
	const command = document.createElement('code');
	command.className = 'p67-cmd p67-cmd-block';
	command.textContent = local?.start ?? '';
	command.hidden = true;
	const link = document.createElement('a');
	link.href = '/';
	link.target = '_blank';
	link.rel = 'noopener';
	link.textContent = 'Open the Paperclip dashboard to sign in';
	const note = document.createElement('p');
	note.className = 'p67-note';
	note.textContent = `This notice closes by itself once the plant can read ${host.server} again.`;
	// The company has gone: signing in will not help and the notice will not close by itself.
	const choose = document.createElement('button');
	choose.type = 'button';
	choose.textContent = 'Choose a company';
	choose.hidden = true;
	if (chooseCompany) choose.addEventListener('click', chooseCompany);
	box.append(stamp, msg, command, choose, link, note);
	el.append(box);
	let state: Watch = { failures: 0, hadData: false };

	return {
		el,
		get open() { return !el.hidden; },
		update(s) {
			const wasOpen = !el.hidden;
			const r = watch(state, s);
			state = r.next;
			if (r.show) {
				// On this computer (the bridge) the plant has either stopped, or started again with a new
				// key this tab does not have. Both are fixed by the start command, shown on its own line.
				const stale = !!local && s.session === 'signed-out';
				const words = !local ? s.message ?? FALLBACK : stale ? RELINK : STOPPED;
				const head = !local ? 'PAPERS, PLEASE' : stale ? 'THIS TAB IS OUT OF DATE' : 'THE LINE IS DOWN';
				if (stamp.textContent !== head) { stamp.textContent = head; el.setAttribute('aria-label', head.charAt(0) + head.slice(1).toLowerCase()); }
				command.hidden = !local;
				if (msg.textContent !== words) msg.textContent = words;
				const gone = s.session === 'company-gone';
				choose.hidden = !gone || !chooseCompany;
				link.hidden = gone || !!local;
				// A bridge tab never comes back by itself (the key changes at every start): it says what to do instead.
				note.hidden = gone || stale;
				note.textContent = local ? NEW_TAB : `This notice closes by itself once the plant can read ${host.server} again.`;
				// The way out is a button: put the keyboard on it as the notice appears, unless something
				// (the founding form, opened for the same reason) already has the keyboard.
				if (gone && !wasOpen && !choose.hidden) queueMicrotask(() => { if (!document.activeElement || document.activeElement === document.body) choose.focus(); });
				el.hidden = false;
				return false;
			}
			if (s.session === 'ok') el.hidden = true;
			return wasOpen && s.session === 'ok';
		},
	};
}
