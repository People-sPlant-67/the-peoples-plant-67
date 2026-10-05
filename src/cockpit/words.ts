/**
 * Times and money in plain words, shared by the dossiers, the Personnel File and Pravda.
 */

/**
 * A date and time in words, or null.
 *
 * @param iso ISO timestamp.
 * @returns "24 Sep, 14:02", or null when unreadable.
 */
export function dateWords(iso: string | null): string | null {
	const t = iso ? Date.parse(iso) : NaN;
	if (!Number.isFinite(t)) return null;
	const d = new Date(t);
	return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * How long ago a moment was, in plain words.
 *
 * @param iso ISO timestamp, or null.
 * @param now Now, epoch ms.
 * @returns "Never.", "Just now.", "12 minutes ago." and so on.
 */
export function agoWords(iso: string | null, now: number): string {
	const t = iso ? Date.parse(iso) : NaN;
	if (!Number.isFinite(t)) return 'Never.';
	const min = Math.floor((now - t) / 60_000);
	if (min < 1) return 'Just now.';
	if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago.`;
	const h = Math.floor(min / 60);
	if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago.`;
	return `${Math.floor(h / 24)} days ago.`;
}

/**
 * Money in cents as dollars, e.g. "$14.20".
 *
 * @param cents Cents.
 * @returns Words.
 */
export function dollars(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}
