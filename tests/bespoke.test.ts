/**
 * Personas: each named member of the org is matched from the names and titles the live roster
 * uses (and plausible renames), gets that persona's outfit and home zone from the same record,
 * and everyone else keeps the bank outfit their id has always had and works in production.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALEXEI, type Outfit, colourName, describeOutfit, randomOutfit, seedOf } from '../src/art/outfits';
import { PERSONAS, companyLead, homeZone, outfitFor, personaOf } from '../src/live/personas';
import { MATERIALS, type MaterialName } from '../src/art/palette';

/** Representative [name, title] pairs per bespoke outfit id. */
const CASES: Record<string, [string, string | null][]> = {
	'bespoke-boss': [['Boris', 'Company Lead'], ['BOSS', null], ['Leonid', 'company lead'], ['The Boss', 'CEO']],
	'bespoke-plan': [['Pyotr', 'Delivery Lead'], ['COMRADE PLANNER', null], ['Someone', 'delivery lead, EMEA']],
	'bespoke-inspector': [['Grigori', 'Independent Reviewer'], ['Company critic', null], ['Anyone', 'Chief Inspector']],
	alexei: [['Alexei', 'Generalist Executor'], ['shock worker', null], ['Worker', 'generalist executor']],
	'bespoke-rep': [['The Commissar', 'Representative of the State'], ['Sergei', 'representative of the state'], ['the commissar', null]],
	'bespoke-enforcer': [['State Enforcer', 'Director of Operational Hygiene'], ['Lavrentiy', 'Director of Operational Hygiene'], ['ENFORCER', null]],
	'bespoke-unblocker': [['Expert Unblocker', null], ['Pyotr', 'Repair Brigade'], ['Unblocker', 'Expert'], ['Comrade Spanner', 'Expert Unblocker']],
	'bespoke-clerk': [['Summarizer', null], ['Summariser', 'Clerk'], ['Anna', 'Meeting summarizer']],
	'bespoke-seat': [['Chairman (Manual Seat)', null], ['manual seat', 'Paused']],
};

const byId = (id: string): Outfit => {
	const b = PERSONAS.find((x) => x.outfit.id === id);
	assert.ok(b, `no bespoke outfit with id ${id}`);
	return b.outfit;
};

test('every bespoke outfit has test cases, and every case names a real outfit', () => {
	assert.deepEqual(new Set(Object.keys(CASES)), new Set(PERSONAS.map((b) => b.outfit.id)));
});

for (const [id, cases] of Object.entries(CASES)) {
	test(`${id} is chosen for its persona's names and titles`, () => {
		for (const [name, title] of cases) {
			assert.equal(outfitFor({ id: `agent-${name}`, name, title }), byId(id), `${name} / ${title}`);
		}
	});
}

test('outfit and home zone always come from the same persona (the tables cannot drift apart)', () => {
	for (const [id, cases] of Object.entries(CASES)) {
		const persona = PERSONAS.find((p) => p.outfit.id === id)!;
		for (const [name, title] of cases) {
			assert.equal(personaOf({ name, title }), persona, `${name} / ${title}`);
			assert.equal(homeZone({ name, title }), persona.home, `${name} / ${title}`);
		}
	}
	// The drift the review found: these once got a bespoke outfit but the default zone.
	assert.equal(homeZone({ name: 'Summariser', title: null }), 'planRoom');
	assert.equal(homeZone({ name: 'x', title: 'Chief Inspector' }), 'inspectorate');
	assert.equal(homeZone({ name: 'Pyotr', title: 'Repair Brigade' }), 'repair');
	// A role alone is enough for both, too.
	const byRole = { id: 'r', name: 'x', title: null, role: 'Delivery Lead' };
	assert.equal(outfitFor(byRole).id, 'bespoke-plan');
	assert.equal(homeZone(byRole), 'planRoom');
});

test('persona ids are unique', () => {
	assert.equal(new Set(PERSONAS.map((p) => p.id)).size, PERSONAS.length);
});

test('the Generalist Executor is exactly Alexei', () => {
	assert.equal(outfitFor({ id: 'x', name: 'Alexei', title: 'Generalist Executor' }), ALEXEI);
});

