/**
 * Sound: the cues fire the right voices at the right moments, against a fake
 * sink and clock: one bell per new approval and one for the lot on opening, spaced-out,
 * zoom-scaled clangs for on-screen strikes only (on the ambient bus), the page-turn rustle, and
 * pops that skip a "!" the bell already announced. Plus the stored settings, the audio unlock,
 * and the speaker popover.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { CHESS_MOVE_FRAME, PAGE_TURN_FRAME } from '../src/art/avatar';
import { BELL_COVERS_MS, BREAK_GAP_MS, CLANG_GAP_MS, POP_GAP_MS, QUIET_START_MS, STRIKE_FRAME, type PlayOpts, type Voice, createCues } from '../src/cockpit/sound-cues';

const win = new Window();
Object.assign(globalThis, { document: win.document, localStorage: win.localStorage, requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16) as unknown as number, cancelAnimationFrame: (h: number) => clearTimeout(h) });
const { DEFAULT_SOUND, SOUND_KEY, createSound, loadSound } = await import('../src/cockpit/sound');
const { STAMP_EVENT, createStamp } = await import('../src/cockpit/stamp');

/**
 * Cues over a recording sink and a hand-driven clock.
 *
 * @returns Cues, what was played, and the clock.
 */
function setup() {
	const played: { v: Voice; o?: PlayOpts }[] = [];
	const clock = { t: 0 };
	const cues = createCues({ play: (v, o) => played.push({ v, o }) }, () => clock.t);
	return { cues, played, clock, voices: () => played.map((p) => p.v) };
}

test('cues: stamps thud, verdicts gavel, sends clack, trains bring doors then whistle then steam, airbrushing hisses', () => {
	const { cues, played, voices } = setup();
	cues.stamp(); cues.verdict(); cues.sent(); cues.airbrush(); cues.train();
	assert.deepEqual(voices(), ['thud', 'gavel', 'clack', 'airbrush', 'doors', 'whistle', 'steam']);
	assert.ok((played[5].o?.delay ?? 0) < (played[6].o?.delay ?? 0), 'the whistle before the steam');
});

test('cues: the bell rings once for everything waiting on opening, then once per new approval', () => {
	const { cues, voices, played } = setup();
	const ids = (...xs: string[]) => xs.map((id) => ({ id, holder: null }));
	cues.approvals(ids('a', 'b', 'c'));
	assert.deepEqual(voices(), ['bell']);
	cues.approvals(ids('a', 'b', 'c'));
	assert.deepEqual(voices(), ['bell'], 'nothing new, no bell');
	cues.approvals(ids('a', 'b', 'c', 'd', 'e'));
	assert.deepEqual(voices(), ['bell', 'bell', 'bell']);
	assert.ok((played[2].o?.delay ?? 0) > (played[1].o?.delay ?? 0), 'spaced out, not on top of each other');
	cues.approvals(ids('a'));
	cues.approvals(ids('a', 'b'));
	assert.equal(voices().length, 4, 'one that comes back after leaving rings again');
	const quiet = setup();
	quiet.cues.approvals([]);
	quiet.cues.approvals(ids('x'));
	assert.deepEqual(quiet.voices(), ['bell'], 'opening with nothing waiting is silent; the first arrival rings');
});

test('cues: hammer strikes clang on screen only, spaced out, quieter zoomed out, on the ambient bus', () => {
	const { cues, played, clock } = setup();
	const strike = (id: string, x: number | null) => ({ id, anim: 'work', frame: STRIKE_FRAME, screenX: x });
	const before = (id: string) => ({ id, anim: 'work', frame: STRIKE_FRAME - 1, screenX: 0.5 });
	cues.frame([before('a'), before('b'), before('off')], 3);
	cues.frame([strike('off', null)], 3);
	assert.equal(played.length, 0, 'off screen, silent');
	cues.frame([strike('a', 0.5), strike('b', 0.5)], 3);
	assert.equal(played.length, 1, 'two hammers on the same beat make one clang');
	assert.equal(played[0].o?.ambient, true, 'background texture: muting the effects (and the bell) is never needed to stop it');
	clock.t += CLANG_GAP_MS - 1;
	cues.frame([before('a')], 3);
	cues.frame([strike('a', 0.5)], 3);
	assert.equal(played.length, 1, 'and never more than one every CLANG_GAP_MS');
	clock.t += 2;
	cues.frame([before('a')], 1);
	cues.frame([strike('a', 0)], 1);
	assert.equal(played.length, 2);
	assert.ok(played[1].o!.gain! < played[0].o!.gain!, 'quieter zoomed out');
	assert.ok(played[1].o!.pan! < 0, 'panned to the left edge');
});

