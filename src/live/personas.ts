/**
 * The named members of the org, in one place: the words that pick each one out of the live
 * roster, where they work, and what they wear. Placement (home zone) and the outfit both read
 * this list, so the two can never disagree about who someone is.
 *
 * Patterns are tested against "<name> | <title> | <role>", case-insensitively, and the first
 * persona with any matching pattern wins. The org renames agents now and then, so each persona
 * matches several distinctive words rather than one exact string: a rename that keeps either
 * the name or the title keeps the persona. Anyone unmatched works on the Production Floor in
 * the bank outfit their id has always had.
 */
import { type Outfit, ALEXEI, randomOutfit, seedOf } from '../art/outfits';
import type { ZoneId } from '../world/types';
import type { AgentState } from './types';

export interface Persona {
	/** Stable id, used by the tests and by the chat (to find the Company Lead). */
	id: string;
	/** Regexes over "<name> | <title> | <role>"; any one matching is enough. */
	patterns: RegExp[];
	/** Where they work when active. 'roam' means no fixed station. */
	home: ZoneId | 'roam';
	outfit: Outfit;
}

/** The owner's own manual seat, by name. The board stamps key their lock on this too. */
export const SEAT_NAME = /\bmanual seat\b/i;

/**
 * Every persona, first match wins. Each outfit differs from every other in at least two of
 * headwear, torso cut, main colour and face, so no two can be confused at 1x.
 *
 * Order matters where titles share words: both "State Enforcer" and "Representative of the
 * State" contain "state", and the Enforcer comes first so a bare "state" never decides it.
 */
export const PERSONAS: readonly Persona[] = [
	{
		// Two black-leather authority figures: the Enforcer is told apart from the Boss by an
		// NKVD-blue cap crown (the peaked cap's band is always red), fair hair and no moustache.
		id: 'enforcer',
		patterns: [/operational hygiene/i, /\benforcer\b/i],
		home: 'hygiene',
		outfit: {
			id: 'bespoke-enforcer', label: 'State Enforcer', skin: 'skinA', hair: 'hairFlax',
			headwear: 'peaked', hatMat: 'navyWork', torso: 'trench', torsoMat: 'blackLeather', shirtMat: 'cream',
			legsMat: 'navyWork', face: 'clean', scarf: null, sleeves: 'long',
		},
	},
	{
		// The spy: a beige trench and dark flat cap is the silhouette everyone knows. The Commissar
		// wanders the whole plant rather than holding a station.
		id: 'rep',
		patterns: [/representative of the state/i, /\bthe commissar\b/i],
		home: 'roam',
		outfit: {
			id: 'bespoke-rep', label: 'The Commissar', skin: 'skinB', hair: 'hairDark',
			headwear: 'kepka', hatMat: 'charcoal', torso: 'trench', torsoMat: 'sand', shirtMat: 'cream',
			legsMat: 'charcoal', face: 'moustache', scarf: null, sleeves: 'long',
		},
	},
	{
		id: 'boss',
		patterns: [/company lead/i, /\bboss\b/i, /\bceo\b/i, /chief executive/i],
		home: 'directorate',
		outfit: {
			id: 'bespoke-boss', label: 'Company Lead', skin: 'skinB', hair: 'hairBlack',
			headwear: 'peaked', hatMat: 'blackLeather', torso: 'trench', torsoMat: 'blackLeather', shirtMat: 'cream',
			legsMat: 'charcoal', face: 'moustache', scarf: null, sleeves: 'long',
		},
	},
	{
		id: 'plan',
		patterns: [/delivery lead/i, /\bplanner\b/i],
		home: 'planRoom',
		outfit: {
			id: 'bespoke-plan', label: 'Chief Planner', skin: 'skinC', hair: 'hairBrown',
			headwear: 'peaked', hatMat: 'oliveDrab', torso: 'tunic', torsoMat: 'khaki', shirtMat: 'cream',
			legsMat: 'navyWork', face: 'spectacles', scarf: null, sleeves: 'long',
		},
	},
	{
		id: 'inspector',
		patterns: [/\breviewer\b/i, /\bcritic\b/i, /\bauditor\b/i, /\binspector/i],
		home: 'inspectorate',
		outfit: {
			id: 'bespoke-inspector', label: 'The Inspector', skin: 'skinA', hair: 'hairGrey',
			headwear: 'none', hatMat: 'hairGrey', torso: 'trench', torsoMat: 'greyWool', shirtMat: 'cream',
			legsMat: 'charcoal', face: 'spectacles', scarf: null, sleeves: 'long',
		},
	},
	{
		id: 'executor',
		patterns: [/\bexecutor\b/i, /shock worker/i, /\balexei\b/i],
		home: 'production',
		outfit: ALEXEI,
	},
	{
		id: 'unblocker',
		patterns: [/unblocker/i, /repair brigade/i, /\brecovery\b/i],
		home: 'repair',
		outfit: {
			id: 'bespoke-unblocker', label: 'Repair Brigadier', skin: 'skinC', hair: 'hairRed',
			headwear: 'ushanka', hatMat: 'fur', torso: 'overalls', torsoMat: 'rust', shirtMat: 'cream',
			legsMat: 'rust', face: 'beard', scarf: null, sleeves: 'rolled',
		},
	},
	{
		id: 'clerk',
		patterns: [/summari[sz]/i, /\bclerk\b/i],
		home: 'planRoom',
		outfit: {
			id: 'bespoke-clerk', label: 'The Clerk', skin: 'skinD', hair: 'hairBlond',
			headwear: 'none', hatMat: 'hairBlond', torso: 'tunic', torsoMat: 'fadedBlue', shirtMat: 'cream',
			legsMat: 'charcoal', face: 'spectacles', scarf: null, sleeves: 'long',
		},
	},
	{
		// The owner's own seat, paused most of the time: deliberately plain, no rank and no badge. Bare
		// head rather than a kosynka: a pale headscarf reads as white hair at 1x.
		id: 'seat',
		patterns: [SEAT_NAME],
		home: 'production',
		outfit: {
			id: 'bespoke-seat', label: 'Reserve Comrade', skin: 'skinA', hair: 'hairBrown',
			headwear: 'none', hatMat: 'hairBrown', torso: 'tunic', torsoMat: 'charcoal', shirtMat: 'cream',
			legsMat: 'sand', face: 'clean', scarf: null, sleeves: 'long',
		},
	},
];

