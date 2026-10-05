/**
 * The plant's scenes, as step lists for the director (scenes.ts):
 *
 * - arrival: the doors open, the train pulls in, the new comrade steps off and walks to the
 *   Recruitment desk. A hire still awaiting approval waits there until you stamp it; a refused
 *   hire boards the next train out.
 * - departure: someone who left the org quietly walks to the platform and boards the train.
 * - trial: a termination the plant did not stage (made in the dashboard, or while the plant was
 *   closed): the accused is marched to the dock, ВИНОВЕН falls, and they are airbrushed.
 * - tribunal: a pending referral. The accused waits in the dock, the Company Lead on the bench
 *   and the Director beside them, until you give the verdict.
 *
 * Pure: effects are named for the app to draw. Tested in tests/cockpit-scenes.test.ts.
 */
import type { World } from '../world/types';
import type { Scene, Step } from './scenes';
import { ARRIVE_MS, DOORS_MS, LEAVE_MS } from './trainyard';

/** How long each effect holds the scene, ms. */
export const FX_MS = {
	trainIn: DOORS_MS + ARRIVE_MS + 100,
	trainOut: LEAVE_MS + DOORS_MS + 100,
	stamp: 1_300,
	airbrush: 1_500,
	photo: 2_800,
};

/** The verdict as the tribunal scene sees it. */
export type Verdict = 'guilty' | 'pardoned' | null;

/**
 * Board the train and go: open the doors, bring the train in, hide the passenger, send it off.
 *
 * @param id Passenger.
 * @returns Steps.
 */
function board(id: string): Step[] {
	return [
		{ do: 'fx', name: 'trainIn', ms: FX_MS.trainIn },
		{ do: 'hide', id },
		{ do: 'fx', name: 'trainOut', ms: FX_MS.trainOut },
	];
}

/**
 * Stamp and airbrush someone: ВИНОВЕН, fade, and their face scratched out of the photo.
 *
 * @param id The condemned.
 * @param name Their name, for the photo.
 * @returns Steps.
 */
function airbrush(id: string, name: string): Step[] {
	return [
		{ do: 'fx', name: 'stamp', args: { id, word: 'ВИНОВЕН', tone: 'red' }, ms: FX_MS.stamp },
		{ do: 'fx', name: 'airbrush', args: { id }, ms: FX_MS.airbrush },
		{ do: 'hide', id },
		{ do: 'fx', name: 'photo', args: { name }, ms: FX_MS.photo },
	];
}

/**
 * A new comrade arrives by train.
 *
 * @param world World (platform and desk).
 * @param id The newcomer.
 * @param name Their name.
 * @param pending True while their hire still awaits the board.
 * @param gone True once they have left the roster (a refused hire).
 * @returns Scene.
 */
export function arrival(world: World, id: string, name: string, pending: () => boolean, gone: () => boolean): Scene {
	const desk = world.marks.desk;
	return {
		id: `arr:${id}`, kind: 'arrival', cast: [id], uses: ['train'], ceremony: true,
		summary: `${name} joined the plant.`, who: name,
		steps: [
			{ do: 'hide', id },
			{ do: 'fx', name: 'trainIn', ms: FX_MS.trainIn },
			{ do: 'place', id, pos: world.spawn },
			{ do: 'show', id },
			{ do: 'walk', id, to: desk.pos },
			{ do: 'fx', name: 'trainOut', ms: FX_MS.trainOut },
			{ do: 'drop', use: 'train' },
			{ do: 'arrive', ids: [id] },
			{ do: 'pose', id, anim: 'idle', dir: desk.dir },
			{ do: 'until', test: () => !pending() || gone() },
			{
				do: 'branch',
				pick: () => (gone()
					? [{ do: 'fx', name: 'stamp', args: { id, word: 'ОТКАЗАНО', tone: 'red' }, ms: FX_MS.stamp }, { do: 'walk', id, to: world.spawn }, { do: 'arrive', ids: [id] }, ...board(id)]
					: [{ do: 'fx', name: 'stamp', args: { id, word: 'ОДОБРЕНО', tone: 'green' }, ms: FX_MS.stamp }]),
			},
		],
	};
}

/**
 * Someone leaves quietly on the train (deleted, or gone for any reason but termination).
 *
 * @param world World.
 * @param id The leaver.
 * @param name Their name.
 * @returns Scene; its id matches the hold taken when they left the roster.
 */
export function departure(world: World, id: string, name: string): Scene {
	return {
		id: `dep:${id}`, kind: 'departure', cast: [id], uses: ['train'], ceremony: true,
		summary: `${name} left the plant.`, who: name,
		steps: [
			{ do: 'walk', id, to: world.spawn },
			{ do: 'arrive', ids: [id] },
			{ do: 'pose', id, anim: 'idle', dir: 'SW' },
			...board(id),
		],
	};
}

/**
 * A termination the plant did not stage: a short trial and the airbrush.
 *
 * @param world World.
 * @param id The condemned.
 * @param name Their name.
 * @returns Scene; its id matches the hold taken when they left the roster.
 */
export function trial(world: World, id: string, name: string): Scene {
	const dock = world.marks.dock;
	return {
		id: `dep:${id}`, kind: 'trial', cast: [id], uses: ['court'], ceremony: true,
		summary: `${name} was tried and airbrushed from the record.`, who: name,
		steps: [
			{ do: 'walk', id, to: dock.pos },
			{ do: 'arrive', ids: [id] },
			{ do: 'pose', id, anim: 'idle', dir: dock.dir },
			{ do: 'wait', ms: 700 },
			...airbrush(id, name),
		],
	};
}

