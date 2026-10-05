/**
 * The regimes an owner founds the Ministry under: how many live strikes an agent may hold before
 * the Director refers them to the tribunal. The founding form offers them, the CEO order and the
 * inspection read the number.
 */

/** How many live strikes before the Director refers an agent to the tribunal. */
export type Regime = 'lenient' | 'standard' | 'purge';

/** Each regime: its threshold, its stamp word, its name and its line in the wizard. */
export const REGIMES: Record<Regime, { strikes: number; word: string; name: string; line: string; tone: 'green' | 'amber' | 'red' }> = {
	lenient: { strikes: 5, word: 'МЯГКИЙ', name: 'Lenient', line: 'Five live strikes before a tribunal. For a young plant.', tone: 'green' },
	standard: { strikes: 3, word: 'СТАНДАРТ', name: 'Standard', line: 'Three live strikes. The founding rule.', tone: 'amber' },
	purge: { strikes: 1, word: 'ЧИСТКА', name: 'Purge Season', line: 'One strike and they stand trial. Entertaining. Not wise.', tone: 'red' },
};

/** The regimes, in the order the wizard shows them. */
export const REGIME_ORDER: readonly Regime[] = ['lenient', 'standard', 'purge'];