/** The fields a persona is recognised by. */
export type Who = Pick<AgentState, 'name' | 'title'> & { role?: string | null };

/**
 * The persona an agent matches, if any.
 *
 * @param agent Name, title and (optionally) role.
 * @returns Persona, or undefined for an agent with no persona.
 */
export function personaOf(agent: Who): Persona | undefined {
	const text = [agent.name, agent.title ?? '', agent.role ?? ''].join(' | ');
	return PERSONAS.find((p) => p.patterns.some((re) => re.test(text)));
}

/**
 * The zone an agent works in when active.
 *
 * @param agent Name, title and role.
 * @returns Zone id, or 'roam' for comrades with no fixed station.
 */
export function homeZone(agent: Who): ZoneId | 'roam' {
	return personaOf(agent)?.home ?? 'production';
}

/**
 * The Company Lead, for the chat's cc. Paperclip's own role wins ("ceo"); then the top of the
 * reporting chain if they match the Company Lead persona; then anyone who matches it. A name
 * pattern alone is the last resort, since "Assistant to the Company Lead" matches it too.
 *
 * @param agents The roster.
 * @returns The Lead, or undefined when nobody fits.
 */
export function companyLead(agents: AgentState[]): AgentState | undefined {
	const byName = [...agents].sort((a, b) => a.name.localeCompare(b.name));
	const boss = (a: AgentState): boolean => personaOf(a)?.id === 'boss';
	return byName.find((a) => a.role?.toLowerCase() === 'ceo')
		?? byName.find((a) => boss(a) && !a.reportsTo)
		?? byName.find(boss);
}

/**
 * Dress an agent: their persona's outfit, otherwise the bank outfit their id has always had.
 *
 * @param agent Id, name, title and (optionally) role.
 * @returns Outfit.
 */
export function outfitFor(agent: Who & { id: string }): Outfit {
	return personaOf(agent)?.outfit ?? randomOutfit(seedOf(agent.id));
}
