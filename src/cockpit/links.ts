/**
 * Where an issue opens outside the plant. On Paperclip that is its own page, /issues/<ref>, on
 * the same host. A host with no such page (the demo) sets this to return null, and the plant
 * then shows what it can inside itself instead of a link that would lead nowhere.
 */

/** Makes the address of an issue's page, or null when there is none. */
export type IssueHref = (ref: string) => string | null;

/** Paperclip's issue page on this host. */
const paperclip: IssueHref = (ref) => `/issues/${encodeURIComponent(ref)}`;

let make: IssueHref = paperclip;

/**
 * Choose how issue addresses are made, for this page's lifetime.
 *
 * @param f The maker, or null for Paperclip's own pages.
 */
export function setIssueHref(f: IssueHref | null): void {
	make = f ?? paperclip;
}

/**
 * The address of an issue's page.
 *
 * @param ref The issue's identifier or id.
 * @returns The address, or null when this host has no page for it.
 */
export function issueHref(ref: string): string | null {
	return make(ref);
}
