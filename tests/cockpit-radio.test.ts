/**
 * The radio: the tunes are written out correctly and arranged in time, the next tune
 * is never the same one twice running, and the player, against a stand-in AudioContext, stays
 * silent until switched on and until audio has started, falls silent at once when switched off,
 * starts off again after a reload (keeping its level), and dips under the bell. Plus its row in the sound popover.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { type Tune, TUNES } from '../src/cockpit/radio-tunes';

const win = new Window();
Object.assign(globalThis, { document: win.document, localStorage: win.localStorage, window: win });
const { AHEAD_S, STATIC_S, arrange, bars, chord, nextTune, pitch } = await import('../src/cockpit/radio');
const { PIPS, createRadio, nextHour } = await import('../src/cockpit/radio');
const { RADIO_DUCK, SOUND_KEY, createSound, createSoundPanel } = await import('../src/cockpit/sound');

const close = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 0.01, msg ?? `${a} ≈ ${b}`);

test('radio: pitches and chords', () => {
	close(pitch('A4'), 440);
	close(pitch('A5'), 880);
	close(pitch('C5'), 523.25);
	close(pitch('Bb3'), 233.08);
	close(pitch('F#4'), 369.99);
	assert.throws(() => pitch('H4'));
	assert.throws(() => pitch('A'));
	const am = chord('Am'), e = chord('E');
	close(am.root, 110);
	close(am.triad[1] / am.triad[0], 2 ** (3 / 12), 'minor third');
	close(e.triad[1] / e.triad[0], 2 ** (4 / 12), 'major third');
	close(am.fifth / am.root, 2 ** (7 / 12));
	assert.throws(() => chord('Xm'));
});

test('radio: every tune is written out right: whole bars, a chord for each, pitches in a singable range', () => {
	assert.ok(TUNES.length >= 1);
	for (const t of TUNES) {
		const bs = bars(t.melody);
		bs.forEach((b, k) => {
			const beats = b.reduce((a, [, n]) => a + n, 0);
			assert.equal(beats, t.bar, `${t.title}, bar ${k + 1}: ${beats} beats, not ${t.bar}`);
			for (const [p] of b) if (p !== 'r') assert.ok(pitch(p) >= pitch('G3') && pitch(p) <= pitch('C6'), `${t.title}, bar ${k + 1}: ${p} is out of range`);
		});
		const cs = t.chords.split('|').map((x) => x.trim().split(/\s+/));
		assert.equal(cs.length, bs.length, `${t.title}: one chord bar per melody bar`);
		for (const c of cs.flat()) chord(c);
		assert.ok(t.times >= 1 && t.bpm > 40 && t.bpm < 240 && t.accel >= 0 && t.accel < 0.2);
	}
});

test('radio: Korobeiniki starts E B C D, and runs faster each time through', () => {
	const k = TUNES.find((t) => t.title === 'Korobeiniki')!;
	const { notes, length } = arrange(k);
	const lead = notes.filter((n) => n.part === 'lead');
	assert.deepEqual(lead.slice(0, 4).map((n) => Math.round(n.f)), ['E5', 'B4', 'C5', 'D5'].map((p) => Math.round(pitch(p))));
	const beat = 60 / k.bpm;
	close(lead[1].t, beat, 'the second note on the second beat');
	const once = 8 * k.bar * beat;
	assert.ok(length < once * k.times, 'faster each time, so shorter than three slow runs');
	assert.ok(length > once * k.times * 0.8);
	assert.ok(notes.every((n, i) => i === 0 || n.t >= notes[i - 1].t), 'in time order');
	assert.ok(notes.every((n) => n.d > 0 && n.t + n.d <= length + 1e-9), 'every note inside the tune');
	assert.ok(notes.some((n) => n.part === 'bass') && notes.some((n) => n.part === 'chord'), 'with the oom-pah');
});

test('radio: the next tune is never the one just played, and every tune gets a turn', () => {
	assert.equal(nextTune(-1, 1), 0);
	assert.deepEqual([0, 0.5, 0.99].map((r) => nextTune(-1, 3, () => r)), [0, 1, 2], 'any tune can open, the last one included');
	assert.equal(nextTune(0, 1), 0, 'one tune plays again');
	const seen = new Set<number>();
	for (let i = 0; i < 200; i++) {
		const last = i % 4;
		const k = nextTune(last, 4, () => (i % 10) / 10);
		assert.notEqual(k, last);
		assert.ok(k >= 0 && k < 4);
		seen.add(k);
	}
	assert.equal(seen.size, 4);
});

/** Every param call, per node. */
interface Param { value: number; calls: [string, number, number][] }

