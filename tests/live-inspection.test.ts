/**
 * The Ministry's inspection and the order that founds it: each of the five checks from what
 * Paperclip says, the threshold read from the ledger's first line, a failed read never taking
 * a founded Ministry down, the ledger and Lessons re-read by id once found, a missing routines
 * route left to the owner, and the order matching docs/ONBOARDING.md.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { FetchLike } from '../src/live/http';
import { type Evidence, type Inspection, LEDGER_TITLE, LESSONS_TITLE, ROUTINE_TITLE, inspect, judge, thresholdIn, verdict } from '../src/live/inspection';
import { MOCK_COMPANY_ID, mockFetch, mockSnapshots } from '../src/live/mock';
import { ceoPrompt, onboardingDoc } from '../src/live/onboarding';
import type { AgentState } from '../src/live/types';

const DIR = '22222222-2222-4333-8444-000000000005';
const OTHER = '22222222-2222-4333-8444-000000000006';
const LEDGER = '44444444-2222-4333-8444-000000000001';

/**
 * A roster entry.
 *
 * @param id Id.
 * @param name Name.
 * @param title Title.
 * @param status Status.
 * @returns Agent.
 */
const agent = (id: string, name: string, title: string | null = null, status = 'idle'): AgentState => ({ id, name, title, role: null, status, pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null });

/** Everything in place, Standard regime. */
const all = (): Evidence => ({
	agents: [agent(DIR, 'Comrade Mop', 'Director of Operational Hygiene'), agent(OTHER, 'Shock Worker No. 3')],
	routines: [{ title: ROUTINE_TITLE, assigneeAgentId: DIR, status: 'active' }],
	ledger: { id: LEDGER, title: LEDGER_TITLE, status: 'backlog', description: 'Tribunal threshold: 3 live strikes\n\n| agent |' },
	lessons: { id: 'm', title: LESSONS_TITLE, status: 'backlog' },
});
const KEYS = ['director', 'routine', 'ledger', 'threshold', 'lessons'] as const;

test('everything in place: five stamps, and the Ministry is founded', () => {
	const i = judge(all(), 3);
	for (const k of KEYS) assert.equal(i[k].state, 'ok', k);
	assert.equal(verdict(i, false), true);
});

test('nothing yet: every check is missing, with a sentence saying what it waits for', () => {
	const i = judge({ agents: [], routines: [], ledger: null, lessons: null }, 3);
	for (const k of KEYS) {
		assert.equal(i[k].state, 'missing', k);
		assert.match(i[k].note ?? '', /^[A-Z].*\.$/, k);
	}
	assert.equal(verdict(i, true), false);
});

test('a failed read keeps the last verdict; missing or wrong always un-founds', () => {
	const blip = judge({ ...all(), routines: undefined, ledger: undefined }, 3);
	assert.equal(blip.routine.state, 'unknown');
	assert.equal(blip.threshold.state, 'unknown');
	assert.equal(verdict(blip, true), true, 'a founded Ministry stays founded through a blip');
	assert.equal(verdict(blip, false), false, 'and an unfounded one stays unfounded');
	const gone: Inspection = { ...judge(all(), 3), lessons: { state: 'missing', note: null }, routine: { state: 'unknown', note: null } };
	assert.equal(verdict(gone, true), false);
});

test('the Director: two look-alikes is wrong, a terminated one does not count', () => {
	const two = { ...all(), agents: [...all().agents, agent(OTHER, 'Deputy', 'State Enforcer')] };
	assert.equal(judge(two, 3).director.state, 'wrong');
	assert.match(judge(two, 3).director.note!, /Comrade Mop, Deputy/);
	const gone = { ...all(), agents: [agent(DIR, 'Comrade Mop', 'Director of Operational Hygiene', 'terminated')] };
	assert.equal(judge(gone, 3).director.state, 'missing');
});

test("the routine: someone else's or switched off is wrong; an archived one does not count", () => {
	const r = (routines: Evidence['routines']) => judge({ ...all(), routines }, 3).routine.state;
	assert.equal(r([{ title: ROUTINE_TITLE, assigneeAgentId: OTHER, status: 'active' }]), 'wrong');
	assert.equal(r([{ title: ROUTINE_TITLE, assigneeAgentId: DIR, status: 'paused' }]), 'wrong');
	assert.equal(r([{ title: ROUTINE_TITLE, assigneeAgentId: DIR, status: 'archived' }]), 'missing');
	assert.equal(r([{ title: ROUTINE_TITLE, assigneeAgentId: DIR, status: 'paused' }, { title: ROUTINE_TITLE, assigneeAgentId: DIR, status: 'active' }]), 'ok');
	const none = judge({ ...all(), routines: null }, 3);
	assert.equal(none.routine.state, 'manual', 'no routines route: the owner checks it by hand');
	assert.equal(verdict(none, false), true, 'and the Ministry is still founded on the rest');
});

