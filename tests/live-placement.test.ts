/**
 * Placement rules: home zones by name/title/role, where each status stands, the 120s
 * heartbeat window (inclusive), and the "needs you" flag.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORKING_WINDOW_MS, homeZone, needsYou, placement } from '../src/live/placement';
import { mockSnapshots } from '../src/live/mock';
import type { AgentState, Snapshot } from '../src/live/types';

const NOW = Date.UTC(2026, 8, 23, 12);

/**
 * An agent with sensible defaults.
 *
 * @param over Fields to override.
 * @returns AgentState.
 */
function agent(over: Partial<AgentState> = {}): AgentState {
	return { id: 'x', name: 'Somebody', title: null, role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null, ...over };
}

/**
 * ISO timestamp some ms before NOW.
 *
 * @param ms Age in ms.
 * @returns ISO string.
 */
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test('home zones by name, title or role (case-insensitive)', () => {
	const cases: [Partial<AgentState>, string][] = [
		[{ name: 'Comrade BOSS' }, 'directorate'],
		[{ name: 'Someone', title: 'company lead' }, 'directorate'],
		[{ name: 'Comrade Director', title: 'BOSS' }, 'directorate'],
		[{ name: 'pyotr the planner' }, 'planRoom'],
		[{ name: 'x', title: 'Comrade Planner' }, 'planRoom'],
		[{ name: 'x', role: 'Delivery Lead' }, 'planRoom'],
		[{ name: 'Grigori the Auditor' }, 'inspectorate'],
		[{ name: 'x', title: 'Independent Reviewer' }, 'inspectorate'],
		[{ name: 'x', title: 'Company critic' }, 'inspectorate'],
		[{ name: 'Alexei' }, 'production'],
		[{ name: 'x', title: 'Generalist Executor' }, 'production'],
		[{ name: 'x', title: 'shock worker' }, 'production'],
		[{ name: 'Expert Unblocker' }, 'repair'],
		[{ name: 'x', role: 'recovery' }, 'repair'],
		[{ name: 'State Enforcer' }, 'hygiene'],
		[{ name: 'x', title: 'Director of Operational Hygiene' }, 'hygiene'],
		[{ name: 'Summarizer' }, 'planRoom'],
		[{ name: 'The Commissar' }, 'roam'],
		[{ name: 'x', title: 'Representative of the State' }, 'roam'],
		[{ name: 'Manual Seat' }, 'production'],
		[{ name: 'Nobody in particular' }, 'production'],
	];
	for (const [over, zone] of cases) assert.equal(homeZone(agent(over)), zone, JSON.stringify(over));
});

test('patterns match whole words, not fragments', () => {
	assert.equal(homeZone(agent({ name: 'Embossed Printer' })), 'production');
	assert.equal(homeZone(agent({ name: 'Theresa Repton' })), 'production');
});

test('every mock comrade lands where its name says', () => {
	const first = mockSnapshots(1).next().value as Snapshot;
	const zones = first.agents.map((a) => homeZone(a));
	assert.deepEqual(zones, ['directorate', 'planRoom', 'inspectorate', 'production', 'repair', 'hygiene', 'planRoom', 'roam', 'production']);
});

test('error and paused go to Siberia, shivering, whatever the heartbeat', () => {
	for (const status of ['error', 'paused']) {
		assert.deepEqual(placement(agent({ status, name: 'Alexei', lastHeartbeatAt: ago(0) }), NOW), { zone: 'siberia', activity: 'shivering' });
		assert.deepEqual(placement(agent({ status, name: 'The Commissar' }), NOW), { zone: 'siberia', activity: 'shivering' });
	}
});

test('running works at home even with no heartbeat', () => {
	assert.deepEqual(placement(agent({ status: 'running', name: 'Grigori the Auditor' }), NOW), { zone: 'inspectorate', activity: 'working' });
	assert.deepEqual(placement(agent({ status: 'running', name: 'The Commissar' }), NOW), { zone: 'roam', activity: 'working' });
});

test('a recent heartbeat means working; the 120s boundary is inclusive', () => {
	assert.equal(WORKING_WINDOW_MS, 120_000);
	const at = (ms: number) => placement(agent({ name: 'Pyotr the Planner', lastHeartbeatAt: ago(ms) }), NOW);
	assert.deepEqual(at(0), { zone: 'planRoom', activity: 'working' });
	assert.deepEqual(at(119_999), { zone: 'planRoom', activity: 'working' });
	assert.deepEqual(at(120_000), { zone: 'planRoom', activity: 'working' });
	assert.deepEqual(at(120_001), { zone: 'canteen', activity: 'idle' });
	// Clock skew: a heartbeat stamped slightly in the future still counts.
	assert.deepEqual(at(-5_000), { zone: 'planRoom', activity: 'working' });
});

test('idle goes to the canteen; roamers keep roaming', () => {
	assert.deepEqual(placement(agent({ name: 'Alexei' }), NOW), { zone: 'canteen', activity: 'idle' });
	assert.deepEqual(placement(agent({ name: 'Alexei', lastHeartbeatAt: 'not a date' }), NOW), { zone: 'canteen', activity: 'idle' });
	assert.deepEqual(placement(agent({ name: 'The Commissar', lastHeartbeatAt: ago(3_600_000) }), NOW), { zone: 'roam', activity: 'idle' });
	// Unknown statuses behave as idle rather than vanishing.
	assert.deepEqual(placement(agent({ name: 'Alexei', status: 'hibernating' }), NOW), { zone: 'canteen', activity: 'idle' });
});

test('needsYou flags agents in error only', () => {
	const snap: Snapshot = { at: NOW, session: 'ok', message: null, companyId: null, companyName: null, agents: [], badges: null, badgesStale: false, approvals: null };
	assert.equal(needsYou(agent({ status: 'error' }), snap), true);
	for (const status of ['idle', 'running', 'paused']) assert.equal(needsYou(agent({ status }), snap), false);
});
