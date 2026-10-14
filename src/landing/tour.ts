import { memoryStorage, tourClock } from './clock';
import type { Cockpit } from '../cockpit/app';

// Install before importing the engine: its stores must only see this run's fictional choices.
Object.defineProperty(window, 'localStorage', { value: memoryStorage() });
Object.defineProperty(window, 'sessionStorage', { value: memoryStorage() });
localStorage.setItem('plant67.sound', JSON.stringify({ ambient: 0, effects: 0, ambientMuted: true, effectsMuted: true, hushed: true, radio: 0, radioOn: false }));
const clock = tourClock();
let cockpit: Cockpit | null = null;
let paused = false;
const origin = location.origin;

/** Only the embedding page can control this fictional tour. */
window.addEventListener('message', (event) => {
	if (event.source !== parent || event.origin !== origin || event.data?.type !== 'plant-tour-control' || typeof event.data.paused !== 'boolean') return;
	paused = event.data.paused;
	clock.pause(paused);
	cockpit?.setPlaying(!paused);
});

/** Report bounded, non-sensitive tour state to the embedding page. */
function tell(type: string, extra: Record<string, unknown> = {}): void {
	parent.postMessage({ type: `plant-tour-${type}`, ...extra }, origin);
}

/** Wait on active time, so pausing cannot skip a beat of the demonstration. */
async function wait(ms: number): Promise<void> {
	const end = clock.now() + ms;
	while (clock.now() < end) {
		await clock.active();
		await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(0, end - clock.now()))));
	}
	await clock.active();
}

/** Wait for a rendered state, with a bounded failure instead of an empty scene. */
async function until(test: () => boolean, timeout = 20_000): Promise<void> {
	const end = clock.now() + timeout;
	while (!test()) {
		if (clock.now() >= end) throw new Error('The demo took too long to reach its next scene.');
		await wait(100);
	}
}

/** Run the actual cockpit with only an in-memory mock adapter. */
async function run(): Promise<void> {
	const [{ boot }, { mockFetch, mockSnapshots, MOCK_COMPANY_ID }, { createPoller }, { moduleWorker }] = await Promise.all([
		import('../cockpit/app'), import('../live/mock'), import('../live/poller'), import('../preview/module-worker'),
	]);
	const snapshot = mockSnapshots(67).next().value;
	// Hold a deliberate roster: enough occupied stations to make the opening view useful.
	snapshot.agents = snapshot.agents.map((agent, index) => ({ ...agent, status: index === 1 || index === 6 ? 'idle' : 'running', pauseReason: null, errorReason: null, lastHeartbeatAt: null }));
	const mock = mockFetch([snapshot], { scenario: 'tribunal', replyDelayMs: 2_500, now: () => Date.UTC(2026, 8, 23, 9) + clock.now() });
	const fetchImpl: typeof mock = async (input, init) => { await clock.active(); return mock(input, init); };
	cockpit = await boot({ root: document.body, fetchImpl, makeWorker: moduleWorker, host: 'demo', wizardOpens: false,
		sourceNote: 'A fictional plant. Nothing here connects to your agents.', issueHref: () => null,
		startPoller: (onSnapshot) => { const p = createPoller({ fetchImpl, onSnapshot, intervalMs: 2_000 }); p.start(); return p; },
	});
	cockpit.setPlaying(!paused);
	await until(() => cockpit!.stats().firstComradeMs !== null, 60_000);
	cockpit.frame(890, 430, 1);
	await wait(4_000);
	tell('ready');
	void watchSpeed();
	tell('scene', { scene: 0 });
	await wait(7_000);
	const comrade = cockpit.crewReport().find((c) => c.name === 'Night Shift Welder' && c.activity === 'working');
	if (!comrade) throw new Error('The demonstration comrade is not ready.');
	tell('scene', { scene: 1 });
	const response = await fetchImpl(`/api/companies/${MOCK_COMPANY_ID}/issues`, { method: 'POST', body: JSON.stringify({ title: 'Check the boiler before the morning shift.', description: 'Check the boiler before the morning shift.', assigneeAgentId: comrade.id, status: 'todo' }) });
	if (!response.ok) throw new Error('The demo directive could not be sent.');
	const issue = JSON.parse(await response.text()) as { id: string };
	cockpit.select(comrade.id, issue.id);
	cockpit.frame(870, 430, 1);
	await until(() => document.querySelector('.p67-card')?.textContent?.includes('Understood') ?? false);
	await wait(6_000);
	cockpit.select(null);
	tell('scene', { scene: 2 });
	cockpit.openTribunal();
	await until(() => !!document.querySelector('.p67-board:not([hidden])'));
	cockpit.frame(545, 300, 1);
	await wait(3_000);
	// Show the real report through its existing UI; this frame can only speak to the mock.
	const report = [...document.querySelectorAll<HTMLButtonElement>('button.p67-link')].find((button) => button.textContent?.includes("Director's report"));
	if (!report) throw new Error('The demo report is unavailable.');
	report.click();
	await wait(7_000);
	tell('done');
	cockpit.setPlaying(false);
	clock.pause(true);
}

/** A sustained very low frame rate uses the recording instead of keeping a struggling renderer. */
async function watchSpeed(): Promise<void> {
	let slow = 0;
	await wait(5_000);
	while (true) {
		await wait(2_000);
		slow = cockpit && cockpit.stats().fps < 8 ? slow + 1 : 0;
		if (slow >= 3) { tell('slow'); return; }
	}
}

run().catch(() => tell('error'));
