/**
 * Who the cockpit draws from, and what that host can do. The founding form and the Ministry ask
 * these questions rather than "is this the demo", so a host that is real but has no companies or
 * no issue tracker (the npx bridge for Claude Code and Codex) gets neither a company picker nor
 * the Ministry pages and their nag.
 */

/**
 * - paperclip: a real Paperclip, signed in through the browser (the extension).
 * - bridge: the local npx server, fed by harness hooks through plant-state.json.
 * - demo: the made-up plant (the demo build, the dev page, the landing hero).
 */
export type HostKind = 'paperclip' | 'bridge' | 'demo';

export interface Host {
	kind: HostKind;
	/** The host lists companies, each with its own roster: the owner picks one, and their own seat in it. */
	companies: boolean;
	/** The host keeps issues and routines, so a Ministry (Director, ledger, Lessons) can be founded on it. */
	ministry: boolean;
}

/**
 * What a kind of host can do.
 *
 * @param kind Host kind.
 * @returns Host.
 */
export function hostOf(kind: HostKind): Host {
	const real = kind === 'paperclip';
	return { kind, companies: real, ministry: real };
}
