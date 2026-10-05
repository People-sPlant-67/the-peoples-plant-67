/**
 * The radiogram in the Company Lead's office. It plays the tunes in radio-tunes.ts through the
 * sound engine: a reedy lead over an oom-pah bass, filtered like an old valve set, with a faint
 * hiss and a burst of tuning static between tunes. Nothing is downloaded or streamed.
 *
 * Notes are scheduled a couple of seconds ahead of the audio clock, so a busy page or a
 * throttled background tab never makes the music stumble. Switching off disconnects what is
 * already scheduled, so it falls silent at once.
 */
import { type Tune, TUNES } from './radio-tunes';
import type { RadioOut, Sound } from './sound';

/** One note to play: start and length in seconds from the tune's start, frequency in Hz. */
export interface Note {
	t: number;
	d: number;
	f: number;
	part: 'lead' | 'bass' | 'chord';
}

/** Semitones above C for each note letter. */
const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * The frequency of a pitch name, in equal temperament from A4 = 440 Hz.
 *
 * @param name Letter, optional # or b, octave (e.g. 'C#5').
 * @returns Hz.
 */
export function pitch(name: string): number {
	const m = /^([A-G])([#b]?)(\d)$/.exec(name);
	if (!m) throw new Error(`radio: bad pitch ${name}`);
	const semis = STEP[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
	return 440 * 2 ** ((semis - 69) / 12);
}

/**
 * A chord's bass note (octave 2), its fifth, and its triad (octave 4).
 *
 * @param name Root letter, optional # or b, then 'm' for minor (e.g. 'Am', 'E', 'Bb').
 * @returns Frequencies.
 */
export function chord(name: string): { root: number; fifth: number; triad: number[] } {
	const m = /^([A-G][#b]?)(m?)$/.exec(name);
	if (!m) throw new Error(`radio: bad chord ${name}`);
	const root = pitch(`${m[1]}2`);
	const at = (semis: number): number => root * 2 ** (semis / 12);
	return { root, fifth: at(7), triad: [at(24), at(m[2] ? 27 : 28), at(31)] };
}

/**
 * The bars of a melody: each a list of [pitch or 'r', beats].
 *
 * @param melody Melody text.
 * @returns Bars.
 */
export function bars(melody: string): [string, number][][] {
	return melody.split('|').map((b) => b.trim().split(/\s+/).filter(Boolean).map((tok) => {
		const [p, beats] = tok.split(':');
		const n = Number(beats);
		if (!p || !Number.isFinite(n) || n <= 0) throw new Error(`radio: bad note ${tok}`);
		return [p, n] as [string, number];
	}));
}

/**
 * Arrange a tune: the melody on the lead, and for each beat either the bass (every other beat,
 * alternating root and fifth) or a short chord. Each time through is faster by the tune's accel.
 *
 * @param tune Tune.
 * @returns Notes in time order, and the whole length in seconds.
 */
export function arrange(tune: Tune): { notes: Note[]; length: number } {
	const melody = bars(tune.melody);
	const harmony = tune.chords.split('|').map((b) => b.trim().split(/\s+/));
	const notes: Note[] = [];
	let t0 = 0;
	for (let k = 0; k < tune.times; k++) {
		const beat = 60 / (tune.bpm * (1 + tune.accel * k));
		melody.forEach((bar, b) => {
			const barStart = t0 + b * tune.bar * beat;
			let at = 0;
			for (const [p, n] of bar) {
				if (p !== 'r') notes.push({ t: barStart + at * beat, d: n * beat, f: pitch(p), part: 'lead' });
				at += n;
			}
			const names = harmony[b % harmony.length];
			for (let i = 0; i < tune.bar; i++) {
				const c = chord(names[Math.floor(i / (tune.bar / names.length))]);
				const t = barStart + i * beat;
				// Counted across bars, so a two-beat bar alternates too.
				if (i % 2 === 0) notes.push({ t, d: beat * 0.9, f: (b * tune.bar + i) % 4 === 0 ? c.root : c.fifth, part: 'bass' });
				else for (const f of c.triad) notes.push({ t, d: beat * 0.4, f, part: 'chord' });
			}
		});
		t0 += melody.length * tune.bar * beat;
	}
	notes.sort((a, b) => a.t - b.t);
	return { notes, length: t0 };
}

/**
 * Pick the next tune: any but the last one, when there is a choice.
 *
 * @param last Index of the tune just played, or -1.
 * @param n How many tunes there are.
 * @param rand Random number source (0 to 1).
 * @returns Index.
 */
export function nextTune(last: number, n: number, rand: () => number = Math.random): number {
	if (n < 2) return 0;
	if (last < 0) return Math.floor(rand() * n);
	const k = Math.floor(rand() * (n - 1));
	return k >= last && last >= 0 ? k + 1 : k;
}

/**
 * Play one note.
 *
 * @param c Context.
 * @param out Destination.
 * @param n Note.
 * @param at When the tune started, context seconds.
 */
export function playNote(c: BaseAudioContext, out: AudioNode, n: Note, at: number): void {
	const t = at + n.t;
	const g = c.createGain();
	g.connect(out);
	/**
	 * One oscillator into the note's gain, for the note's length.
	 *
	 * @param type Wave.
	 * @param f Frequency.
	 */
	const osc = (type: OscillatorType, f: number): void => {
		const o = c.createOscillator();
		o.type = type;
		o.frequency.value = f;
		o.connect(g);
		o.start(t);
		o.stop(t + n.d + 0.1);
	};
	if (n.part === 'lead') {
		// An accordion reed: two saws a hair apart, beating slowly.
		osc('sawtooth', n.f);
		osc('sawtooth', n.f * 1.004);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
		g.gain.setValueAtTime(0.09, t + Math.max(0.02, n.d * 0.9 - 0.04));
		g.gain.exponentialRampToValueAtTime(0.0001, t + n.d * 0.9 + 0.04);
	} else {
		osc(n.part === 'bass' ? 'triangle' : 'square', n.f);
		const peak = n.part === 'bass' ? 0.32 : 0.025;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
		g.gain.exponentialRampToValueAtTime(0.0001, t + n.d);
	}
}

/** Seconds of tuning static between tunes. */
export const STATIC_S = 1.4;

/**
 * Tuning static: noise swept through a band, with a whistle sliding past.
 *
 * @param c Context.
 * @param out Destination.
 * @param noise Noise buffer (at least STATIC_S long).
 * @param t Start, context seconds.
 */
export function playStatic(c: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number): void {
	const src = c.createBufferSource();
	src.buffer = noise;
	const bp = c.createBiquadFilter();
	bp.type = 'bandpass';
	bp.Q.value = 1.2;
	bp.frequency.setValueAtTime(500, t);
	bp.frequency.exponentialRampToValueAtTime(2600, t + STATIC_S);
	const g = c.createGain();
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(0.35, t + 0.1);
	g.gain.setValueAtTime(0.35, t + STATIC_S - 0.3);
	g.gain.exponentialRampToValueAtTime(0.0001, t + STATIC_S);
	src.connect(bp).connect(g).connect(out);
	src.start(t);
	src.stop(t + STATIC_S);
	const o = c.createOscillator();
	o.frequency.setValueAtTime(1900, t + 0.2);
	o.frequency.exponentialRampToValueAtTime(700, t + STATIC_S - 0.1);
	const og = c.createGain();
	og.gain.setValueAtTime(0.0001, t + 0.2);
	og.gain.exponentialRampToValueAtTime(0.03, t + 0.5);
	og.gain.exponentialRampToValueAtTime(0.0001, t + STATIC_S - 0.1);
	o.connect(og).connect(out);
	o.start(t + 0.2);
	o.stop(t + STATIC_S);
}

/**
 * The valve set: a narrow band with a bump in the middle, and a faint constant hiss.
 *
 * @param c Context.
 * @param out Where the set plays (the radio bus).
 * @param noise Noise buffer for the hiss.
 * @returns The set's input for the music, a second input that the music's dip never touches (the
 *   time signal), and a way to cut the set off from the bus (hiss included).
 */
export function valveSet(c: BaseAudioContext, out: AudioNode, noise: AudioBuffer): { input: GainNode; direct: GainNode; stop(): void } {
	const input = c.createGain();
	const direct = c.createGain();
	const hp = c.createBiquadFilter();
	hp.type = 'highpass';
	hp.frequency.value = 260;
	const lp = c.createBiquadFilter();
	lp.type = 'lowpass';
	lp.frequency.value = 3200;
	const mid = c.createBiquadFilter();
	mid.type = 'peaking';
	mid.frequency.value = 1100;
	mid.gain.value = 4;
	input.connect(hp).connect(lp).connect(mid).connect(out);
	direct.connect(hp);
	const hiss = c.createBufferSource();
	hiss.buffer = noise;
	hiss.loop = true;
	const hf = c.createBiquadFilter();
	hf.type = 'highpass';
	hf.frequency.value = 2500;
	const hg = c.createGain();
	hg.gain.value = 0.012;
	hiss.connect(hf).connect(hg).connect(out);
	hiss.start();
	return {
		input,
		direct,
		stop: () => {
			try { hiss.stop(); } catch { /* Already stopped. */ }
			mid.disconnect();
			hg.disconnect();
		},
	};
}

/** The six pips of the time signal, seconds before the hour: five short, and a long one on the hour. */
export const PIPS = [-5, -4, -3, -2, -1, 0] as const;

/**
 * The coming hour on the computer's own clock, in its own time zone (some zones are half an hour
 * off UTC, so UTC's hours will not do); now itself, exactly on the hour.
 *
 * @param now Milliseconds since the epoch.
 * @returns The hour, in milliseconds since the epoch.
 */
export function nextHour(now: number): number {
	const d = new Date(now);
	if (d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) return now;
	d.setMinutes(60, 0, 0);
	return d.getTime();
}

/**
 * Play the time signal on the set: six pips of 1 kHz, the last one long.
 *
 * @param c Context.
 * @param out The set's direct input.
 * @param at Context time of the hour (the last pip).
 */
export function playPips(c: BaseAudioContext, out: AudioNode, at: number): void {
	for (const s of PIPS) {
		const t = at + s, d = s === 0 ? 0.5 : 0.1;
		const o = c.createOscillator();
		o.frequency.value = 1000;
		const g = c.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.16, t + 0.004);
		g.gain.setValueAtTime(0.16, t + d - 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + d);
		o.connect(g).connect(out);
		o.start(t);
		o.stop(t + d + 0.02);
	}
}

export interface Radio {
	/** Switched on (it may still be silent until the browser lets audio start). */
	readonly on: boolean;
	/** The tune playing now, or null (off, silent, or between tunes). */
	readonly playing: string | null;
	/** True while it can actually be heard: on, audio has started, and the speaker is not hushed. */
	readonly audible: boolean;
	/**
	 * Switch on or off (saved).
	 *
	 * @param on True for on.
	 */
	set(on: boolean): void;
	/**
	 * Hear about changes: on or off, and each new tune.
	 *
	 * @param cb Called after each change.
	 */
	onChange(cb: () => void): void;
	/**
	 * Hear each pip of the time signal on the hour, as it sounds.
	 *
	 * @param cb Called with true for the long last pip.
	 */
	onPip(cb: (last: boolean) => void): void;
}

/** How far ahead notes are scheduled, seconds. More than a throttled background tab's timer gap. */
export const AHEAD_S = 2.5;

/**
 * Create the radio, switched off: it starts off on every visit.
 *
 * @param sound Sound engine.
 * @param tunes Tunes to play (the real ones by default).
 * @param rand Random number source.
 * @returns Radio.
 */
export function createRadio(sound: Sound, tunes: Tune[] = TUNES, rand: () => number = Math.random, clock: () => number = Date.now): Radio {
	const listeners: (() => void)[] = [];
	const pipListeners: ((last: boolean) => void)[] = [];
	/** The hour whose pips are scheduled. */
	let pipped = 0;
	let set: { input: GainNode; direct: GainNode; stop(): void; out: RadioOut } | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;
	let last = -1;
	let queue: Note[] = [];
	let next = 0;
	/** Context time the newest tune starts, and ends. */
	let start = 0, end = 0;
	/**
	 * The tune on air and the one queued after it: the next is queued while the last notes of
	 * this one still sound, so the title follows the clock, not the queue.
	 */
	let shows: { title: string; start: number; end: number }[] = [];
	let title: string | null = null;
	let waiting = false;

	/** Tell the listeners something changed. */
	const changed = (): void => { for (const cb of listeners) cb(); };

	/** Queue the next tune after a burst of static, starting at the given context time. */
	const tuneIn = (at: number): void => {
		if (!set) return;
		playStatic(set.out.c, set.input, set.out.noise, at);
		last = nextTune(last, tunes.length, rand);
		const a = arrange(tunes[last]);
		queue = a.notes;
		next = 0;
		start = at + STATIC_S;
		end = start + a.length;
		shows = [...shows.slice(-1), { title: tunes[last].title, start, end }];
	};

	/** Schedule whatever falls within the look-ahead; tune in to the next when this one ends. */
	const pump = (): void => {
		if (!set) return;
		const { c } = set.out;
		if (c.state !== 'running') return;
		const now = c.currentTime;
		// Back from a long pause (the context was suspended): start afresh rather than race to catch up.
		if (now > end + 1) tuneIn(now + 0.05);
		while (next < queue.length && start + queue[next].t < now + AHEAD_S) {
			const n = queue[next++];
			if (start + n.t >= now) playNote(c, set.input, n, start);
		}
		const t = shows.find((s) => now >= s.start && now < s.end)?.title ?? null;
		if (t !== title) { title = t; changed(); }
		if (next >= queue.length && now > end - AHEAD_S) tuneIn(end + 0.3);
		// The time signal: once its first pip is within the look-ahead, schedule all six, and dip the
		// music under them (it carries on underneath, so nothing is lost when it comes back up).
		const wall = clock(), hour = nextHour(wall);
		const lead = (hour + PIPS[0] * 1000 - wall) / 1000;
		if (hour !== pipped && lead < AHEAD_S && lead > -0.5) {
			pipped = hour;
			const at = now + (hour - wall) / 1000;
			playPips(c, set.direct, at);
			const g = set.input.gain;
			g.setTargetAtTime(0.06, at + PIPS[0] - 0.4, 0.08);
			g.setTargetAtTime(1, at + 0.7, 0.25);
			for (const s of PIPS) setTimeout(() => { for (const cb of pipListeners) cb(s === 0); }, Math.max(0, (hour + s * 1000 - wall)));
		}
	};

	/** Build the set and start playing, or wait for audio to start. */
	const begin = (): void => {
		if (!sound.settings.radioOn || set) return;
		const out = sound.radioOut();
		if (!out) {
			if (!waiting) { waiting = true; sound.onUnlock(() => { waiting = false; begin(); changed(); }); }
			return;
		}
		set = { ...valveSet(out.c, out.bus, out.noise), out };
		tuneIn(out.c.currentTime + 0.05);
		pump();
		timer = setInterval(pump, 250);
	};

	/** Fall silent: cut the set off from the bus, notes already scheduled included. */
	const halt = (): void => {
		if (timer) clearInterval(timer);
		timer = null;
		if (set) {
			const s = set;
			s.stop();
			set = null;
		}
		queue = [];
		shows = [];
		title = null;
	};

	begin();
	return {
		get on() { return sound.settings.radioOn; },
		get playing() { return title; },
		get audible() { return !!set && set.out.c.state === 'running' && !sound.settings.hushed; },
		set(on) {
			if (on === sound.settings.radioOn) return;
			// Switching the radio on is asking to hear it, so it lifts the speaker's hush.
			sound.set(on ? { radioOn: on, hushed: false } : { radioOn: on });
			if (on) begin(); else halt();
			changed();
		},
		onChange(cb) { listeners.push(cb); },
		onPip(cb) { pipListeners.push(cb); },
	};
}