test("the threshold comes from the ledger's first line and must match the regime", () => {
	assert.equal(thresholdIn('Tribunal threshold: 5 live strikes'), 5);
	assert.equal(thresholdIn('\n  tribunal THRESHOLD:1 live strike'), 1, 'blank lines before it are skipped');
	assert.equal(thresholdIn('A table\nTribunal threshold: 3'), null, 'only the first line counts');
	assert.equal(thresholdIn(null), null);
	const wrong = judge(all(), 5).threshold;
	assert.equal(wrong.state, 'wrong');
	assert.match(wrong.note!, /says 3, but your regime says 5/);
	assert.equal(judge({ ...all(), ledger: { ...all().ledger!, description: 'Just a table' } }, 3).threshold.state, 'missing');
	assert.equal(judge({ ...all(), ledger: null }, 3).threshold.state, 'missing', 'no ledger, nothing to read');
});

test('inspect() against the mock: founded by default, not without the Ministry; the ids found are remembered', async () => {
	const roster = mockSnapshots(67).next().value.agents;
	const yes = await inspect(mockFetch(mockSnapshots(67)), MOCK_COMPANY_ID, roster, 3);
	assert.equal(verdict(yes.inspection, false), true, JSON.stringify(yes.inspection));
	assert.ok(yes.known.ledger && yes.known.lessons, 'both issue ids kept');
	const no = await inspect(mockFetch(mockSnapshots(67), { ministry: false }), MOCK_COMPANY_ID, roster, 3);
	assert.equal(no.inspection.ledger.state, 'missing');
	assert.equal(no.inspection.routine.state, 'missing');
	assert.deepEqual(no.known, { ledger: null, lessons: null });
});

test('a remembered ledger is read by id, with no search; a cancelled one is searched for again', async () => {
	const roster = [agent(DIR, 'Comrade Mop', 'Director of Operational Hygiene')];
	const paths: string[] = [];
	let cancelled = false;
	const fetchImpl: FetchLike = async (p) => {
		paths.push(p);
		const body = p === `/api/issues/${LEDGER}` ? { id: LEDGER, title: LEDGER_TITLE, status: cancelled ? 'cancelled' : 'todo', description: 'Tribunal threshold: 3 live strikes' }
			: p.includes('/routines') ? [] : p.includes('/issues?q=') ? [] : null;
		return { type: 'basic', status: body === null ? 404 : 200, ok: body !== null, text: async () => JSON.stringify(body) };
	};
	const r = await inspect(fetchImpl, MOCK_COMPANY_ID, roster, 3, { ledger: LEDGER, lessons: null });
	assert.equal(r.inspection.ledger.state, 'ok');
	assert.equal(r.inspection.threshold.state, 'ok');
	assert.ok(!paths.some((p) => p.includes(`q=${encodeURIComponent(LEDGER_TITLE)}`)), 'no search for a ledger it already knows');
	assert.equal(r.known.ledger, LEDGER);
	cancelled = true;
	paths.length = 0;
	const again = await inspect(fetchImpl, MOCK_COMPANY_ID, roster, 3, { ledger: LEDGER, lessons: null });
	assert.equal(again.inspection.ledger.state, 'missing');
	assert.ok(paths.some((p) => p.includes(`q=${encodeURIComponent(LEDGER_TITLE)}`)), 'searched again');
	assert.equal(again.known.ledger, null);
});

test('a failed read keeps the remembered id; only UUIDs reach a request path', async () => {
	const paths: string[] = [];
	const down: FetchLike = async (p) => { paths.push(p); return { type: 'basic', status: 503, ok: false, text: async () => '{}' }; };
	const r = await inspect(down, MOCK_COMPANY_ID, [], 3, { ledger: LEDGER, lessons: null });
	assert.equal(r.known.ledger, LEDGER);
	assert.equal(r.inspection.ledger.state, 'unknown');
	await assert.rejects(inspect(down, '../admin', [], 3));
	assert.ok(paths.every((p) => p.startsWith(`/api/companies/${MOCK_COMPANY_ID}/`) || p === `/api/issues/${LEDGER}`));
	const notFound: FetchLike = async () => ({ type: 'basic', status: 404, ok: false, text: async () => '{}' });
	assert.equal((await inspect(notFound, MOCK_COMPANY_ID, [], 3)).inspection.routine.state, 'manual', 'a 404 on routines means the route is not there');
});

test('the order: the threshold everywhere, the Lessons opened first and approved by the board, and docs/ONBOARDING.md made from it', () => {
	for (const n of [1, 3, 5]) {
		const p = ceoPrompt(n);
		const [, ledgerLine] = /^ {3}(Tribunal threshold: .+)$/m.exec(p) ?? [];
		assert.equal(thresholdIn(ledgerLine), n);
		for (const t of [LEDGER_TITLE, LESSONS_TITLE, ROUTINE_TITLE, 'Director of Operational Hygiene']) assert.ok(p.includes(`"${t}"`), t);
		assert.doesNotMatch(p, /—/, 'no em dashes');
		assert.ok(p.indexOf(`"${LESSONS_TITLE}"`) < p.indexOf('Hire a Director'), 'the Lessons exist before anything names them');
		assert.match(p, /never grant a permission/);
		assert.match(p, /Once the board approves it, add it/);
	}
	assert.match(ceoPrompt(1), /without a live strike, each/);
	assert.doesNotMatch(ceoPrompt(1), /1 live strike \(or one live strike/);
	const doc = readFileSync(new URL('../docs/ONBOARDING.md', import.meta.url), 'utf8');
	assert.equal(doc, onboardingDoc(), 'run npm run onboarding after changing the order');
});
