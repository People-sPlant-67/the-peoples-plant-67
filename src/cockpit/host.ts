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
import { NPX } from '../bridge/words';

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
	/**
	 * How the owner gets the plant back when the server stops answering it:
	 * - signIn: the server sits behind a sign-in the owner keeps (Paperclip's); the notice offers the dashboard.
	 * - local: the server runs on this computer (the bridge): it can stop, its key changes at every
	 *   start, and it writes its refusals for the owner. `start` is its exact start command.
	 */
	recovery: { kind: 'signIn' } | { kind: 'local'; start: string };
	/** The host may have Agent Chat (one running conversation per comrade). The bridge never does. */
	chat: boolean;
	/** The noticeboard's line for the server's counts. */
	boardLine(b: { inbox: number; approvals: number; failedRuns: number }): string;
	/** Words for thread statuses where this host means something of its own by them. */
	threadWords: Record<string, string>;
}

/** What the plant's own host page is when nothing else is said: a Paperclip. */
export const PAPERCLIP: Host = {
	kind: 'paperclip', companies: true, ministry: true, board: true, books: true, files: true, wakes: true, server: 'Paperclip', chat: true, recovery: { kind: 'signIn' },
	boardLine: (b) => `Inbox ${b.inbox}, approvals ${b.approvals}, failed runs ${b.failedRuns}.`,
	threadWords: {},
};

/**
 * What a kind of host can do.
 *
 * @param kind Host kind.
 * @param start The bridge's exact start command (with its folder and port), when known.
 * @returns Host.
 */
export function hostOf(kind: HostKind, start: string | null = null): Host {
	if (kind === 'bridge') {
		return {
			kind, companies: false, ministry: false, board: false, books: false, files: false, wakes: false, chat: false, server: 'the bridge',
			recovery: { kind: 'local', start: start ?? NPX },
			boardLine: (b) => `Messages waiting: ${b.inbox}. Waiting for your OK: ${b.approvals}. Stopped with an error: ${b.failedRuns}.`,
			threadWords: { todo: 'waiting for your next prompt', in_progress: 'handed over' },
		};
	}
	if (kind === 'demo') return { ...PAPERCLIP, kind, companies: false, ministry: false };
	return { ...PAPERCLIP };
}
