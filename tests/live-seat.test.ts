/**
 * The owner's own seat: by name until chosen, then by id alone, and nobody once the owner says
 * none. The seat keeps the office (never Siberia), leaves the desk to whoever works it, and its
 * board stamps stay locked.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Slot, assignSlots } from '../src/cockpit/assign';
import { OWN_SEAT, stampRules } from '../src/live/personnel';
import { directorsOf, isOwnSeat, setOwnSeat } from '../src/live/personas';
import { placement } from '../src/live/placement';
import type { AgentState } from '../src/live/types';

const A = '22222222-2222-4333-8444-000000000001';
const B = '22222222-2222-4333-8444-000000000002';

/**
 * A roster entry.
 *
 * @param id Id.
 * @param name Name.
 * @param status Status.
 * @param title Title.
 * @returns Agent.
 */
const agent = (id: string, name: string, status = 'idle', title: string | null = null): AgentState => ({ id, name, title, role: null, status, pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null });

test('not chosen, chosen, and none: the three states of the seat', () => {
	const named = agent(B, 'Chairman (Manual Seat)', 'paused');
	const chosen = agent(A, 'Sasha', 'error');
	try {
		setOwnSeat(null);
		assert.equal(isOwnSeat(named), true, 'until chosen, by name');
		assert.equal(isOwnSeat(chosen), false);
		setOwnSeat(A);
		assert.equal(isOwnSeat(chosen), true);
		assert.equal(isOwnSeat(named), false, 'a chosen seat replaces the name rule');
		setOwnSeat('none');
		assert.equal(isOwnSeat(named), false, '"none" means nobody, whatever they are called');
		assert.equal(isOwnSeat(chosen), false);
	} finally {
		setOwnSeat(null);
	}
});

test('the seat keeps the office whatever its status, and its stamps stay locked', () => {
	const seat = agent(A, 'Sasha', 'paused');
	try {
		setOwnSeat(A);
		assert.deepEqual(placement(seat, 0), { zone: 'directorate', activity: 'idle' });
		assert.ok(Object.values(stampRules(seat)).every((w) => w === OWN_SEAT));
		setOwnSeat('none');
		assert.equal(placement(seat, 0).zone, 'siberia');
		assert.notEqual(stampRules(seat).resume, OWN_SEAT);
	} finally {
		setOwnSeat(null);
	}
});

test('the seat never takes a station, even one it held, so the desk stays free for whoever works it', () => {
	const at = (kind: Slot['kind'], index: number): Slot => ({ zone: 'directorate', kind, index, pos: [index, 0, 0], facing: 'S' });
	const slots = (): Slot[] => [at('station', 0), at('tile', 0), at('tile', 1)];
	const got = assignSlots(slots, [{ id: 'a-seat', zone: 'directorate', noStation: true }], new Map([['a-seat', at('station', 0)]]));
	assert.equal(got.get('a-seat')?.kind, 'tile');
	const both = assignSlots(slots, [{ id: 'a-seat', zone: 'directorate', noStation: true }, { id: 'b-lead', zone: 'directorate' }], new Map());
	assert.equal(both.get('b-lead')?.kind, 'station', 'the lead gets the desk though the seat sorts first');
});

test("one rule for the Director, shared by the court and the inspection: terminated agents don't count", () => {
	const dir = agent(A, 'Comrade Mop', 'idle', 'Director of Operational Hygiene');
	const old = agent(B, 'Old Mop', 'terminated', 'Director of Operational Hygiene');
	assert.deepEqual(directorsOf([dir, old]).map((a) => a.id), [A]);
	assert.deepEqual(directorsOf([agent(B, 'State Enforcer')]).map((a) => a.id), [B]);
});

test('the chosen seat is known by id even off the roster, for the last check before a termination', async () => {
	const { isChosenSeat } = await import('../src/live/personas');
	try {
		setOwnSeat(A);
		assert.equal(isChosenSeat(A), true);
		assert.equal(isChosenSeat(B), false);
		setOwnSeat('none');
		assert.equal(isChosenSeat('none'), false, '"none" is never an agent');
		setOwnSeat(null);
		assert.equal(isChosenSeat(A), false);
	} finally {
		setOwnSeat(null);
	}
});
