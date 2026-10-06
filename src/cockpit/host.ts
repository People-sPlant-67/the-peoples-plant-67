/**
 * Who the cockpit draws from, and what that host can do. The cockpit asks these questions
 * rather than "is this the bridge", so a host that is real but has no companies, no issue
 * tracker or no sign-in (the npx bridge for Claude Code and Codex) gets neither a company
 * picker nor the Ministry pages, nor words that send its owner looking for Paperclip.
 */

/**
 * - paperclip: a real Paperclip, signed in through the browser (the extension).
 * - bridge: the local npx server, fed by harness hooks through files in ~/.plant-67.
 * - demo: the made-up plant (the demo build, the dev page, the landing hero).
 */
import { NPX, RELINK } from '../bridge/words';

export type HostKind = 'paperclip' | 'bridge' | 'demo';

export interface Host {
	kind: HostKind;
	/** The host lists companies, each with its own roster: the owner picks one, and their own seat in it. */
	companies: boolean;
	/** The host keeps issues and routines, so a Ministry (Director, ledger, Lessons) can be founded on it. */
	ministry: boolean;
	/** The host takes the board stamps on the Personnel File (pause, resume, wake, clear error). */
	board: boolean;
	/** The host keeps each agent's budget and shift log, for the Personnel File. */
	books: boolean;
	/** The host takes files on messages. */
	files: boolean;
	/** A directive wakes the agent at once. On the bridge it waits for the agent's next turn. */
	wakes: boolean;
	/** What the plant calls the server in its words: "Paperclip", "the bridge". */
	server: string;
	/** How the owner brings the server back when it stops answering, or null where the fix is signing in again. */
	restart: string | null;
	/** What to do when the server refuses the page (its key is lost), or null where that means signing in again. */
	relink: string | null;
	/** The host may have Agent Chat (one running conversation per comrade). The bridge never does. */
	chat: boolean;
	/** The plant reaches the server through a sign-in the owner keeps (Paperclip's): its notice offers the dashboard. */
	signIn: boolean;
	/** The noticeboard's line for the server's counts. */
	boardLine(b: { inbox: number; approvals: number; failedRuns: number }): string;
	/** Words for thread statuses where this host means something of its own by them. */
	threadWords: Record<string, string>;
}

/** What the plant's own host page is when nothing else is said: a Paperclip. */
export const PAPERCLIP: Host = {
	kind: 'paperclip', companies: true, ministry: true, board: true, books: true, files: true, wakes: true, server: 'Paperclip', restart: null, relink: null, chat: true, signIn: true,
	boardLine: (b) => `Inbox ${b.inbox}, approvals ${b.approvals}, failed runs ${b.failedRuns}.`,
	threadWords: {},
};

/**
 * What a kind of host can do.
 *
 * @param kind Host kind.
 * @returns Host.
 */
export function hostOf(kind: HostKind): Host {
	if (kind === 'bridge') {
		return {
			kind, companies: false, ministry: false, board: false, books: false, files: false, wakes: false, chat: false, signIn: false, server: 'the bridge',
			restart: `The plant's terminal has stopped. Run ${NPX} again.`,
			relink: RELINK,
			boardLine: (b) => `Messages waiting: ${b.inbox}. Waiting for your OK: ${b.approvals}. Stopped with an error: ${b.failedRuns}.`,
			threadWords: { todo: 'waiting for your next prompt', in_progress: 'handed over' },
		};
	}
	if (kind === 'demo') return { ...PAPERCLIP, kind, companies: false, ministry: false, signIn: false };
	return { ...PAPERCLIP };
}