test('cues: The Commissar turning a page rustles, only on screen', () => {
	const { cues, voices } = setup();
	cues.frame([{ id: 'rep', anim: 'lurk', frame: 0, screenX: 0.5 }], 2);
	cues.frame([{ id: 'rep', anim: 'lurk', frame: PAGE_TURN_FRAME, screenX: 0.5 }], 2);
	cues.frame([{ id: 'rep', anim: 'lurk', frame: 0, screenX: null }], 2);
	cues.frame([{ id: 'rep', anim: 'lurk', frame: PAGE_TURN_FRAME, screenX: null }], 2);
	assert.deepEqual(voices(), ['rustle']);
});

test('cues: bubbles pop on screen, spaced out, quiet at first, and a "!" the bell just rang for is skipped', () => {
	const { cues, voices, clock } = setup();
	cues.bubble('reply', 0.5, 'x');
	assert.deepEqual(voices(), [], 'quiet while the plant opens');
	clock.t = QUIET_START_MS + 1;
	cues.bubble('reply', 0.5, 'x');
	cues.bubble('reply', 0.5, 'x');
	assert.deepEqual(voices(), ['pop'], 'spaced out');
	clock.t += POP_GAP_MS + 1;
	cues.bubble('alert', null, 'x');
	assert.deepEqual(voices(), ['pop'], 'off screen, silent');
	cues.approvals([]);
	cues.approvals([{ id: 'new', holder: 'boris' }]);
	cues.bubble('alert', 0.3, 'boris');
	assert.deepEqual(voices(), ['pop', 'bell'], 'the bell already said it');
	cues.bubble('alert', 0.3, 'anna');
	assert.deepEqual(voices(), ['pop', 'bell', 'pop'], 'someone else\'s "!" still pops');
	clock.t += BELL_COVERS_MS + 1;
	cues.bubble('alert', 0.3, 'boris');
	assert.deepEqual(voices(), ['pop', 'bell', 'pop', 'pop']);
});

test('sound settings: defaults, clamped, junk ignored; nothing plays before the first gesture', () => {
	win.localStorage.removeItem(SOUND_KEY);
	assert.deepEqual(loadSound(), DEFAULT_SOUND);
	win.localStorage.setItem(SOUND_KEY, JSON.stringify({ ambient: 7, effects: 'loud', ambientMuted: true, effectsMuted: 'yes' }));
	assert.deepEqual(loadSound(), { ambient: 1, effects: DEFAULT_SOUND.effects, ambientMuted: true, effectsMuted: false, radio: DEFAULT_SOUND.radio, radioOn: false, hushed: false });
	win.localStorage.setItem(SOUND_KEY, JSON.stringify({ hushed: 'yes' }));
	assert.equal(loadSound().hushed, false, 'only a real true hushes');
	win.localStorage.setItem(SOUND_KEY, JSON.stringify({ hushed: true }));
	assert.equal(loadSound().hushed, true, 'the one-click mute is kept between visits');
	assert.equal(DEFAULT_SOUND.radioOn, false, 'the radio is off until switched on');
	win.localStorage.setItem(SOUND_KEY, JSON.stringify({ radio: -3, radioOn: 'yes' }));
	assert.deepEqual([loadSound().radio, loadSound().radioOn], [0, false]);
	win.localStorage.setItem(SOUND_KEY, JSON.stringify({ radio: 0.8, radioOn: true }));
	assert.deepEqual([loadSound().radio, loadSound().radioOn], [0.8, false], 'the level is kept; the radio starts off every visit');
	win.localStorage.setItem(SOUND_KEY, '{not json');
	assert.deepEqual(loadSound(), DEFAULT_SOUND);
	const listeners: string[] = [];
	const s = createSound({ addEventListener: (type: string) => listeners.push(type), removeEventListener: () => {} } as never);
	assert.deepEqual(listeners.sort(), ['keydown', 'pointerdown', 'pointerup'], 'it waits for a gesture');
	assert.equal(s.unlocked, false);
	s.play('bell');
	s.set({ effects: 0.2 });
	assert.equal(loadSound().effects, 0.2, 'saved');
	win.localStorage.removeItem(SOUND_KEY);
});

