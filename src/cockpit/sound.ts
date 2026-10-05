/**
 * The plant's sound, synthesised with WebAudio: no files. Three buses under a master: ambient
 * (the factory drone, and wind while the camera is over Siberia), effects (the voices in
 * sound-cues.ts) and the radio (radio.ts). Ambient and effects have a level and a mute; the
 * radio has a level and is switched on or off. All are kept in localStorage. The bell has a
 * small bus of its own beside effects (at the Effects level), so the speaker's one-click hush
 * can silence everything but the bell.
 *
 * Chrome lets a page start audio only after the user has interacted with it, so the
 * AudioContext is created on the first pointerdown or keydown. Until then play() does nothing,
 * except that a bell is kept and rung once audio starts, so approvals already waiting are
 * announced.
 */
import type { Radio } from './radio';
import type { PlayOpts, SoundSink, Voice } from './sound-cues';

/** localStorage key for the levels and mutes. */
export const SOUND_KEY = 'plant67.sound';

/** Levels (0 to 1) and mutes for the buses, and whether the radio is on. */
export interface SoundSettings {
	ambient: number;
	effects: number;
	ambientMuted: boolean;
	effectsMuted: boolean;
	radio: number;
	radioOn: boolean;
	/** The speaker's one-click mute: everything but the approval bell. */
	hushed: boolean;
}

/**
 * On by default, quietly: ambient at 30%, effects at 60%. The radio starts off on every visit
 * (only its level is kept), so music never starts by surprise on a screen share.
 */
export const DEFAULT_SOUND: SoundSettings = { ambient: 0.3, effects: 0.6, ambientMuted: false, effectsMuted: false, radio: 0.5, radioOn: false, hushed: false };

/**
 * Read the settings, keeping only well-formed values.
 *
 * @returns Settings.
 */
export function loadSound(): SoundSettings {
	try {
		const raw = JSON.parse(localStorage.getItem(SOUND_KEY) ?? 'null') as Record<string, unknown> | null;
		if (!raw || typeof raw !== 'object') return { ...DEFAULT_SOUND };
		const level = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
		return {
			ambient: level(raw.ambient, DEFAULT_SOUND.ambient),
			effects: level(raw.effects, DEFAULT_SOUND.effects),
			ambientMuted: raw.ambientMuted === true,
			effectsMuted: raw.effectsMuted === true,
			radio: level(raw.radio, DEFAULT_SOUND.radio),
			radioOn: false,
			hushed: raw.hushed === true,
		};
	} catch { return { ...DEFAULT_SOUND }; }
}

/**
 * Save the settings, ignoring storage that refuses.
 *
 * @param s Settings.
 */
function saveSound(s: SoundSettings): void {
	const { radioOn: _, ...kept } = s;
	try { localStorage.setItem(SOUND_KEY, JSON.stringify(kept)); } catch { /* They just won't survive a reload. */ }
}

export interface Sound extends SoundSink {
	readonly settings: SoundSettings;
	/** True once the browser has let audio start. */
	readonly unlocked: boolean;
	/** The audio context's state ('running', 'suspended'), or null before it exists. */
	readonly state: string | null;
	/** Change the levels or mutes (saved). */
	set(change: Partial<SoundSettings>): void;
	/**
	 * How much of the screen is Siberia, 0 to 1: the drone gives way to wind.
	 *
	 * @param k Share of Siberia.
	 */
	setWind(k: number): void;
	/** Called once audio has started. */
	onUnlock(cb: () => void): void;
	/**
	 * Where the radio plays: the context, its bus and a noise buffer, or null before audio has started.
	 *
	 * @returns Radio output.
	 */
	radioOut(): RadioOut | null;
}

/** The radio's way into the sound graph. */
export interface RadioOut {
	c: AudioContext;
	bus: AudioNode;
	noise: AudioBuffer;
}

/** How far the radio dips under the bell, and for how long (seconds). */
export const RADIO_DUCK = { to: 0.25, hold: 1.4 };

