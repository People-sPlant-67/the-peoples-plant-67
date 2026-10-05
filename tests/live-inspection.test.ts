/**
 * The Ministry's inspection and the order that founds it: each of the five checks from what
 * Paperclip says, the regime's threshold read from the ledger, a missing routines route left to
 * the owner, the order matching docs/ONBOARDING.md, and the owner's own seat (by id, out of
 * Siberia, never stamped).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { FetchLike } from '../src/live/http';
import { type Evidence, LEDGER_TITLE, LESSONS_TITLE, ROUTINE_TITLE, founded, inspect, judge, thresholdIn } from '../src/live/inspection';
import { MOCK_COMPANY_ID, mockFetch, mockSnapshots } from '../src/live/mock';
import { ceoPrompt } from '../src/live/onboarding';
import { OWN_SEAT, stampRules } from '../src/live/personnel';
import { isOwnSeat, setOwnSeat } from '../src/live/personas';
import { placement } from '../src/live/placement';
import type { AgentState } from '../src/live/types';

const DIR = '22222222-2222-4333-8444-000000000005';
const OTHER = '22222222-2222-4333-8444-000000000006';

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
	ledgers: [{ id: 'l', title: LEDGER_TITLE, status: 'backlog' }],
	lessons: [{ id: 'm', title: ` ${LESSONS_TITLE.toLowerCase()} `, status: 'backlog' }],
	ledgerText: 'Tribunal threshold: 3 live strikes\n\n| agent |',
});

test('everything in place: five stamps, and the Ministry is founded', () => {
	const i = judge(all(), 3);
	for (const k of ['director', 'routine', 'ledger', 'threshold', 'lessons'] as const) assert.equal(i[k].state, 'ok', k);
	assert.equal(founded(i), true);
});

test('nothing yet: every check is missing, with a sentence saying what it waits for', () => {
	const i = judge({ agents: [], routines: [], ledgers: [], lessons: [], ledgerText: undefined }, 3);
	for (const k of ['director', 'routine', 'ledger', 'threshold', 'lessons'] as const) {
		assert.equal(i[k].state, 'missing', k);
		assert.match(i[k].note ?? '', /^[A-Z].*\.$/, k);
	}
	assert.equal(founded(i), false);
});

test('the Director: two look-alikes is wrong, a terminated one does not count', () => {
	const two = { ...all(), agents: [...all().agents, agent(OTHER, 'Deputy', 'State Enforcer')] };
	assert.equal(judge(two, 3).director.state, 'wrong');
	assert.match(judge(two, 3).director.note!, /Comrade Mop, Deputy/);
	const gone = { ...all(), agents: [agent(DIR, 'Comrade Mop', 'Director of Operational Hygiene', 'terminated')] };
	assert.equal(judge(gone, 3).director.state, 'missing');
});

test('the routine: someone else\'s or switched off is wrong; an archived one does not count', () => {
	assert.equal(judge({ ...all(), routines: [{ title: ROUTINE_TITLE, assigneeAgentId: OTHER, status: 'active' }] }, 3).routine.state, 'wrong');
	assert.equal(judge({ ...all(), routines: [{ title: ROUTINE_TITLE, assigneeAgentId: DIR, status: 'paused' }] }, 3).routine.state, 'wrong');
	assert.equal(judge({ ...all(), routines: [{ title: ROUTINE_TITLE, assigneeAgentId: DIR, status: 'archived' }] }, 3).routine.state, 'missing');
	// A paused copy beside the live one does not hide the live one.
	assert.equal(judge({ ...all(), routines: [{ title: ROUTINE_TITLE, assigneeAgentId: DIR, status: 'paused' }, { title: ROUTINE_TITLE, assigneeAgentId: DIR, status: 'active' }] }, 3).routine.state, 'ok');
});

test('no routines route: the owner checks it by hand, and the Ministry is still founded on the rest', () => {
	const i = judge({ ...all(), routines: null }, 3);
	assert.equal(i.routine.state, 'manual');
	assert.equal(founded(i), true);
	const failed = judge({ ...all(), routines: undefined }, 3);
	assert.equal(failed.routine.state, 'unknown', 'a failed read is tried again, not waved through');
	assert.equal(founded(failed), false);
});

test('the threshold comes from the ledger and must match the regime', () => {
	assert.equal(thresholdIn('Tribunal threshold: 5 live strikes'), 5);
	assert.equal(thresholdIn('tribunal THRESHOLD:1 live strike'), 1);
	assert.equal(thresholdIn('No line here'), null);
	assert.equal(thresholdIn(null), null);
	const wrong = judge(all(), 5).threshold;
	assert.equal(wrong.state, 'wrong');
	assert.match(wrong.note!, /says 3, but your regime says 5/);
	assert.equal(judge({ ...all(), ledgerText: 'Just a table' }, 3).threshold.state, 'missing');
	assert.equal(judge({ ...all(), ledgers: [] }, 3).threshold.state, 'missing', 'no ledger, nothing to read');
	assert.equal(judge({ ...all(), ledgers: [{ title: LEDGER_TITLE, status: 'cancelled' }] }, 3).ledger.state, 'missing', 'a cancelled ledger does not count');
});

test('inspect() against the mock: founded by default, not founded without the Ministry, and only UUIDs in paths', async () => {
	const roster = mockSnapshots(67).next().value.agents;
	const yes = await inspect(mockFetch(mockSnapshots(67)), MOCK_COMPANY_ID, roster, 3);
	assert.equal(founded(yes), true, JSON.stringify(yes));
	const no = await inspect(mockFetch(mockSnapshots(67), { ministry: false }), MOCK_COMPANY_ID, roster, 3);
	assert.equal(no.ledger.state, 'missing');
	assert.equal(no.routine.state, 'missing');
	assert.equal(founded(no), false);
	const paths: string[] = [];
	const spy: FetchLike = async (p) => { paths.push(p); return { type: 'basic', status: 404, ok: false, text: async () => '{}' }; };
	await assert.rejects(inspect(spy, '../admin', roster, 3));
	assert.equal(paths.length, 0, 'nothing is requested for a bad id');
	const missing = await inspect(spy, MOCK_COMPANY_ID, roster, 3);
	assert.equal(missing.routine.state, 'manual', 'a 404 on routines means the route is not there');
	assert.ok(paths.every((p) => p.startsWith(`/api/companies/${MOCK_COMPANY_ID}/`)));
});

test('the order fills in the threshold everywhere, uses the titles the inspection looks for, and matches docs/ONBOARDING.md', () => {
	for (const n of [1, 3, 5]) {
		const p = ceoPrompt(n);
		assert.equal(thresholdIn(p), n);
		for (const t of [LEDGER_TITLE, LESSONS_TITLE, ROUTINE_TITLE, 'Director of Operational Hygiene']) assert.ok(p.includes(`"${t}"`), t);
		assert.doesNotMatch(p, /—/, 'no em dashes');
	}
	assert.match(ceoPrompt(1), /Tribunal threshold: 1 live strike\n/);
	assert.match(ceoPrompt(1), /- 1 live strike means a tribunal referral/);
	const doc = readFileSync(new URL('../docs/ONBOARDING.md', import.meta.url), 'utf8');
	assert.ok(doc.includes(ceoPrompt(3)), 'the doc carries the Standard order word for word');
});

test('the own seat: by name until one is chosen, then by id alone; it keeps the office and is never stamped', () => {
	const named = agent(OTHER, 'Chairman (Manual Seat)', 'Manual seat', 'paused');
	const chosen = agent(DIR, 'Sasha', null, 'error');
	try {
		setOwnSeat(null);
		assert.equal(isOwnSeat(named), true);
		assert.equal(isOwnSeat(chosen), false);
		assert.deepEqual(placement(named, 0), { zone: 'directorate', activity: 'idle' }, 'paused, but not to Siberia');
		assert.equal(placement(chosen, 0).zone, 'siberia');
		setOwnSeat(DIR);
		assert.equal(isOwnSeat(chosen), true);
		assert.equal(isOwnSeat(named), false, 'a chosen seat replaces the name rule');
		assert.deepEqual(placement(chosen, 0), { zone: 'directorate', activity: 'idle' });
		assert.equal(placement(named, 0).zone, 'siberia');
		assert.ok(Object.values(stampRules(chosen)).every((w) => w === OWN_SEAT));
		assert.notEqual(stampRules(named).resume, OWN_SEAT);
	} finally {
		setOwnSeat(null);
	}
});