test('the State Enforcer is not mistaken for the Commissar, though both titles mention the State', () => {
	assert.equal(outfitFor({ id: 'a', name: 'Enforcer', title: 'Representative of the State' }).id, 'bespoke-enforcer');
	assert.equal(outfitFor({ id: 'b', name: 'Ivan', title: 'Head of State Planning' }).id, 'seed-' + seedOf('b'));
});

test('unknown agents keep the bank outfit their id gives them', () => {
	for (const [id, name, title] of [
		['3f2b9c1e-7a4d-4e8b-9c02-5d6e1f0a8b37', 'Content Creator', 'Writer'],
		['seo-specialist', 'SEO Specialist', null],
		['c1', 'Leadbelly', 'Lead Singer'],
	] as [string, string, string | null][]) {
		assert.deepEqual(outfitFor({ id, name, title }), randomOutfit(seedOf(id)));
	}
});

test('bespoke outfits are all different from each other, in id, label and look', () => {
	const outfits = PERSONAS.map((b) => b.outfit);
	assert.equal(new Set(outfits.map((o) => o.id)).size, outfits.length);
	assert.equal(new Set(outfits.map((o) => o.label)).size, outfits.length);
	// What reads at 1x: headwear and its colour, torso cut and colour, legs, face.
	const look = (o: Outfit) => [o.headwear, o.headwear === 'none' ? o.hair : o.hatMat, o.torso, o.torsoMat, o.legsMat, o.face];
	for (let i = 0; i < outfits.length; i++) {
		for (let j = i + 1; j < outfits.length; j++) {
			const a = look(outfits[i]), b = look(outfits[j]);
			const diff = a.filter((v, k) => v !== b[k]).length;
			assert.ok(diff >= 2, `${outfits[i].label} and ${outfits[j].label} differ in only ${diff} visible slot(s)`);
		}
	}
});

test('each bespoke outfit is described as a plain-English sentence', () => {
	for (const { outfit } of PERSONAS) {
		const s = describeOutfit(outfit);
		assert.ok(s.startsWith(`${outfit.label} wears `) || s.startsWith(`${outfit.label}, wears `), s);
		assert.match(s, /^[A-Z].*\.$/, s);
		assert.doesNotMatch(s, /[a-z][A-Z]/, `internal camelCase name leaked: ${s}`);
		assert.doesNotMatch(s, /\b(kepka|telogreika|kosynka|undefined|null)\b/, s);
		assert.doesNotMatch(s, /\ba [aeiou]/i, `wrong article: ${s}`);
	}
});

test('every material a bespoke outfit uses exists and has a colour word', () => {
	for (const { outfit: o } of PERSONAS) {
		const mats: MaterialName[] = [o.skin, o.hair, o.hatMat, o.torsoMat, o.shirtMat, o.legsMat, ...(o.scarf ? [o.scarf] : [])];
		for (const m of mats) assert.ok(m in MATERIALS, `${o.id} uses unknown material ${m}`);
		for (const m of [o.hair, o.torsoMat, o.legsMat, ...(o.headwear === 'none' ? [] : [o.hatMat])]) assert.doesNotThrow(() => colourName(m), `${o.id}: ${m}`);
	}
});

test('the Company Lead for the cc: the ceo role first, then the top of the chain, then the persona', () => {
	const a = (id: string, name: string, title: string | null, role: string | null = null, reportsTo: string | null = 'x') => ({ id, name, title, role, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo, urlKey: null });
	const assistant = a('1', 'Aide', 'Assistant to the Company Lead');
	const lead = a('2', 'Boris', 'Company Lead', null, null);
	const ceo = a('3', 'Zed', 'Chief', 'CEO', null);
	assert.equal(companyLead([assistant, lead])?.id, '2');
	assert.equal(companyLead([assistant, lead, ceo])?.id, '3');
	assert.equal(companyLead([assistant])?.id, '1');
	assert.equal(companyLead([a('4', 'Alexei', 'Generalist Executor')]), undefined);
});
