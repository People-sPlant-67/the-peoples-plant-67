/**
 * What the radio plays: public-domain Russian tunes, written out by hand. A melody is notes
 * as `pitch:beats` (`r` is a rest), bars split by `|`. Chords are one per bar, or two names
 * for two halves of a bar; they drive the oom-pah accompaniment.
 */

export interface Tune {
	title: string;
	/** Beats per minute. */
	bpm: number;
	/** Beats in a bar. */
	bar: number;
	/** Notes as `pitch:beats`, bars split by `|`. */
	melody: string;
	/** One chord per bar, or two for its halves, bars split by `|`: as many bars as the melody. */
	chords: string;
	/** Times through. */
	times: number;
	/** How much faster each time through (0.08 is 8%): Korobeiniki runs away with itself. */
	accel: number;
}

export const TUNES: Tune[] = [
	{
		title: 'Korobeiniki',
		bpm: 138,
		bar: 4,
		melody: 'E5:1 B4:.5 C5:.5 D5:1 C5:.5 B4:.5 | A4:1 A4:.5 C5:.5 E5:1 D5:.5 C5:.5 | B4:1.5 C5:.5 D5:1 E5:1 | C5:1 A4:1 A4:1 r:1 | '
			+ 'r:.5 D5:1 F5:.5 A5:1 G5:.5 F5:.5 | E5:1.5 C5:.5 E5:1 D5:.5 C5:.5 | B4:1 B4:.5 C5:.5 D5:1 E5:1 | C5:1 A4:1 A4:1 r:1',
		chords: 'Am E | Am | E | Am | Dm | C | E | Am',
		times: 3,
		accel: 0.08,
	},
	{
		// After the version in Singing Together (BBC, spring 1975): the chorus, then the verse.
		title: 'Kalinka',
		bpm: 132,
		bar: 2,
		melody: 'B4:1 B4:1 | A4:1 F#4:.5 G4:.5 | A4:1 F#4:.5 G4:.5 | A4:1 G4:.5 F#4:.5 | E4:1 B4:1 | '
			+ 'A4:.75 G4:.25 F#4:.5 G4:.5 | A4:1 F#4:.5 G4:.5 | A4:1 G4:.5 F#4:.5 | E4:1 B4:1 | '
			+ 'A4:1 F#4:.5 G4:.5 | A4:1 F#4:.5 G4:.5 | A4:1 G4:.5 F#4:.5 | E4:1 B4:1 | '
			+ 'A4:.75 G4:.25 F#4:.5 G4:.5 | A4:1 F#4:.5 G4:.5 | A4:1 G4:.5 F#4:.5 | E4:2 | '
			+ 'E5:2 | D5:2 | B4:.5 D5:.5 C5:.5 B4:.25 G4:.25 | G4:1 D4:1 | B4:.5 D5:.5 C5:.5 B4:.25 A4:.25 | G4:1 D4:1 | '
			+ 'D4:1 E4:.5 F#4:.5 | A4:.5 G4:.5 F#4:.5 E4:.5 | D4:1 D5:1 | D5:2 | '
			+ 'B4:.5 D5:.5 C5:.5 B4:.25 A4:.25 | G4:1 E4:1 | B4:.5 D5:.5 C5:.5 B4:.25 A4:.25 | G4:1 D4:1 | '
			+ 'E4:1 E4:.5 F#4:.5 | A4:.5 G4:.5 F#4:.5 E4:.5 | D5:1 C5:1 | B4:2',
		chords: 'Em | D | D | D | Em | D | D | D | Em | D | D | D | Em | D | D | D | Em | '
			+ 'C | D | G | G | G | G | D | D | G | D | G | Em | G | G | C | D | D | G',
		times: 2,
		accel: 0.06,
	},
	{
		// The refrain, as transcribed by Phil Taylor (Musica Viva), played twice through.
		title: 'Song of the Volga Boatmen',
		bpm: 100,
		bar: 4,
		melody: 'G4:1 E4:1 A4:2 | E4:4 | G4:1 E4:1 A4:2 | E4:4 | G4:2 C5:2 | B4:2 A4:2 | G4:1 E4:1 A4:2 | E4:4 | '
			+ 'G4:1 E4:1 A4:2 | E4:4 | G4:1 E4:1 A4:2 | E4:4 | G4:2 C5:2 | B4:2 A4:2 | G4:1 E4:1 A4:2 | E4:4',
		chords: 'Em Am | Em | Em Am | Em | C | Em Am | Em Am | Em | Em Am | Em | Em Am | Em | C | Em Am | Em Am | Em',
		times: 2,
		accel: 0,
	},
];
