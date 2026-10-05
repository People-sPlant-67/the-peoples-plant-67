/**
 * The radiogram on the stage: its dial glows while it is on, flickers with each pip of the time
 * signal on the hour, and a note drifts up now and then while it can be heard.
 * Clicking it opens the sound panel (scenery.ts).
 */
import { Container, Sprite, Texture } from 'pixi.js';
import { toCanvas, project } from '../art/render';
import type { Scene } from '../art/scene';
import { RADIO, radioLit } from '../world/zones';
import { bitmapCanvas } from './dom';
import type { Radio } from './radio';
import type { Stage } from './stage';

/** The prop's id in the world. */
export const RADIO_PROP = 'dir-radio';

/** A quaver in gold with a dark outline, so it reads against the brick. */
const NOTE = ['..o..', '.oGo.', '.oGGo', '.oGoG', 'ooGo.', 'oGGo.', 'oGGo.', '.oo..'].map((r) => [...r].map((ch) => (ch === 'G' ? '#e0b92e' : ch === 'o' ? '#2a1a0d' : null)));
/** Seconds a note takes to rise and fade, and between notes. */
const NOTE_LIFE = 2.4, NOTE_EVERY = 1.3;

export interface RadioSet {
	/**
	 * Move the notes along.
	 *
	 * @param dt Milliseconds since the last frame.
	 */
	tick(dt: number): void;
}

/**
 * Put the radiogram's life on the stage.
 *
 * @param stage Stage.
 * @param scene Scene (for the prop's pixels).
 * @param radio Radio.
 * @returns Radio set.
 */
export function createRadioSet(stage: Stage, scene: Scene, radio: Radio): RadioSet {
	const prop = scene.props.find((p) => p.id === RADIO_PROP);
	const sprite = stage.props.get(RADIO_PROP);
	if (!prop || !sprite) return { tick: () => {} };
	const off = sprite.texture;
	const lit = Texture.from(toCanvas({ ...prop.sprite, rgba: radioLit(prop.sprite) }));
	/** Light the dial while the radio is on. */
	const face = (): void => { sprite.texture = radio.on ? lit : off; };
	radio.onChange(face);
	face();
	/** Time left with the dial dark for a pip (seconds). */
	let dark = 0;
	radio.onPip((last) => { dark = last ? 0.45 : 0.12; });

	const noteTex = Texture.from(bitmapCanvas(NOTE, 1));
	const notes = new Container();
	stage.bubbles.addChild(notes);
	const [tx, ty] = project(scene.base, [RADIO[0], RADIO[1], 44]);
	let wait = 0, side = 1;
	const live: { s: Sprite; age: number; side: number }[] = [];

	return {
		tick(dt) {
			const s = dt / 1000;
			if (dark > 0) {
				dark -= s;
				sprite.texture = dark > 0 ? off : radio.on ? lit : off;
			}
			wait -= s;
			if (radio.audible && radio.playing && wait <= 0) {
				wait = NOTE_EVERY;
				side = -side;
				const n = new Sprite(noteTex);
				notes.addChild(n);
				live.push({ s: n, age: 0, side });
			}
			for (let k = live.length - 1; k >= 0; k--) {
				const n = live[k];
				n.age += s;
				if (n.age >= NOTE_LIFE) { n.s.destroy(); live.splice(k, 1); continue; }
				const f = n.age / NOTE_LIFE;
				// Whole pixels, like everything else in the plant.
				n.s.position.set(Math.round(tx - 2 + n.side * (3 + 4 * f) + Math.sin(n.age * 3) * 1.5), Math.round(ty - 3 - 20 * f));
				n.s.alpha = f < 0.7 ? 1 : (1 - f) / 0.3;
			}
		},
	};
}