/**
 * Create the sound engine and wait for the first gesture to start it.
 *
 * @param target Where to listen for the first gesture (normally window).
 * @returns Sound.
 */
export function createSound(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): Sound {
	let settings = loadSound();
	let ctx: AudioContext | null = null;
	let noise: AudioBuffer | null = null;
	let ambientBus: GainNode | null = null;
	let effectsBus: GainNode | null = null;
	let radioBus: GainNode | null = null;
	/** The approval bell's own path, so hushing never silences it. Follows the Effects level and mute. */
	let bellBus: GainNode | null = null;
	/** Under the radio bus: dips for the bell. The bus itself follows the Radio slider. */
	let radioDuck: GainNode | null = null;
	let droneGain: GainNode | null = null;
	let windGain: GainNode | null = null;
	let wind = 0;
	const unlockers: (() => void)[] = [];
	/** A bell asked for before audio could start, rung once it does. */
	let heldBell = false;

	/** Set the bus levels from the settings. */
	const levels = (): void => {
		if (!ctx || !ambientBus || !effectsBus || !radioBus || !bellBus) return;
		const t = ctx.currentTime;
		const hushed = settings.hushed;
		ambientBus.gain.setTargetAtTime(hushed || settings.ambientMuted ? 0 : settings.ambient, t, 0.08);
		effectsBus.gain.setTargetAtTime(hushed || settings.effectsMuted ? 0 : settings.effects, t, 0.05);
		bellBus.gain.setTargetAtTime(settings.effectsMuted ? 0 : settings.effects, t, 0.05);
		radioBus.gain.setTargetAtTime(hushed ? 0 : settings.radio, t, 0.08);
	};

	/** Crossfade the drone and the wind. */
	const blend = (): void => {
		if (!ctx || !droneGain || !windGain) return;
		const t = ctx.currentTime;
		droneGain.gain.setTargetAtTime(0.5 * (1 - 0.8 * wind), t, 0.6);
		windGain.gain.setTargetAtTime(0.55 * wind, t, 0.6);
	};

	/**
	 * A looping noise source.
	 *
	 * @param c Context.
	 * @returns Source, started.
	 */
	const loopNoise = (c: AudioContext): AudioBufferSourceNode => {
		const src = c.createBufferSource();
		src.buffer = noise;
		src.loop = true;
		src.start();
		return src;
	};

	/**
	 * The ambient bed: a factory drone of detuned low saws and rumbling noise, and wind.
	 *
	 * @param c Context.
	 */
	const ambience = (c: AudioContext): void => {
		droneGain = c.createGain();
		droneGain.gain.value = 0;
		droneGain.connect(ambientBus!);
		const lp = c.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 260;
		lp.Q.value = 0.7;
		lp.connect(droneGain);
		for (const [f, g] of [[55, 0.22], [55.35, 0.22], [110.4, 0.08], [82.6, 0.06]] as const) {
			const o = c.createOscillator();
			o.type = 'sawtooth';
			o.frequency.value = f;
			const og = c.createGain();
			og.gain.value = g;
			o.connect(og).connect(lp);
			o.start();
		}
		// Machinery breathing: the filter opens and closes slowly.
		const lfo = c.createOscillator();
		lfo.frequency.value = 0.13;
		const depth = c.createGain();
		depth.gain.value = 70;
		lfo.connect(depth).connect(lp.frequency);
		lfo.start();
		const rumble = c.createBiquadFilter();
		rumble.type = 'lowpass';
		rumble.frequency.value = 420;
		const rg = c.createGain();
		rg.gain.value = 0.35;
		loopNoise(c).connect(rumble).connect(rg).connect(droneGain);

		windGain = c.createGain();
		windGain.gain.value = 0;
		windGain.connect(ambientBus!);
		const bp = c.createBiquadFilter();
		bp.type = 'bandpass';
		bp.frequency.value = 550;
		bp.Q.value = 0.9;
		const gust = c.createOscillator();
		gust.frequency.value = 0.09;
		const gd = c.createGain();
		gd.gain.value = 300;
		gust.connect(gd).connect(bp.frequency);
		gust.start();
		loopNoise(c).connect(bp).connect(windGain);
		blend();
	};

	/** True once the context is actually running (a gesture Chrome accepted). */
	let live = false;
	/** The gestures Chrome may accept for starting audio (touch counts on pointerup). */
	const GESTURES = ['pointerdown', 'pointerup', 'keydown'] as const;

	/** Audio is running: stop listening, tell whoever waited, and ring a bell that was held. */
	const started = (): void => {
		// Suspended after it had started (the system's audio changed, say): listen for a gesture again.
		if (live && ctx && ctx.state !== 'running') {
			live = false;
			for (const g of GESTURES) target.addEventListener(g, unlock, true);
			return;
		}
		if (live || !ctx || ctx.state !== 'running') return;
		live = true;
		for (const g of GESTURES) target.removeEventListener(g, unlock, true);
		for (const cb of unlockers.splice(0)) cb();
		if (heldBell) { heldBell = false; api.play('bell', { delay: 0.2 }); }
	};

	/** Build the graph once, then ask the context to run. Every gesture asks again until it does. */
	const unlock = (): void => {
		if (live) return;
		if (!ctx) {
			const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
			if (!AC) return;
			try { ctx = new AC(); } catch { return; }
			ctx.addEventListener?.('statechange', started);
			noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
			const d = noise.getChannelData(0);
			for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
			const master = ctx.createGain();
			master.gain.value = 0.9;
			// A gentle limiter, so a clang on top of a train never clips.
			const comp = ctx.createDynamicsCompressor();
			comp.threshold.value = -10;
			comp.ratio.value = 6;
			master.connect(comp).connect(ctx.destination);
			ambientBus = ctx.createGain();
			effectsBus = ctx.createGain();
			radioBus = ctx.createGain();
			bellBus = ctx.createGain();
			ambientBus.gain.value = 0;
			effectsBus.gain.value = 0;
			radioBus.gain.value = 0;
			bellBus.gain.value = 0;
			ambientBus.connect(master);
			effectsBus.connect(master);
			bellBus.connect(master);
			radioDuck = ctx.createGain();
			radioBus.connect(radioDuck).connect(master);
			ambience(ctx);
			levels();
		}
		// Not every gesture counts (a touch pointerdown, Escape): keep listening until one does.
		void ctx.resume?.().then(started, () => {});
		started();
	};
	for (const g of GESTURES) target.addEventListener(g, unlock, true);

	/**
	 * An envelope: silent, up to peak in attack seconds, then down to nothing over decay.
	 *
	 * @param g Gain to shape.
	 * @param t Start time.
	 * @param peak Peak level.
	 * @param attack Seconds.
	 * @param decay Seconds.
	 */
	const env = (g: GainNode, t: number, peak: number, attack: number, decay: number): void => {
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(peak, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
	};

	/**
	 * A burst of filtered noise.
	 *
	 * @param c Context.
	 * @param out Destination.
	 * @param t Start.
	 * @param type Filter type.
	 * @param freq Filter frequency.
	 * @param q Filter Q.
	 * @param peak Level.
	 * @param attack Seconds.
	 * @param decay Seconds.
	 */
	const hiss = (c: AudioContext, out: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number): void => {
		const src = c.createBufferSource();
		src.buffer = noise;
		const f = c.createBiquadFilter();
		f.type = type;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = c.createGain();
		env(g, t, peak, attack, decay);
		src.connect(f).connect(g).connect(out);
		// Any stretch of the 2 s buffer will do; every burst here is shorter than 1.4 s.
		src.start(t, Math.random() * 0.5);
		src.stop(t + attack + decay + 0.05);
	};

	/**
	 * A plain tone, optionally sliding in pitch.
	 *
	 * @param c Context.
	 * @param out Destination.
	 * @param t Start.
	 * @param type Wave.
	 * @param f0 Start frequency.
	 * @param f1 End frequency.
	 * @param peak Level.
	 * @param attack Seconds.
	 * @param decay Seconds.
	 */
	const tone = (c: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number): OscillatorNode => {
		const o = c.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
		const g = c.createGain();
		env(g, t, peak, attack, decay);
		o.connect(g).connect(out);
		o.start(t);
		o.stop(t + attack + decay + 0.05);
		return o;
	};

	/**
	 * Play one voice.
	 *
	 * @param c Context.
	 * @param v Voice.
	 * @param out Destination (already carrying gain and pan).
	 * @param t Start.
	 */
	const voice = (c: AudioContext, v: Voice, out: AudioNode, t: number): void => {
		switch (v) {
			case 'clang': {
				// FM metal: an inharmonic modulator whose depth dies away faster than the ring.
				const car = c.createOscillator();
				car.frequency.value = 523;
				const mod = c.createOscillator();
				mod.frequency.value = 523 * 1.41;
				const depth = c.createGain();
				depth.gain.setValueAtTime(900, t);
				depth.gain.exponentialRampToValueAtTime(20, t + 0.35);
				mod.connect(depth).connect(car.frequency);
				const g = c.createGain();
				env(g, t, 0.35, 0.002, 0.45);
				car.connect(g).connect(out);
				car.start(t); mod.start(t);
				car.stop(t + 0.5); mod.stop(t + 0.5);
				hiss(c, out, t, 'highpass', 3000, 0.7, 0.15, 0.001, 0.05);
				break;
			}
			case 'thud':
				tone(c, out, t, 'sine', 110, 48, 0.8, 0.004, 0.18);
				hiss(c, out, t, 'lowpass', 900, 0.7, 0.35, 0.002, 0.07);
				break;
			case 'steam':
				hiss(c, out, t, 'bandpass', 3200, 0.6, 0.35, 0.08, 0.9);
				break;
			case 'whistle':
				// A steam whistle is a chord: two pipes, slightly out of tune, with a wobble.
				for (const f of [740, 932]) {
					const o = tone(c, out, t, 'sine', f, f, 0.12, 0.12, 1.1);
					const vib = c.createOscillator();
					vib.frequency.value = 6;
					const vd = c.createGain();
					vd.gain.value = 5;
					vib.connect(vd).connect(o.frequency);
					vib.start(t); vib.stop(t + 1.3);
				}
				hiss(c, out, t, 'bandpass', 2400, 2, 0.06, 0.1, 1);
				break;
			case 'doors':
				// Iron doors sliding: a low grinding rumble.
				tone(c, out, t, 'sawtooth', 46, 38, 0.18, 0.15, 1.3);
				hiss(c, out, t, 'lowpass', 180, 1.2, 0.5, 0.2, 1.2);
				hiss(c, out, t + 1.35, 'lowpass', 400, 0.7, 0.4, 0.005, 0.25);
				break;
			case 'airbrush':
				hiss(c, out, t, 'highpass', 5000, 0.7, 0.18, 0.1, 1.2);
				break;
			case 'gavel':
				for (const k of [0, 0.3, 0.6]) {
					tone(c, out, t + k, 'triangle', 190, 150, 0.5, 0.002, 0.12);
					hiss(c, out, t + k, 'bandpass', 1800, 1.5, 0.3, 0.001, 0.04);
				}
				break;
			case 'clack':
				hiss(c, out, t, 'bandpass', 3000, 2, 0.6, 0.001, 0.035);
				tone(c, out, t, 'square', 1200, 900, 0.05, 0.001, 0.03);
				break;
			case 'rustle':
				for (let k = 0; k < 4; k++) hiss(c, out, t + k * 0.05 + Math.random() * 0.02, 'bandpass', 2500 + Math.random() * 2000, 0.8, 0.2, 0.01, 0.07);
				break;
			case 'bell':
				// A desk bell: a bright strike with inharmonic partials ringing on.
				for (const [m, g, d] of [[1, 0.25, 1.4], [2.76, 0.1, 0.8], [5.4, 0.05, 0.4]] as const) tone(c, out, t, 'sine', 2093 * m, 2093 * m, g, 0.002, d);
				break;
			case 'pop':
				tone(c, out, t, 'sine', 320, 980, 0.25, 0.005, 0.07);
				break;
			case 'fizz':
				// Soda water: a soft hiss with bubbles bursting through it.
				hiss(c, out, t, 'highpass', 4500, 0.7, 0.1, 0.03, 0.7);
				for (let k = 0; k < 6; k++) tone(c, out, t + 0.05 + Math.random() * 0.5, 'sine', 1800 + Math.random() * 1400, 2600, 0.03, 0.002, 0.02);
				break;
			case 'snore':
				// A slow, rasping breath in.
				tone(c, out, t, 'sawtooth', 85, 70, 0.05, 0.45, 0.55);
				hiss(c, out, t, 'lowpass', 500, 1, 0.12, 0.45, 0.5);
				break;
			case 'wings':
				// A flutter: a run of quick, soft flaps.
				for (let k = 0; k < 9; k++) hiss(c, out, t + k * 0.055, 'bandpass', 700 + Math.random() * 300, 1.2, 0.18 - k * 0.015, 0.008, 0.04);
				break;
			case 'ding':
				// A small, soft bell: the bust's wink.
				for (const [m, g, d] of [[1, 0.12, 0.9], [2.4, 0.04, 0.4]] as const) tone(c, out, t, 'sine', 1318 * m, 1318 * m, g, 0.003, d);
				break;
			case 'snare':
				// A side drum: a crack of bright noise over a short, dull body.
				hiss(c, out, t, 'highpass', 1800, 0.8, 0.32, 0.001, 0.11);
				tone(c, out, t, 'triangle', 220, 160, 0.18, 0.001, 0.06);
				break;
			case 'beep':
				// Sputnik: two short, thin beeps, far away.
				for (const k of [0, 0.32]) tone(c, out, t + k, 'sine', 1040, 1040, 0.07, 0.004, 0.13);
				break;
			case 'huff':
				// A bear's snort: a rough breath out through the nose.
				hiss(c, out, t, 'lowpass', 650, 1.2, 0.35, 0.02, 0.32);
				tone(c, out, t, 'sawtooth', 70, 55, 0.05, 0.02, 0.28);
				break;
			case 'crackle':
				// A firework: the bang, then the sparks crackling as they fall.
				tone(c, out, t, 'sine', 140, 50, 0.4, 0.003, 0.25);
				hiss(c, out, t, 'lowpass', 1200, 0.7, 0.3, 0.002, 0.2);
				for (let k = 0; k < 10; k++) hiss(c, out, t + 0.2 + Math.random() * 0.7, 'highpass', 3500, 0.7, 0.07, 0.001, 0.02);
				break;
		}
	};

	const api: Sound = {
		get settings() { return { ...settings }; },
		get unlocked() { return live; },
		get state() { return ctx?.state ?? null; },
		set(change) {
			settings = { ...settings, ...change };
			saveSound(settings);
			levels();
		},
		setWind(k) {
			const next = Math.max(0, Math.min(1, k));
			if (Math.abs(next - wind) < 0.02) return;
			wind = next;
			blend();
		},
		onUnlock(cb) { if (live) cb(); else unlockers.push(cb); },
		radioOut: () => (live && ctx && radioBus && noise ? { c: ctx, bus: radioBus, noise } : null),
		play(v: Voice, o: PlayOpts = {}) {
			if (!live && v === 'bell') heldBell = true;
			const bell = v === 'bell' && !o.ambient;
			const bus = o.ambient ? ambientBus : bell ? bellBus : effectsBus;
			const silent = (o.ambient ? settings.ambientMuted : settings.effectsMuted) || (settings.hushed && !bell);
			// A suspended context would bank sounds and play them all at once when it resumes.
			if (!ctx || !bus || silent || ctx.state !== 'running') return;
			const t = ctx.currentTime + 0.01 + (o.delay ?? 0);
			const g = ctx.createGain();
			g.gain.value = o.gain ?? 1;
			let out: AudioNode = g;
			if (o.pan && typeof ctx.createStereoPanner === 'function') {
				const p = ctx.createStereoPanner();
				p.pan.value = o.pan;
				g.connect(p);
				out = p;
			}
			out.connect(bus);
			voice(ctx, v, g, t);
			// The radio dips under the bell, so a new approval is never lost in the music.
			// A second bell takes over from the first: its dip is not cut short by the first's recovery.
			if (v === 'bell' && radioDuck) {
				radioDuck.gain.cancelScheduledValues(t - 0.01);
				radioDuck.gain.setTargetAtTime(RADIO_DUCK.to, t - 0.01, 0.03);
				radioDuck.gain.setTargetAtTime(1, t + RADIO_DUCK.hold, 0.3);
			}
		},
	};
	return api;
}

/** Which speaker the button shows: sounding, the bell silent, or silent. */
export type SpeakerIcon = 'on' | 'low' | 'off';

/**
 * A pixel-crisp speaker drawn in SVG, the same on every system (emoji differ from one to the next).
 *
 * @param kind Sounding (two waves), the bell silent (one wave) or silent (a cross).
 * @returns The icon, in the button's text colour.
 */
function speakerIcon(kind: SpeakerIcon): SVGSVGElement {
	const NS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('shape-rendering', 'crispEdges');
	/**
	 * One stroke or shape.
	 *
	 * @param d Path data.
	 * @param fill True to fill rather than stroke.
	 */
	const path = (d: string, fill: boolean): void => {
		const p = document.createElementNS(NS, 'path');
		p.setAttribute('d', d);
		p.setAttribute('fill', fill ? 'currentColor' : 'none');
		if (!fill) {
			p.setAttribute('stroke', 'currentColor');
			p.setAttribute('stroke-width', '1.5');
			p.setAttribute('stroke-linecap', 'square');
		}
		svg.append(p);
	};
	path('M1 6h3l4-4v12l-4-4H1z', true);
	if (kind === 'off') path('M10.5 5.5l4 5M14.5 5.5l-4 5', false);
	else {
		path('M10.5 5.5c1 1.4 1 3.6 0 5', false);
		if (kind === 'on') path('M12.5 3.5c2 2.6 2 6.4 0 9', false);
	}
	return svg;
}

/** A box on the page, viewport pixels. */
export interface Box { left: number; top: number; right: number; bottom: number }

/** The sound panel and the speaker that hushes. */
export interface SoundPanel {
	/** The speaker in the corner: one click hushes everything but the bell. */
	button: HTMLButtonElement;
	/** The levels, the radio and the settings: opened from the radiogram. */
	panel: HTMLElement;
	/**
	 * Open the panel beside a box on the page, or close it if open.
	 *
	 * @param beside The box it opens beside (the radiogram), viewport pixels.
	 * @param opener What to give focus back to when it closes from the keyboard, or null.
	 */
	toggle(beside: Box, opener: HTMLElement | null): void;
	/**
	 * Keep the open panel beside its box, as the plant moves under it.
	 *
	 * @param beside The box, viewport pixels.
	 */
	follow(beside: Box): void;
	/**
	 * Close the panel.
	 *
	 * @param refocus Give focus back to what opened it (a close from the keyboard).
	 * @returns True when it was open.
	 */
	close(refocus?: boolean): boolean;
	readonly open: boolean;
}

/**
 * The speaker for the corner, which hushes everything but the bell in one click, and the sound
 * panel the radiogram opens: a level and a mute for each bus, the radio's level, its switch and
 * what it is playing, and any settings rows the cockpit adds.
 *
 * @param sound Sound engine.
 * @param radio The radio, if the plant has one.
 * @param settings Rows for the panel's Settings section.
 * @param ignore Pointer presses here do not close the panel (the stage: the cockpit decides).
 * @returns The speaker and the panel (add both to the cockpit).
 */
export function createSoundPanel(sound: Sound, radio?: Radio, settings: HTMLElement[] = [], ignore?: HTMLElement): SoundPanel {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'p67-speaker';
	const panel = document.createElement('section');
	panel.className = 'p67-sound';
	panel.hidden = true;
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-label', 'Sound');

	/**
	 * True when every level is already at nothing, hush or no hush.
	 *
	 * @param s Settings.
	 * @returns True when nothing would be heard.
	 */
	const allOff = (s: SoundSettings): boolean =>
		(s.ambientMuted || s.ambient === 0) && (s.effectsMuted || s.effects === 0) && (!s.radioOn || s.radio === 0);

	/** Show the speaker's state on the button. */
	const face = (): void => {
		const s = sound.settings;
		const bellOff = s.effectsMuted || s.effects === 0;
		const off = allOff(s);
		const kind: SpeakerIcon = s.hushed || off ? 'off' : bellOff ? 'low' : 'on';
		if (button.dataset.icon !== kind) { button.dataset.icon = kind; button.replaceChildren(speakerIcon(kind)); }
		button.setAttribute('aria-pressed', String(s.hushed));
		hushedNote.hidden = !s.hushed;
		// The effects carry the bell, so silencing them is worth saying, hushed or not.
		button.title = s.hushed
			? bellOff
				? 'Sound is muted, and the effects are off, so the bell for new approvals is silent too. Click to bring the sound back.'
				: 'Sound is muted, except the bell for new approvals. Click to bring it back.'
			: off
				? 'Sound is off. Click to change the levels.'
				: bellOff
					? 'Effects are off, so the bell for new approvals is silent. Click to mute the rest.'
					: 'Sound is on. Click to mute everything except the bell for new approvals.';
		// aria-pressed carries the hush; the label says what the button does.
		button.setAttribute('aria-label', !s.hushed && off ? 'Sound is off: change the levels' : 'Mute everything except the bell');
	};

	/**
	 * One bus: a label, a level slider and a mute box.
	 *
	 * @param label Label.
	 * @param level Settings key for the level.
	 * @param muted Settings key for the mute.
	 * @returns Row.
	 */
	const row = (label: string, level: 'ambient' | 'effects' | 'radio', muted: 'ambientMuted' | 'effectsMuted' | null): HTMLElement => {
		const r = document.createElement('div');
		r.className = 'p67-sound-row';
		const name = document.createElement('label');
		name.textContent = label;
		const slider = document.createElement('input');
		slider.type = 'range';
		slider.min = '0';
		slider.max = '100';
		slider.value = String(Math.round(sound.settings[level] * 100));
		slider.id = `p67-sound-${level}`;
		name.htmlFor = slider.id;
		slider.setAttribute('aria-label', `${label} level`);
		const value = document.createElement('span');
		value.className = 'p67-sound-value';
		value.textContent = `${slider.value}%`;
		slider.addEventListener('input', () => {
			value.textContent = `${slider.value}%`;
			sound.set({ [level]: Number(slider.value) / 100 });
			face();
		});
		const mute = document.createElement('label');
		mute.className = 'p67-sound-mute';
		const box = document.createElement('input');
		box.type = 'checkbox';
		if (muted) {
			box.checked = sound.settings[muted];
			box.setAttribute('aria-label', `Mute ${label.toLowerCase()}`);
			box.addEventListener('change', () => { sound.set({ [muted]: box.checked }); face(); });
			mute.append(box, document.createTextNode('Mute'));
		} else if (radio) {
			// The radio is switched on rather than muted: off by default, and it stops playing when off.
			box.checked = radio.on;
			box.setAttribute('aria-label', 'Radio on');
			box.addEventListener('change', () => radio.set(box.checked));
			radio.onChange(() => { box.checked = radio.on; face(); });
			mute.append(box, document.createTextNode('On'));
		}
		r.append(name, slider, value);
		if (mute.childNodes.length) r.append(mute);
		return r;
	};

	const hushedNote = document.createElement('p');
	hushedNote.className = 'p67-sound-hushed';
	hushedNote.textContent = 'The speaker is muting everything except the bell. Click it to bring the sound back.';
	panel.append(hushedNote);
	const note = document.createElement('p');
	note.className = 'p67-sound-note';
	note.textContent = 'The browser starts sound after your first click or key press in the plant.';
	panel.append(row('Ambient', 'ambient', 'ambientMuted'), row('Effects', 'effects', 'effectsMuted'));
	if (radio) {
		const onAir = document.createElement('p');
		onAir.className = 'p67-sound-onair';
		onAir.setAttribute('aria-live', 'polite');
		/** Say what the radio is doing. */
		const tell = (): void => {
			onAir.hidden = !radio.on;
			onAir.textContent = radio.playing ? `♪ ${radio.playing}` : 'Tuning in…';
		};
		radio.onChange(tell);
		tell();
		panel.append(row('Radio', 'radio', null), onAir);
	}
	if (settings.length) {
		const head = document.createElement('h4');
		head.className = 'p67-sound-head';
		head.textContent = 'Settings';
		panel.append(head, ...settings);
	}
	panel.append(note);
	sound.onUnlock(() => { note.hidden = true; });
	face();

	let opener: HTMLElement | null = null;
	/** The panel's height, measured when it opens rather than every frame it follows. */
	let height = 0;
	/**
	 * Put the panel beside a box: to its right, or to its left where the right has no room; level
	 * with its top; inside the window.
	 *
	 * @param b Box, viewport pixels.
	 */
	const place = (b: Box): void => {
		// 280: the panel's CSS width, in style.ts.
		const w = 280, right = b.right + 16, left = b.left - 16 - w;
		const x = right + w <= window.innerWidth - 10 || left < 10 ? right : left;
		panel.style.left = `${Math.round(Math.max(10, Math.min(x, window.innerWidth - w - 10)))}px`;
		panel.style.top = `${Math.round(Math.max(10, Math.min(b.top - 10, window.innerHeight - height - 10)))}px`;
	};
	/**
	 * Close the panel.
	 *
	 * @param refocus Give focus back to what opened it.
	 * @returns True when it was open.
	 */
	const close = (refocus = false): boolean => {
		if (panel.hidden) return false;
		panel.hidden = true;
		if (refocus) opener?.focus();
		opener = null;
		return true;
	};
	/**
	 * Open the panel beside a box.
	 *
	 * @param b Box, viewport pixels.
	 */
	const show = (b: Box): void => {
		panel.hidden = false;
		height = panel.offsetHeight;
		place(b);
	};
	button.addEventListener('click', () => {
		const s = sound.settings;
		// With every level already at nothing, a hush would change nothing: open the levels instead.
		if (allOff(s) && !s.hushed) {
			face();
			if (!close()) {
				const r = button.getBoundingClientRect();
				opener = button;
				// Under the speaker, in the corner.
				show({ left: r.right - 296, top: r.bottom + 16, right: r.right - 296, bottom: r.bottom + 16 });
			}
			return;
		}
		sound.set({ hushed: !s.hushed });
		face();
	});
	panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(true); e.stopPropagation(); });
	button.addEventListener('keydown', (e) => { if (e.key === 'Escape' && close()) e.stopPropagation(); });
	document.addEventListener('pointerdown', (e) => {
		const t = e.target as Node | null;
		if (!panel.hidden && t && !panel.contains(t) && t !== button && !button.contains(t) && !ignore?.contains(t)) close();
	});
	return {
		button, panel, close,
		get open() { return !panel.hidden; },
		follow(b) { if (!panel.hidden) place(b); },
		toggle(b, from) {
			if (close()) return;
			opener = from;
			show(b);
			// From the keyboard, into the panel.
			if (from) panel.querySelector<HTMLElement>('input, button')?.focus();
		},
	};
}
