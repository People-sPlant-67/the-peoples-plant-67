/**
 * When the plant makes a sound: turns what happens in the cockpit into voices on a sink. Pure,
 * with its own clock injected, so the tests drive it with a fake sink. The sink (sound.ts)
 * decides how each voice sounds and whether anything can be heard yet.
 *
 * - A stamp fires: thud. A verdict is given: gavel. A directive or reply is sent: clack.
 * - The train comes or goes: doors, then the whistle, then steam. An airbrushing: hiss.
 * - The Commissar turns a page of his Pravda on screen: rustle.
 * - A hammer lands on screen: clang, at most one every CLANG_GAP_MS, quieter zoomed out,
 *   panned to where it lands. Clangs and rustles are background texture, so they play on the
 *   ambient bus: muting the effects never has to silence the bell to stop the hammering.
 * - Breaks, on screen: a fizz as a glass of soda comes up, the clack of a chess piece
 *   put down, a snore from someone asleep. Quieter than the hammers, each kind at most once every
 *   BREAK_GAP_MS.
 * - A new approval (any type): the desk bell, once per approval. On opening, one bell for all
 *   those already waiting.
 * - A "!" or reply-letter bubble appears on screen: pop. A "!" right after the bell is skipped: the
 *   bell already rang for that comrade's approval. Pops are spaced out, and quiet for the
 *   first seconds after opening.
 */
import { CHESS_MOVE_FRAME, PAGE_TURN_FRAME } from '../art/avatar';

/** Every sound the plant makes. */
export type Voice = 'clang' | 'thud' | 'steam' | 'whistle' | 'doors' | 'airbrush' | 'gavel' | 'clack' | 'rustle' | 'bell' | 'pop' | 'fizz' | 'snore' | 'wings'
	| 'ding' | 'snare' | 'beep' | 'huff' | 'crackle';

/** How one sound is played. */
export interface PlayOpts {
	/** Loudness relative to the voice's own, 0 to 1. */
	gain?: number;
	/** Stereo position, -1 (left) to 1 (right). */
	pan?: number;
	/** Seconds from now. */
	delay?: number;
	/** Play on the ambient bus (background texture) rather than the effects bus. */
	ambient?: boolean;
}

/** Where cues go. */
export interface SoundSink {
	/**
	 * Play a voice.
	 *
	 * @param voice Which sound.
	 * @param opts Loudness, stereo position and delay.
	 */
	play(voice: Voice, opts?: PlayOpts): void;
}

/** One comrade as the cues see them each frame. */
export interface FrameSeen {
	id: string;
	anim: string;
	frame: number;
	/** Where on screen, 0 to 1 across, or null when off screen. */
	screenX: number | null;
}

/** Lift for voices on the ambient bus, which is set lower than the effects bus. */
const AMBIENT_LIFT = 1.6;
/** Shortest gap between two clangs: a floor of hammers is a distant beat, not a din. */
export const CLANG_GAP_MS = 1_500;
/** A "!" this soon after the bell is not popped. */
export const BELL_COVERS_MS = 3_000;
/** Gap between bells when several approvals arrive at once. */
const BELL_GAP_S = 0.35;
/** Most bells rung for one batch of new approvals. */
const MAX_BELLS = 3;
/** Shortest gap between two pops. */
export const POP_GAP_MS = 400;
/** No pops this soon after opening: every bubble appears at once then, as the first frames land. */
export const QUIET_START_MS = 4_000;

export interface Cues {
	/** A stamp's hold completed. */
	stamp(): void;
	/** A tribunal verdict was carried out. */
	verdict(): void;
	/** A directive or reply was sent. */
	sent(): void;
	/** The train pulls in or out. */
	train(): void;
	/** A comrade is being airbrushed. */
	airbrush(): void;
	/**
	 * The pending approvals on a good snapshot: new ones ring the bell.
	 *
	 * @param pending Every pending approval: its id, and the comrade whose "!" it raises (or null).
	 */
	approvals(pending: { id: string; holder: string | null }[]): void;
	/**
	 * Each rendered frame: page turns and hammer strikes on screen.
	 *
	 * @param seen Comrades.
	 * @param zoom Camera zoom (1 is all the way out).
	 */
	frame(seen: FrameSeen[], zoom: number): void;
	/**
	 * A bubble appeared over a comrade.
	 *
	 * @param kind 'alert' for the "!", 'reply' for the sealed letter.
	 * @param screenX Where on screen (0 to 1 across), or null when off screen.
	 * @param id The comrade.
	 */
	bubble(kind: 'alert' | 'reply', screenX: number | null, id: string): void;
}