test('a fired stamp decides first, then tells the cockpit to thud', async () => {
	const order: string[] = [];
	const box = win.document.createElement('div');
	box.addEventListener(STAMP_EVENT, () => order.push('thud'));
	const st = createStamp('ОДОБРЕНО', 'Approve: hold', 'green', () => order.push('fired'));
	box.append(st.el as never);
	st.el.dispatchEvent(new win.PointerEvent('pointerdown', { button: 0 }) as unknown as Event);
	await new Promise((r) => setTimeout(r, 1_150));
	assert.deepEqual(order, ['fired', 'thud']);
});

/**
 * A stand-in AudioContext: every node method returns a node that accepts anything, and the state
 * is set by hand, as Chrome would after a gesture it accepts or not.
 */
class FakeContext {
	static made: FakeContext[] = [];
	static allow = false;
	state = 'suspended';
	currentTime = 0;
	sampleRate = 8000;
	destination = {};
	voices = 0;
	private listeners: (() => void)[] = [];
	constructor() { FakeContext.made.push(this); }
	/** @returns A node that takes any call. */
	node(): unknown {
		const param = { value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} };
		const n: Record<string, unknown> = { gain: param, frequency: param, Q: param, pan: param, threshold: param, ratio: param, buffer: null, loop: false, type: '' };
		n.connect = (x: unknown) => x;
		n.start = () => { this.voices++; };
		n.stop = () => {};
		return n;
	}
	createGain() { return this.node(); }
	createOscillator() { return this.node(); }
	createBiquadFilter() { return this.node(); }
	createBufferSource() { return this.node(); }
	createDynamicsCompressor() { return this.node(); }
	createStereoPanner() { return this.node(); }
	createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
	addEventListener(_t: string, cb: () => void) { this.listeners.push(cb); }
	/** Tell listeners the state changed. */
	fire() { for (const cb of this.listeners) cb(); }
	/** @returns Resolves; runs only when this gesture is allowed. */
	async resume() { if (FakeContext.allow) { this.state = 'running'; for (const cb of this.listeners) cb(); } }
}

