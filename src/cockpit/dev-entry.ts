/**
 * Dev host for the cockpit: cockpit.html under `npm run dev`. Runs the real poller against
 * mockFetch, so everything from the poller down is the code the extension runs; only the
 * network is fake. No Paperclip needed.
 *
 * Query parameters: ?interval=ms (gap between mock snapshots, default 4000), ?seed=n, and
 * ?scenario=tribunal|hire|away|purge|dossier|personnel to start a flow at once:
 * - tribunal: a referral for Shock Worker No. 3 is pending; the court assembles.
 * - hire: after 6 seconds a new comrade arrives by train and waits at the desk for your stamp.
 * - away: the plant "remembers" a roster from before: one comrade was terminated, one deleted,
 *   and one joined while you were away, so all three play back on opening.
 * - purge: as away, but with five departures, so the replay cap and its notice show.
 * - dossier: two approvals of other types wait: one filed by Comrade Planner (on him), one filed by a
 *   board user (on the Company Lead, and of a type the plant does not know).
 * - pravda: as away, and the last visit was 14 hours ago, so Pravda prints a night's news
 *   (with secret rows in the feed that it must leave out) before the replay plays.
 * - personnel: Shock Worker No. 3 is stuck in error (clear it from their Personnel File), and
 *   the owner's own manual seat is on the roster, paused, with every stamp locked.
 * Agent Chat is on in the mock; add ?chat=off to see the plant without it (directives only). In a
 * chat, a message with "question", "confirm", "checklist", "tasks", "verdict", "connect" or "tool"
 * in it gets that kind of question back, to try every slip.
 * The cockpit handle is on window.plant67 for poking at from DevTools.
 */
import { createPoller } from '../live/poller';
import { MOCK_COMPANY_ID, MOCK_EXTRA, type MockScenario, mockFetch, mockSnapshots } from '../live/mock';
import { moduleWorker } from '../preview/module-worker';
import { boot } from './app';
import { SEEN_KEY } from './pravda';

const params = new URLSearchParams(location.search);
const interval = Math.max(500, Number(params.get('interval')) || 4000);
const seed = Number(params.get('seed')) || 67;
const scenario = (['tribunal', 'hire', 'away', 'purge', 'dossier', 'personnel', 'pravda'] as const).find((x) => x === params.get('scenario')) ?? null;

/**
 * Seed the plant's memory of the last roster so the away scenarios have something to replay.
 *
 * @param which The scenario.
 */
function rememberBefore(which: MockScenario): void {
	const roster = mockSnapshots(seed).next().value.agents;
	const ghosts = [
		{ id: MOCK_EXTRA.purged, name: 'Comrade Purged', title: 'Former Summariser', role: null },
		{ id: MOCK_EXTRA.vanished, name: 'Comrade Vanished', title: 'Temporary Help', role: null },
		...(which === 'purge' ? MOCK_EXTRA.purgedMore.map((id, k) => ({ id, name: `Purged Comrade ${k + 2}`, title: 'Generalist Executor', role: null })) : []),
	];
	// The last comrade on the mock roster "joined" while the plant was closed.
	const before = [...roster.slice(0, -1).map((a) => ({ id: a.id, name: a.name, title: a.title, role: a.role })), ...ghosts];
	try { localStorage.setItem('plant67.roster', JSON.stringify({ companyId: MOCK_COMPANY_ID, agents: before })); } catch { /* No storage: nothing to replay. */ }
}
if (scenario === 'away' || scenario === 'purge' || scenario === 'pravda') rememberBefore(scenario);
if (scenario === 'pravda') {
	try { localStorage.setItem(SEEN_KEY, JSON.stringify({ [MOCK_COMPANY_ID]: Date.now() - 14 * 3_600_000 })); } catch { /* No storage: no paper. */ }
}

// The built demo (npm run demo) is what the public sees; `npm run dev` is for working on the plant.
const demo = !import.meta.env.DEV;
document.title = demo ? "The People's Plant #67 · Demo" : "People's Plant #67 · Cockpit (mock data)";
// One mock Paperclip for the poller and the chat, so directives land on the same roster.
const fetchImpl = mockFetch(mockSnapshots(seed), { scenario, agentChat: params.get('chat') !== 'off' });
const cockpit = await boot({
	root: document.body,
	fetchImpl,
	makeWorker: moduleWorker,
	sourceNote: demo
		? 'Demo data: a fictional plant that changes every few seconds.'
		: `Mock data, a new snapshot every ${interval / 1000}s${scenario ? `, scenario "${scenario}"` : ''}.`,
	// The mock has no issue pages to open, so reports are read inside the plant.
	issueHref: () => null,
	startPoller: (onSnapshot) => {
		// Mock heartbeats are dated on the mock's own calendar, not this machine's clock, so here
		// only 'running' counts as working; the recent-heartbeat rule is covered by the tests.
		const poller = createPoller({ fetchImpl, intervalMs: interval, onSnapshot });
		poller.start();
		return poller;
	},
});
(window as unknown as { plant67: typeof cockpit }).plant67 = cockpit;
