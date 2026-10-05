/**
 * When "PAPERS, PLEASE" goes up: not on a single blip, at once if the plant has never had
 * data, and down again on the first good snapshot. Plus which comrades swing a hammer.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restingAnim } from '../src/cockpit/crew';
import { FAILURES_TO_SHOW, type Watch, watch } from '../src/cockpit/overlay';
import type { Session, Snapshot } from '../src/live/types';

/**
 * A snapshot with a session and a roster of n agents.
 *
 * @param session Session.
 * @param n Agents.
 * @returns Snapshot.
 */
function snap(session: Session, n = 1): Snapshot {
	const agents = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: 'x', title: null, role: null, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null }));
	return { at: 0, session, message: null, companyId: null, companyName: null, agents, badges: null, badgesStale: false, approvals: null };
}

/**
 * Run a sequence of sessions through watch().
 *
 * @param seq Sessions in order.
 * @returns Whether the notice was up after each.
 */
function run(seq: Session[]): boolean[] {
	let w: Watch = { failures: 0, hadData: false };
	return seq.map((s) => { const r = watch(w, snap(s)); w = r.next; return r.show; });
}

test('one blip after good data does not raise the notice; two in a row do', () => {
	assert.equal(FAILURES_TO_SHOW, 2);
	assert.deepEqual(run(['ok', 'unreachable', 'ok']), [false, false, false]);
	assert.deepEqual(run(['ok', 'access-lapsed', 'access-lapsed', 'access-lapsed']), [false, false, true, true]);
});

test('the notice closes on the first good snapshot, and the count starts again', () => {
	assert.deepEqual(run(['ok', 'signed-out', 'signed-out', 'ok', 'signed-out']), [false, false, true, false, false]);
});

test('with no data yet, the first failure raises it at once (there is nothing to look at)', () => {
	assert.deepEqual(run(['unreachable']), [true]);
	// A good answer with nobody on the roster still counts: one blip after it is only a blip.
	let w: Watch = { failures: 0, hadData: false };
	w = watch(w, snap('ok', 0)).next;
	assert.equal(watch(w, snap('unreachable')).show, false);
});

test('only the Production Floor swings hammers; desks and The Commissar idle while working', () => {
	assert.equal(restingAnim('working', 'production'), 'work');
	for (const zone of ['planRoom', 'inspectorate', 'directorate', 'repair', 'hygiene', 'roam'] as const) assert.equal(restingAnim('working', zone), 'idle', zone);
	assert.equal(restingAnim('idle', 'canteen'), 'idle');
	assert.equal(restingAnim('shivering', 'siberia'), 'shiver');
});