/** A stand-in AudioContext whose nodes record what is done to them. */
class FakeContext {
	static made: FakeContext[] = [];
	static allow = false;
	state = 'suspended';
	currentTime = 0;
	sampleRate = 8000;
	destination = {};
	/** Sources started, and nodes disconnected. */
	starts: number[] = [];
	disconnects = 0;
	gains: Param[] = [];
	private listeners: (() => void)[] = [];
	constructor() { FakeContext.made.push(this); }
	/** @returns A param that records its calls. */
	param(): Param {
		const p: Param & Record<string, unknown> = { value: 0, calls: [] };
		for (const m of ['setValueAtTime', 'setTargetAtTime', 'exponentialRampToValueAtTime', 'linearRampToValueAtTime', 'cancelScheduledValues']) p[m] = (v: number, t: number) => { p.calls.push([m, v, t]); };
		return p;
	}
	/** @returns A node that takes any call. */
	node(): Record<string, unknown> {
		const n: Record<string, unknown> = { gain: this.param(), frequency: this.param(), Q: this.param(), pan: this.param(), threshold: this.param(), ratio: this.param(), buffer: null, loop: false, type: '' };
		n.connect = (x: unknown) => x;
		n.disconnect = () => { this.disconnects++; };
		n.start = (t?: number) => { this.starts.push(t ?? this.currentTime); };
		n.stop = () => {};
		return n;
	}
	createGain() { const n = this.node(); this.gains.push(n.gain as Param); return n; }
	createOscillator() { return this.node(); }
	createBiquadFilter() { return this.node(); }
	createBufferSource() { return this.node(); }
	createDynamicsCompressor() { return this.node(); }
	createStereoPanner() { return this.node(); }
	createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
	addEventListener(_t: string, cb: () => void) { this.listeners.push(cb); }
	async resume() { if (FakeContext.allow) { this.state = 'running'; for (const cb of this.listeners) cb(); } }
}

/**
 * A sound engine over a fake context, and a way to give the first gesture.
 *
 * @returns Sound, and gesture().
 */