/** Who sits in court besides the accused (either may be missing), decided when the case is opened. */
export interface Bench { judge: string | null; prosecutor: string | null }

/**
 * A live tribunal. While the referral waits, only the accused is held: they wait in the Palace
 * of Culture with a "!", and everyone else keeps working. When the owner opens the case, the court
 * is claimed and assembles (the Company Lead on the bench, the Director beside the dock). The
 * verdict then plays out. If the accused leaves the roster first (terminated from the dashboard),
 * they are tried and airbrushed anyway; if the referral is withdrawn, the court dissolves.
 *
 * @param world World.
 * @param approvalId The referral.
 * @param accused The accused.
 * @param name Their name.
 * @param bench Who sits in court, asked when the case is opened.
 * @param opened True once the owner has opened the case.
 * @param verdict The verdict once given and carried out.
 * @param pending True while the referral is still open (or being decided here).
 * @param gone True once the accused has left the roster.
 * @returns Scene.
 */
export function tribunal(world: World, approvalId: string, accused: string, name: string, bench: () => Bench, opened: () => boolean, verdict: () => Verdict, pending: () => boolean, gone: () => boolean): Scene {
	const { dock, bench: seat, benchStep, prosecutor, waiting } = world.marks;
	let judge: string | null = null;
	let summoned: string[] = [];

	/** The judge steps down from the stage. */
	const stepDown = (): Step[] => (judge ? [{ do: 'place', id: judge, pos: benchStep.pos }] : []);

	/**
	 * How it ends, once something has happened.
	 *
	 * @returns Steps.
	 */
	const ending = (): Step[] => {
		const v = verdict();
		if (v === 'pardoned') return [{ do: 'fx', name: 'stamp', args: { id: accused, word: 'ПОМИЛОВАН', tone: 'green' }, ms: FX_MS.stamp }, ...stepDown()];
		if (v === 'guilty' || gone()) {
			// Airbrushed, the court rises, and only the (hidden) accused stays held until Paperclip's
			// roster drops them, so they never walk back out.
			return [
				{ do: 'claim', use: 'court' },
				{ do: 'walk', id: accused, to: dock.pos },
				{ do: 'arrive', ids: [accused] },
				{ do: 'pose', id: accused, anim: 'idle', dir: dock.dir },
				...airbrush(accused, name),
				...stepDown(),
				...summoned.map((id): Step => ({ do: 'release', id })),
				{ do: 'drop', use: 'court' },
				{ do: 'until', test: gone },
			];
		}
		return stepDown();
	};

	/**
	 * Wait in the Palace until something happens, then assemble the court or end.
	 *
	 * @returns Steps.
	 */
	const waitForCase = (): Step[] => [
		{ do: 'walk', id: accused, to: waiting.pos },
		{ do: 'arrive', ids: [accused] },
		{ do: 'pose', id: accused, anim: 'idle', dir: waiting.dir },
		{ do: 'until', test: () => opened() || verdict() !== null || !pending() || gone() },
		{ do: 'branch', pick: () => (!opened() || verdict() !== null || !pending() || gone() ? ending() : assemble()) },
	];

	/**
	 * The court assembles, then waits for the verdict; if the case is closed without one, the
	 * court rises and the accused goes back to waiting.
	 *
	 * @returns Steps.
	 */
	const assemble = (): Step[] => [
		{ do: 'claim', use: 'court' },
		{
			do: 'summon',
			ids: () => { const b = bench(); return [b.judge, b.prosecutor].filter((x): x is string => !!x && x !== accused); },
			then: (got) => {
				const b = bench();
				summoned = got;
				judge = b.judge && got.includes(b.judge) ? b.judge : null;
				const pros = b.prosecutor && got.includes(b.prosecutor) ? b.prosecutor : null;
				return [
					{ do: 'walk', id: accused, to: dock.pos },
					...(judge ? [{ do: 'walk', id: judge, to: benchStep.pos } as Step] : []),
					...(pros ? [{ do: 'walk', id: pros, to: prosecutor.pos } as Step] : []),
					{ do: 'arrive', ids: [accused, ...got] },
					...(judge ? [{ do: 'place', id: judge, pos: seat.pos } as Step, { do: 'pose', id: judge, anim: 'idle', dir: seat.dir } as Step] : []),
					...(pros ? [{ do: 'pose', id: pros, anim: 'idle', dir: prosecutor.dir } as Step] : []),
					{ do: 'pose', id: accused, anim: 'idle', dir: dock.dir },
					{ do: 'until', test: () => verdict() !== null || !pending() || gone() || !opened() },
					{
						do: 'branch',
						pick: () => {
							if (verdict() !== null || !pending() || gone()) return ending();
							// Closed without a verdict: the court rises and everyone goes back to work.
							const rise: Step[] = [...stepDown(), ...summoned.map((id): Step => ({ do: 'release', id })), { do: 'drop', use: 'court' }];
							summoned = [];
							judge = null;
							return [...rise, ...waitForCase()];
						},
					},
				];
			},
		},
	];

	return {
		id: `trib:${approvalId}`, kind: 'tribunal', cast: [accused], uses: [], ceremony: false,
		summary: `${name} awaits trial.`, who: name,
		steps: waitForCase(),
	};
}