/** The least time between two of the same break sound (ms). */
export const BREAK_GAP_MS = 3_000;
/** How loud break sounds are against the hammers. */
const BREAK_GAIN = 0.55;
/** Which frame of which animation makes which sound. */
const BREAK_SOUNDS: { anim: string; frame: number; voice: Voice }[] = [
	{ anim: 'drink', frame: 1, voice: 'fizz' },
	{ anim: 'chess', frame: CHESS_MOVE_FRAME, voice: 'clack' },
	{ anim: 'doze', frame: 0, voice: 'snore' },
];

/** The hammer's strike frame in 'work' (the one with sparks). */
export const STRIKE_FRAME = 4;

/**
 * A stereo position for a point across the screen, kept away from the hard edges.
 *
 * @param x 0 to 1 across.
 * @returns -0.6 to 0.6.
 */
const panOf = (x: number): number => Math.max(-0.6, Math.min(0.6, (x * 2 - 1) * 0.6));

/**
 * Create the cues.
 *
 * @param sink Where sounds go.
 * @param now Clock, ms.
 * @returns Cues.
 */
export function createCues(sink: SoundSink, now: () => number = () => performance.now()): Cues {
	/** Approval ids already rung for; null until the first snapshot. */
	let known: Set<string> | null = null;
	/** When the bell last rang for an approval each comrade carries. */
	const rangFor = new Map<string, number>();
	let lastPop = -Infinity;
	const born = now();
	let lastClang = -Infinity;
	/** Last frame seen per comrade and animation, to catch the moment a frame starts. */
	const last = new Map<string, string>();
	/** When each break sound last played. */
	const lastBreak = new Map<Voice, number>();

	return {
		stamp: () => sink.play('thud'),
		verdict: () => sink.play('gavel'),
		sent: () => sink.play('clack'),
		train() {
			sink.play('doors');
			sink.play('whistle', { delay: 0.5 });
			sink.play('steam', { delay: 1.2 });
		},
		airbrush: () => sink.play('airbrush'),
		approvals(pending) {
			// On opening, everything already waiting gets one bell between them.
			const fresh = known ? pending.filter((p) => !known!.has(p.id)) : pending;
			const bells = known ? Math.min(fresh.length, MAX_BELLS) : Math.min(fresh.length, 1);
			for (let k = 0; k < bells; k++) sink.play('bell', { delay: k * BELL_GAP_S });
			const t = now();
			for (const p of fresh) if (p.holder) rangFor.set(p.holder, t);
			// Keep only what is still pending, so an approval that comes back later rings again.
			known = new Set(pending.map((p) => p.id));
		},
		frame(seen, zoom) {
			const t = now();
			const ids = new Set<string>();
			// Zoomed all the way out (1) the hammers are quieter than zoomed in (3).
			const loud = AMBIENT_LIFT * Math.max(0.3, Math.min(1, 0.3 + (zoom - 1) * 0.35));
			for (const c of seen) {
				ids.add(c.id);
				const key = `${c.anim}|${c.frame}`;
				if (last.get(c.id) === key) continue;
				last.set(c.id, key);
				if (c.screenX === null) continue;
				if (c.anim === 'work' && c.frame === STRIKE_FRAME && t - lastClang >= CLANG_GAP_MS) {
					lastClang = t;
					sink.play('clang', { gain: loud, pan: panOf(c.screenX), ambient: true });
				} else if (c.anim === 'lurk' && c.frame === PAGE_TURN_FRAME) {
					sink.play('rustle', { pan: panOf(c.screenX), ambient: true, gain: AMBIENT_LIFT });
				} else {
					const b = BREAK_SOUNDS.find((x) => x.anim === c.anim && x.frame === c.frame);
					if (b && t - (lastBreak.get(b.voice) ?? -Infinity) >= BREAK_GAP_MS) {
						lastBreak.set(b.voice, t);
						sink.play(b.voice, { gain: loud * BREAK_GAIN, pan: panOf(c.screenX), ambient: true });
					}
				}
			}
			for (const id of last.keys()) if (!ids.has(id)) last.delete(id);
		},
		bubble(kind, screenX, id) {
			const t = now();
			if (screenX === null || t - born < QUIET_START_MS || t - lastPop < POP_GAP_MS) return;
			if (kind === 'alert' && t - (rangFor.get(id) ?? -Infinity) < BELL_COVERS_MS) return;
			lastPop = t;
			sink.play('pop', { pan: panOf(screenX), gain: 0.7 });
		},
	};
}