function engine() {
	const handlers = new Map<string, () => void>();
	Object.assign(globalThis, { AudioContext: FakeContext });
	FakeContext.made = [];
	const sound = createSound({ addEventListener: (t: string, cb: () => void) => handlers.set(t, cb), removeEventListener: (t: string) => handlers.delete(t) } as never);
	const gesture = async (allow = true): Promise<FakeContext> => {
		FakeContext.allow = allow;
		handlers.get('pointerdown')?.();
		await new Promise((r) => setTimeout(r, 5));
		return FakeContext.made[0];
	};
	return { sound, gesture };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A tune long enough never to end during a test. */
const LONG: Tune = { title: 'Long', bpm: 60, bar: 4, melody: Array(8).fill('A4:4').join(' | '), chords: 'Am', times: 1, accel: 0 };

test('the radio: off by default and silent; switched on before audio starts, it waits, then plays after the first gesture', async () => {
	localStorage.removeItem(SOUND_KEY);
	const { sound, gesture } = engine();
	const radio = createRadio(sound, [LONG]);
	assert.equal(radio.on, false);
	const ctx = await gesture();
	await wait(300);
	const idle = ctx.starts.length;
	assert.ok(idle > 0, 'the drone started');
	await wait(300);
	assert.equal(ctx.starts.length, idle, 'nothing more while the radio is off');
	assert.equal(radio.playing, null);

	const { sound: s2, gesture: g2 } = engine();
	const r2 = createRadio(s2, [LONG]);
	let told = 0;
	r2.onChange(() => told++);
	r2.set(true);
	assert.equal(JSON.parse(localStorage.getItem(SOUND_KEY)!).radioOn, undefined, 'on is never saved');
	assert.equal(r2.audible, false, 'on, but the browser has not let audio start');
	const c2 = await g2();
	assert.equal(r2.audible, true);
	assert.ok(told >= 2);
	const n = c2.starts.length;
	assert.ok(c2.starts.some((t) => t >= STATIC_S), 'notes after the static are scheduled');
	assert.ok(c2.starts.every((t) => t <= AHEAD_S + 0.1), 'but only a little way ahead');
	assert.equal(r2.playing, null, 'tuning in: static first');
	c2.currentTime = STATIC_S + 0.5;
	await wait(300);
	assert.equal(r2.playing, 'Long');
	assert.ok(c2.starts.length > n, 'more notes as time goes on');
	r2.set(false);
	localStorage.removeItem(SOUND_KEY);
});

test('the radio: the title stays on air to the tune\'s last note, while the next is queued behind it', async () => {
	localStorage.removeItem(SOUND_KEY);
	const SHORT: Tune = { title: 'Short', bpm: 60, bar: 4, melody: 'A4:4', chords: 'Am', times: 1, accel: 0 };
	const { sound, gesture } = engine();
	const radio = createRadio(sound, [SHORT, LONG], () => 0);
	const ctx = await gesture();
	radio.set(true);
	const end = 0.05 + STATIC_S + 4;
	ctx.currentTime = STATIC_S + 1;
	await wait(300);
	assert.equal(radio.playing, 'Short');
	ctx.currentTime = end - 1;
	await wait(300);
	await wait(300);
	assert.equal(radio.playing, 'Short', 'still Short near its end, although Long is already queued');
	ctx.currentTime = end + 0.5;
	await wait(300);
	assert.equal(radio.playing, null, 'static between the two');
	ctx.currentTime = end + 0.3 + STATIC_S + 0.5;
	await wait(300);
	assert.equal(radio.playing, 'Long');
	radio.set(false);
	localStorage.removeItem(SOUND_KEY);
});

test('the radio: switching off cuts it off at once and schedules nothing more; left on, it is off again after a reload', async () => {
	localStorage.removeItem(SOUND_KEY);
	const { sound, gesture } = engine();
	const radio = createRadio(sound, [LONG]);
	const ctx = await gesture();
	radio.set(true);
	const cut = ctx.disconnects;
	radio.set(false);
	assert.ok(ctx.disconnects > cut, 'the set is disconnected, notes already scheduled with it');
	assert.equal(radio.playing, null);
	assert.equal(radio.audible, false);
	const n = ctx.starts.length;
	ctx.currentTime = 5;
	await wait(300);
	assert.equal(ctx.starts.length, n, 'nothing more is scheduled');

	radio.set(true);
	sound.set({ radio: 0.3 });
	const { sound: again, gesture: g2 } = engine();
	const back = createRadio(again, [LONG]);
	assert.equal(back.on, false, 'off again after a reload');
	assert.equal(again.settings.radio, 0.3, 'at the level it was left at');
	await g2();
	assert.equal(back.audible, false, 'and silent once audio starts');
	radio.set(false);
	localStorage.removeItem(SOUND_KEY);
});

test('the radio dips under the bell and comes back up', async () => {
	localStorage.removeItem(SOUND_KEY);
	const { sound, gesture } = engine();
	const ctx = await gesture();
	sound.set({ radio: 0.8 });
	sound.play('bell');
	const duck = ctx.gains.find((g) => g.calls.some(([m, v]) => m === 'setTargetAtTime' && v === RADIO_DUCK.to));
	assert.ok(duck, 'the radio dipped');
	const last = duck.calls.at(-1)!;
	assert.deepEqual([last[0], last[1]], ['setTargetAtTime', 1], 'then back up');
	assert.ok(last[2] >= RADIO_DUCK.hold, 'after the bell has rung');
	// The slider owns the bus, the bell owns the dip: moving the slider mid-bell is not undone by the recovery.
	assert.ok(duck.calls.every(([, v]) => v !== 0.8), 'the dip never writes the slider level');
	sound.set({ radio: 0 });
	assert.ok(ctx.gains.some((g) => g !== duck && g.calls.at(-1)?.[1] === 0), 'the slider still reaches the bus');
	ctx.currentTime = 0.5;
	sound.play('bell');
	const n = duck.calls.length;
	assert.equal(duck.calls[n - 3][0], 'cancelScheduledValues', 'a second bell cancels the first one\'s recovery before dipping');
	localStorage.removeItem(SOUND_KEY);
});

test('hushed: the drone, the effects and the radio go silent, the bell still rings, and the radio shows as unheard', async () => {
	localStorage.removeItem(SOUND_KEY);
	const { sound, gesture } = engine();
	const radio = createRadio(sound, [LONG]);
	const ctx = await gesture();
	sound.set({ ambient: 0.31, effects: 0.62, radio: 0.53 });
	const last = (g: Param) => g.calls.filter(([m]) => m === 'setTargetAtTime').at(-1)?.[1];
	const ambient = ctx.gains.filter((g) => last(g) === 0.31);
	const effects = ctx.gains.filter((g) => last(g) === 0.62);
	const radioBus = ctx.gains.filter((g) => last(g) === 0.53);
	assert.deepEqual([ambient.length, effects.length, radioBus.length], [1, 2, 1], 'one ambient bus, the effects bus and the bell\'s, one radio bus');
	radio.set(true);
	await wait(50);
	assert.equal(radio.audible, true);
	sound.set({ hushed: true });
	assert.equal(last(ambient[0]), 0);
	assert.equal(last(radioBus[0]), 0);
	assert.deepEqual(effects.map(last).sort(), [0, 0.62], 'the effects bus goes quiet; the bell\'s stays at the Effects level');
	assert.equal(radio.audible, false, 'no notes rise from a radio nobody can hear');
	assert.equal(radio.on, true, 'it keeps playing underneath, so unhushing brings back the same tune');
	let n = ctx.starts.length;
	sound.play('thud');
	assert.equal(ctx.starts.length, n, 'effects are skipped while hushed');
	sound.play('bell');
	assert.ok(ctx.starts.length > n, 'the bell rings');
	sound.set({ effectsMuted: true });
	assert.deepEqual(effects.map(last), [0, 0], 'the Effects mute still silences the bell');
	n = ctx.starts.length;
	sound.play('bell');
	assert.equal(ctx.starts.length, n);
	sound.set({ hushed: false, effectsMuted: false });
	assert.deepEqual([last(ambient[0]), last(radioBus[0]), ...effects.map(last)], [0.31, 0.53, 0.62, 0.62], 'back to the levels as they were');
	radio.set(false);
	sound.set({ hushed: true });
	radio.set(true);
	assert.equal(sound.settings.hushed, false, 'switching the radio on (the radiogram) lifts the hush, so it is heard');
	radio.set(false);
	sound.set({ hushed: true });
	radio.set(false);
	assert.equal(sound.settings.hushed, true, 'switching it off leaves the hush alone');
	localStorage.removeItem(SOUND_KEY);
});

test('the sound popover: a Radio row with a level and an On switch, and what it is playing', async () => {
	localStorage.removeItem(SOUND_KEY);
	const { sound } = engine();
	const radio = createRadio(sound, [LONG]);
	const { button, panel } = createSoundPanel(sound, radio);
	win.document.body.append(button as never, panel as never);
	const labels = Array.from(panel.querySelectorAll('input[type=checkbox]')).map((b) => (b as unknown as HTMLElement).getAttribute('aria-label'));
	assert.deepEqual(labels, ['Mute ambient', 'Mute effects', 'Radio on']);
	const onAir = panel.querySelector('.p67-sound-onair') as unknown as HTMLElement;
	assert.equal(onAir.hidden, true, 'nothing to say while off');
	const box = panel.querySelector('[aria-label="Radio on"]') as unknown as HTMLInputElement;
	box.checked = true;
	box.dispatchEvent(new win.Event('change') as unknown as Event);
	assert.equal(radio.on, true);
	assert.equal(onAir.hidden, false);
	assert.equal(onAir.textContent, 'Tuning in…');
	radio.set(false);
	assert.equal(box.checked, false, 'switched off elsewhere (the radiogram), the box follows');
	// Ambient and effects silenced, the radio on: the speaker is not shown as off.
	sound.set({ ambientMuted: true, effectsMuted: true });
	radio.set(true);
	assert.doesNotMatch(button.title, /Sound is off/);
	radio.set(false);
	assert.match(button.title, /Sound is off/);
	const level = panel.querySelector('#p67-sound-radio') as unknown as HTMLInputElement;
	level.value = '20';
	level.dispatchEvent(new win.Event('input') as unknown as Event);
	assert.equal(sound.settings.radio, 0.2);
	localStorage.removeItem(SOUND_KEY);
});

test('the radio: six pips on the hour while it plays, the music dipped under them, once an hour, and none while it is off', async () => {
	localStorage.removeItem(SOUND_KEY);
	// Hours on the computer's own clock: in a time zone half an hour off UTC, UTC's hours are wrong.
	const local = (h: number): number => new Date(2026, 9, 1, h, 0, 0, 0).getTime();
	assert.equal(nextHour(local(5) - 3_000), local(5));
	assert.equal(nextHour(local(5)), local(5), 'exactly on the hour, that hour');
	assert.equal(nextHour(local(5) + 1), local(6));
	const H7 = local(7);
	let wall = H7 - 6_000;
	const { sound, gesture } = engine();
	const radio = createRadio(sound, [LONG], Math.random, () => wall);
	const ctx = await gesture();
	await wait(300);
	assert.ok(!ctx.gains.some((g) => g.calls.some(([m, v]) => m === 'setTargetAtTime' && v === 0.06)), 'nothing while the radio is off');
	radio.set(true);
	await wait(300);
	const at = (H7 - wall) / 1000;
	for (const s of PIPS) assert.ok(ctx.starts.some((t) => Math.abs(t - (at + s)) < 1e-6), `a pip at ${s} s`);
	assert.ok(ctx.gains.some((g) => g.calls.some(([m, v]) => m === 'setTargetAtTime' && v === 0.06)), 'the music dips');
	const n = ctx.starts.filter((t) => Math.abs(t - at) < 1e-6).length;
	await wait(300);
	assert.equal(ctx.starts.filter((t) => Math.abs(t - at) < 1e-6).length, n, 'scheduled once');
	wall = H7 + 600;
	await wait(300);
	assert.equal(ctx.starts.filter((t) => t > at + 1 && t < at + 10 && ctx.starts.filter((u) => u === t).length > 1).length, 0, 'nothing more until the next hour');
	radio.set(false);
	localStorage.removeItem(SOUND_KEY);
});