test('sound: a gesture that does not start audio leaves the plant listening for the next; a bell asked for meanwhile rings once it starts', async () => {
	const handlers = new Map<string, () => void>();
	const target = { addEventListener: (t: string, cb: () => void) => handlers.set(t, cb), removeEventListener: (t: string) => handlers.delete(t) };
	Object.assign(globalThis, { AudioContext: FakeContext });
	FakeContext.made = [];
	FakeContext.allow = false;
	const s = createSound(target as never);
	s.play('bell');
	handlers.get('keydown')!();
	await new Promise((r) => setTimeout(r, 5));
	assert.equal(s.unlocked, false, 'Chrome did not accept that one');
	assert.ok(handlers.has('pointerup'), 'still listening');
	const ctx = FakeContext.made[0];
	const before = ctx.voices;
	FakeContext.allow = true;
	handlers.get('pointerup')!();
	await new Promise((r) => setTimeout(r, 5));
	assert.equal(s.unlocked, true);
	assert.equal(handlers.size, 0, 'done listening');
	assert.equal(FakeContext.made.length, 1, 'one context, reused');
	assert.ok(ctx.voices > before, 'the held bell rang');
	// Suspended later (the system's audio changed): back to listening, and the next gesture restarts it.
	ctx.state = 'suspended';
	ctx.fire();
	assert.equal(s.unlocked, false);
	assert.ok(handlers.has('pointerdown'), 'listening again');
	handlers.get('pointerdown')!();
	await new Promise((r) => setTimeout(r, 5));
	assert.equal(s.unlocked, true);
	delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

test('the speaker hushes in one click and the radiogram opens the panel; Escape closes it, focus goes back, and the mutes say which is which', async () => {
	const { createSoundPanel } = await import('../src/cockpit/sound');
	// The panel places itself under the radiogram using the window's size.
	Object.assign(globalThis, { window: win });
	win.localStorage.removeItem(SOUND_KEY);
	const s = createSound({ addEventListener: () => {}, removeEventListener: () => {} } as never);
	const setting = win.document.createElement('label') as unknown as HTMLElement;
	setting.textContent = 'Edge scrolling';
	const { button, panel, toggle } = createSoundPanel(s, undefined, [setting]);
	win.document.body.append(button as never, panel as never);
	assert.equal(panel.querySelector('.p67-sound-head')?.textContent, 'Settings', 'the cockpit\'s settings have a heading of their own');
	assert.equal(button.dataset.icon, 'on');
	assert.ok(button.querySelector('svg'), 'a drawn speaker, not an emoji that differs between systems');
	assert.match(button.title, /Click to mute everything except the bell/);
	button.click();
	assert.equal(panel.hidden, true, 'the speaker itself never opens the popover');
	assert.equal(s.settings.hushed, true);
	assert.equal(loadSound().hushed, true, 'saved');
	assert.equal(button.dataset.icon, 'off');
	assert.equal(button.getAttribute('aria-pressed'), 'true');
	assert.match(button.title, /muted, except the bell for new approvals/);
	assert.equal((panel.querySelector('.p67-sound-hushed') as unknown as HTMLElement).hidden, false, 'the popover says why its levels are silent');
	s.set({ effectsMuted: true });
	button.click();
	button.click();
	assert.match(button.title, /bell for new approvals is silent too/, 'hushed with the effects muted says the bell is silent as well');
	button.click();
	assert.equal(s.settings.hushed, false);
	assert.equal(s.settings.effectsMuted, true, 'unhushing leaves the panel\'s own mutes as they were');
	assert.equal((panel.querySelector('.p67-sound-hushed') as unknown as HTMLElement).hidden, true);
	s.set({ effectsMuted: false });
	s.set({ ambient: 0, effects: 0 });
	button.click();
	assert.equal(s.settings.hushed, false, 'with every level at nothing, a hush would change nothing…');
	assert.equal(panel.hidden, false, '…so the speaker opens the levels instead');
	assert.match(button.title, /Sound is off\. Click to change the levels/);
	toggle({ left: 300, top: 200, right: 360, bottom: 260 }, null);
	assert.equal(panel.hidden, true, 'the radiogram clicked again closes it');
	s.set({ ambient: 0.3, effects: 0.6 });
	// From the keyboard: the invisible button over the radiogram.
	const opener = win.document.createElement('button') as unknown as HTMLButtonElement;
	win.document.body.append(opener as never);
	opener.focus();
	toggle({ left: 300, top: 200, right: 360, bottom: 260 }, opener);
	assert.equal(panel.hidden, false);
	assert.equal(panel.style.left, '376px', 'beside the radiogram, to its right, not over it');
	assert.ok(panel.contains(win.document.activeElement as never), 'focus goes into the panel');
	panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	assert.equal(panel.hidden, true);
	assert.equal(win.document.activeElement, opener, 'and comes back to the radiogram\'s button');
	// Closed by a press elsewhere (the pointer): focus is not pulled back to the radiogram.
	toggle({ left: 300, top: 200, right: 360, bottom: 260 }, opener);
	(win.document.body as unknown as HTMLElement).dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }) as unknown as Event);
	assert.equal(panel.hidden, true);
	assert.notEqual(win.document.activeElement, opener);
	toggle({ left: 300, top: 200, right: 360, bottom: 260 }, null);
	button.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
	assert.equal(panel.hidden, true, 'from the speaker too');
	opener.remove();
	const labels = Array.from(panel.querySelectorAll('input[type=checkbox]')).map((b) => (b as unknown as HTMLElement).getAttribute('aria-label'));
	assert.deepEqual(labels, ['Mute ambient', 'Mute effects']);
	const slider = panel.querySelector('#p67-sound-effects') as unknown as HTMLInputElement;
	slider.value = '0';
	slider.dispatchEvent(new win.Event('input') as unknown as Event);
	assert.match(button.title, /bell for new approvals is silent/, 'silencing the effects says the bell goes too');
	win.localStorage.removeItem(SOUND_KEY);
});

test('cues: breaks fizz, clack and snore on screen, on the ambient bus, quieter than the hammers, each kind spaced out', () => {
	const { cues, played, clock } = setup();
	const seen = (id: string, anim: string, frame: number, x: number | null = 0.5) => ({ id, anim, frame, screenX: x });
	cues.frame([seen('a', 'drink', 0), seen('b', 'chess', CHESS_MOVE_FRAME - 1), seen('c', 'doze', 3)], 2);
	cues.frame([seen('a', 'drink', 1), seen('b', 'chess', CHESS_MOVE_FRAME), seen('c', 'doze', 0)], 2);
	assert.deepEqual(played.map((p) => p.v), ['fizz', 'clack', 'snore']);
	assert.ok(played.every((p) => p.o?.ambient), 'ambient');
	cues.frame([seen('d', 'work', STRIKE_FRAME - 1)], 2);
	cues.frame([seen('d', 'work', STRIKE_FRAME)], 2);
	const clang = played.at(-1)!;
	assert.ok((played[0].o?.gain ?? 1) < (clang.o?.gain ?? 1), 'quieter than a hammer');
	clock.t += 1_000;
	cues.frame([seen('e', 'chess', CHESS_MOVE_FRAME - 1)], 2);
	cues.frame([seen('e', 'chess', CHESS_MOVE_FRAME)], 2);
	assert.equal(played.filter((p) => p.v === 'clack').length, 1, 'a second clack waits');
	clock.t += BREAK_GAP_MS;
	cues.frame([seen('e', 'chess', CHESS_MOVE_FRAME - 1)], 2);
	cues.frame([seen('e', 'chess', CHESS_MOVE_FRAME)], 2);
	assert.equal(played.filter((p) => p.v === 'clack').length, 2);
	cues.frame([seen('f', 'drink', 0, null)], 2);
	cues.frame([seen('f', 'drink', 1, null)], 2);
	assert.equal(played.filter((p) => p.v === 'fizz').length, 1, 'nothing off screen');
});

test('sound: the easter eggs\' voices (ding, snare, beep, huff, crackle) play on the effects bus, and not when effects are muted', async () => {
	const handlers = new Map<string, () => void>();
	const target = { addEventListener: (t: string, cb: () => void) => handlers.set(t, cb), removeEventListener: (t: string) => handlers.delete(t) };
	Object.assign(globalThis, { AudioContext: FakeContext });
	FakeContext.made = [];
	FakeContext.allow = true;
	const s = createSound(target as never);
	handlers.get('pointerup')!();
	await new Promise((r) => setTimeout(r, 5));
	const ctx = FakeContext.made[0];
	for (const v of ['ding', 'snare', 'beep', 'huff', 'crackle'] as const) {
		const before = ctx.voices;
		s.play(v, { pan: 0.3, gain: 0.5 });
		assert.ok(ctx.voices > before, `${v} sounds`);
	}
	s.set({ effectsMuted: true });
	const before = ctx.voices;
	s.play('snare');
	assert.equal(ctx.voices, before, 'muted');
	s.set({ effectsMuted: false });
	delete (globalThis as { AudioContext?: unknown }).AudioContext;
});
