/**
 * Fake Paperclip for building the cockpit with no instance to hand. The roster is fictional:
 * the names hit the same placement patterns as the live roster but belong to nobody real.
 */
import { LEDGER_TITLE, LESSONS_TITLE, ROUTINE_TITLE } from './inspection';
import type { FetchLike, ResponseLike } from './http';
import { MESSAGES } from './poller';
import type { AgentState, AgentStatus, Badges, Snapshot } from './types';

/** Company id served by mockFetch. A valid UUID so the poller's guard accepts it. */
export const MOCK_COMPANY_ID = '00000000-0000-4000-8000-000000000067';
export const MOCK_COMPANY_NAME = 'Demo Collective No. 67';

/** Gap between mock snapshots, matching the poller's default interval. */
const STEP_MS = 20_000;

/** Fictional comrades: [name, title], one per placement rule plus a default. */
const ROSTER: [string, string | null][] = [
	['Comrade Director', 'BOSS, Company Lead'],
	['Comrade Planner', 'Delivery Lead'],
	['Comrade Critic', 'Independent Reviewer'],
	['Shock Worker No. 3', 'Generalist Executor'],
	['Comrade Spanner', 'Expert Unblocker'],
	['State Enforcer', 'Keeper of the Mop'],
	['Comrade Scribe', 'Summarizer'],
	['The Commissar', 'Representative of the State'],
	['Night Shift Welder', null],
];

/** Steps between lapsed-session snapshots. */
const LAPSE_EVERY = 40;

const STATUSES: AgentStatus[] = ['running', 'running', 'idle', 'idle', 'idle', 'error', 'paused'];

/**
 * Small seeded PRNG (mulberry32), so a seed always plays out the same story.
 *
 * @param seed Integer seed.
 * @returns Function returning floats in [0, 1).
 */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * A fake agent id in UUID form.
 *
 * @param i Roster index.
 * @returns UUID string.
 */
function agentId(i: number): string {
	return `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
}

/**
 * Endless plausible snapshots: statuses drift every step, errors and pauses come and go,
 * and every LAPSE_EVERY steps the session lapses for one step (keeping the last agents, as the poller does).
 *
 * @param seed Integer seed.
 * @param start Epoch ms of the first snapshot.
 * @returns Infinite generator of Snapshots.
 */
export function* mockSnapshots(seed: number, start = Date.UTC(2026, 8, 23, 9)): Generator<Snapshot, never, void> {
	const rand = rng(seed);
	const agents: AgentState[] = ROSTER.map(([name, title], i) => ({
		id: agentId(i), name, title, role: null, status: 'idle',
		pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: i === 0 ? null : agentId(0), urlKey: `mock-${i + 1}`,
	}));
	for (let step = 0; ; step++) {
		const at = start + step * STEP_MS;
		// Every 40th step (about every 13 minutes of mock time) the sign-in lapses for one step,
		// so the overlay gets exercised. It shows the previous roster unchanged, as the poller would.
		const lapsed = step % LAPSE_EVERY === LAPSE_EVERY - 1;
		for (const a of lapsed ? [] : agents) {
			// Roughly one in four agents changes status per step, so the floor moves but doesn't churn.
			if (step > 0 && rand() > 0.25) continue;
			const status = STATUSES[Math.floor(rand() * STATUSES.length)];
			a.status = status;
			a.errorReason = status === 'error' ? 'The workshop ran out of rivets.' : null;
			a.pauseReason = status === 'paused' ? 'manual' : null;
			if (status === 'running') a.lastHeartbeatAt = new Date(at).toISOString();
		}
		const badges: Badges = {
			inbox: Math.floor(rand() * 4),
			approvals: Math.floor(rand() * 3),
			failedRuns: agents.filter((a) => a.status === 'error').length,
			joinRequests: 0,
		};
		yield {
			at,
			session: lapsed ? 'access-lapsed' : 'ok',
			message: lapsed ? MESSAGES['access-lapsed'] : null,
			companyId: MOCK_COMPANY_ID,
			companyName: MOCK_COMPANY_NAME,
			agents: agents.map((a) => ({ ...a })),
			badges,
			badgesStale: false,
			approvals: null,
		};
	}
}

/**
 * A JSON response.
 *
 * @param status HTTP status.
 * @param body Value to serialise.
 * @returns Response-like object.
 */
function json(status: number, body: unknown): ResponseLike {
	return { type: 'basic', status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

/** The mock's signed-in board user. */
export const MOCK_USER_ID = 'mock-board-user';

/** Scripted events for developing the ceremonies without a real org. */
export type MockScenario = 'tribunal' | 'hire' | 'away' | 'purge' | 'dossier' | 'personnel' | 'pravda';

/** Options for the mock's issues and comments. */
export interface MockOptions {
	/** Play a scripted event: a pending tribunal, a hire arriving, departures to replay, two dossiers, or a comrade in error beside the owner's seat. */
	scenario?: MockScenario | null;
	/** How long after start the hire scenario's new comrade appears, ms. */
	hireDelayMs?: number;
	/** Clock for comment times and delayed replies. */
	now?: () => number;
	/** How long a comrade takes to answer a directive or reply, ms. */
	replyDelayMs?: number;
	/** Serve Agent Chat. Off, the chat routes answer 404 "API route not found", as a Paperclip without them does. */
	agentChat?: boolean;
	/**
	 * The Ministry of Operational Hygiene as the CEO prompt sets it up: the Strike Ledger (Standard
	 * regime, 3 strikes), the Lessons and the daily routine, all the State Enforcer's. On by default,
	 * so the demo's inspection passes; off, the mock is a company that has not founded it yet.
	 */
	ministry?: boolean;
}

/** Canned answers, picked in turn. */
const REPLIES = [
	'Understood, comrade. I will start at once and report when it is done.',
	'Received. The Plan will be fulfilled ahead of schedule.',
	'Noted. I have questions, but I will not ask them.',
	'On it. Expect a report before the next shift change.',
];

/**
 * An in-memory Paperclip for the chat: issues, comments and read marks, with each comrade
 * answering replyDelayMs after every message from the owner.
 *
 * @param opts Options.
 * @returns Handler for issue paths, or null when a path is not an issue path.
 */
function mockIssues(opts: MockOptions): { handle: (method: string, path: string, body: unknown) => ResponseLike | null; addIssue: (title: string, description: string, assignee: string | null) => string } {
	const now = opts.now ?? Date.now;
	const delay = opts.replyDelayMs ?? 4_000;
	const issues: Record<string, unknown>[] = [];
	const comments: Record<string, unknown>[] = [];
	const files: Record<string, unknown>[] = [];
	const asks: Record<string, unknown>[] = [];
	let seq = 0;
	let replies = 0;
	/**
	 * A fresh UUID-shaped id.
	 *
	 * @param kind 1 for issues, 2 for comments, 3 for attachments, 4 for interactions.
	 * @returns Id.
	 */
	const nextId = (kind: number): string => `00000000-0000-4000-${8000 + kind}-${String(++seq).padStart(12, '0')}`;
	/**
	 * Add a comment.
	 *
	 * @param issueId Issue.
	 * @param body Text.
	 * @param at Epoch ms.
	 * @param author Agent id, or null for the board user.
	 * @returns The comment.
	 */
	const comment = (issueId: string, body: string, at: number, author: string | null): Record<string, unknown> => {
		const c = { id: nextId(2), issueId, body, createdAt: new Date(at).toISOString(), authorAgentId: author, authorUserId: author ? null : MOCK_USER_ID, authorType: author ? 'agent' : 'user' };
		comments.push(c);
		return c;
	};
	/**
	 * Queue the assignee's answer (visible once its time comes) and touch the issue.
	 *
	 * @param issue Issue.
	 */
	const answer = (issue: Record<string, unknown>, fresh = false): void => {
		const at = now() + delay;
		comment(issue.id as string, fresh ? 'A clean page, comrade. What are your orders?' : REPLIES[replies++ % REPLIES.length], at, issue.assigneeAgentId as string);
		issue.updatedAt = new Date(at).toISOString();
		if (issue.status === 'todo') issue.status = 'in_progress';
	};
	/**
	 * Comments that exist by now.
	 *
	 * @param issueId Issue.
	 * @returns Comments, oldest first.
	 */
	const visible = (issueId: string) => comments.filter((c) => c.issueId === issueId && Date.parse(c.createdAt as string) <= now());

	// One old thread, so the picker has history before anything is sent.
	const old = { id: nextId(1), identifier: 'PLT-1', title: 'Count the rivets in the east store', status: 'done', description: 'Count every rivet in the east store and report the total.', assigneeAgentId: agentId(3), createdByUserId: MOCK_USER_ID, createdByAgentId: null, createdAt: new Date(now() - 86_400_000).toISOString(), updatedAt: new Date(now() - 80_000_000).toISOString() };
	issues.push(old);
	comment(old.id, 'There are 41,212 rivets. One is bent; I have reported it to the Inspectorate.', now() - 80_000_000, agentId(3));

	/**
	 * File an issue directly (the Director's report, for the tribunal scenario).
	 *
	 * @param title Title.
	 * @param description Body.
	 * @param assignee Agent id or null.
	 * @returns Issue id.
	 */
	const addIssue = (title: string, description: string, assignee: string | null): string => {
		const issue = { id: nextId(1), companyId: MOCK_COMPANY_ID, identifier: `PLT-${issues.length + 1}`, title, status: 'todo', description, assigneeAgentId: assignee, createdByUserId: null, createdByAgentId: assignee, createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
		issues.push(issue);
		return issue.id;
	};

	/**
	 * In a chat, a message naming a kind of question ("question", "confirm", "checklist", "tasks",
	 * "verdict", "connect", "tool") gets that question back with the comrade's answer, so every
	 * slip can be tried on the dev page. A message withdraws open questions that say so.
	 *
	 * @param issue The chat.
	 * @param body The owner's message.
	 * @param at When the answer lands (epoch ms).
	 */
	const ask = (issue: Record<string, unknown>, body: string, at: number): void => {
		for (const a of asks) if (a.issueId === issue.id && a.status === 'pending' && Date.parse(a.createdAt as string) <= now() && (a.payload as Record<string, unknown>).supersedeOnUserComment) a.status = 'expired';
		const w = body.toLowerCase();
		const who = issue.assigneeAgentId as string;
		const payloads: [string, string, Record<string, unknown>][] = [];
		if (w.includes('question')) payloads.push(['ask_user_questions', 'Two questions before I start', { version: 1, supersedeOnUserComment: true, questions: [
			{ id: 'region', prompt: 'Which region first?', selectionMode: 'single', required: true, options: [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }, { id: 'other', label: 'Somewhere else', freeText: true }] },
			{ id: 'shifts', prompt: 'Which shifts may I use?', selectionMode: 'multi', required: false, options: [{ id: 'day', label: 'Day' }, { id: 'night', label: 'Night' }] },
		] }]);
		if (w.includes('confirm')) payloads.push(['request_confirmation', 'Publish the quota?', { version: 1, prompt: 'Shall I publish the new quota to the whole plant?', detailsMarkdown: 'North: 4 boilers.\nSouth: 6 boilers.', acceptLabel: 'Publish', rejectLabel: 'Hold it', allowDeclineReason: true, rejectRequiresReason: false, supersedeOnUserComment: true }]);
		if (w.includes('tool')) payloads.push(['request_confirmation', 'Run a tool', { version: 1, prompt: 'May I run the payroll export?', toolAction: { name: 'payroll.export' }, allowDeclineReason: true }]);
		if (w.includes('checklist')) payloads.push(['request_checkbox_confirmation', 'Which reports?', { version: 1, prompt: 'Which reports shall I send to the Ministry?', options: [{ id: 'coal', label: 'Coal' }, { id: 'steel', label: 'Steel' }, { id: 'grain', label: 'Grain', description: 'Late again.' }], defaultSelectedOptionIds: ['coal'], minSelected: 1, maxSelected: 2 }]);
		if (w.includes('tasks')) payloads.push(['suggest_tasks', 'Tasks for the boiler plan', { version: 1, tasks: [
			{ clientKey: 'survey', title: 'Survey every boiler', assigneeAgentId: who },
			{ clientKey: 'survey-north', parentClientKey: 'survey', title: 'Survey the north boilers', description: 'Start with number 4; it hisses.' },
			{ clientKey: 'order', title: 'Order new gauges' },
		] }]);
		if (w.includes('verdict')) payloads.push(['request_item_verdicts', 'Slogans for the canteen', { version: 1, prompt: 'Which slogans may go up?', items: [{ id: 's1', label: 'Bread for the Plan!' }, { id: 's2', label: 'Soup is a duty.' }], verdicts: ['approve', 'reject', 'defer'], requireReasonOn: ['reject'] }]);
		if (w.includes('connect')) payloads.push(['connection_intent', 'Connect GitHub', { version: 1, serviceSlug: 'github', serviceName: 'GitHub', requestingAgentId: who, requestingAgentName: 'Comrade', phase: 'requested' }]);
		for (const [kind, title, payload] of payloads) asks.push({ id: nextId(4), issueId: issue.id, kind, title, status: 'pending', payload, continuationPolicy: 'wake_assignee', createdAt: new Date(at).toISOString(), result: null });
	};

	/**
	 * An issue as served: a chat reads 'active' while its comrade's answer is still on the way.
	 *
	 * @param issue Stored issue.
	 * @returns Issue object.
	 */
	const served = (issue: Record<string, unknown>): Record<string, unknown> => {
		if (!issue.conversationAgentId) return issue;
		const busy = comments.some((c) => c.issueId === issue.id && Date.parse(c.createdAt as string) > now());
		return { ...issue, conversationState: busy ? 'active' : 'waiting' };
	};

	const handle = (method: string, path: string, body: unknown): ResponseLike | null => {
		const url = new URL(path, 'http://mock');
		const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
		const chat = url.pathname.match(/^\/api\/companies\/([^/]+)\/chats\/([^/]+)$/);
		if (chat) {
			if (!opts.agentChat) return json(404, { error: 'API route not found' });
			if (chat[1] !== MOCK_COMPANY_ID) return json(404, { error: 'Company not found' });
			const mine = issues.find((i) => i.conversationAgentId === chat[2]);
			if (method === 'GET' || mine) return json(200, mine ? served(mine) : null);
			const at = new Date(now()).toISOString();
			const issue = { id: nextId(1), identifier: `PLT-${issues.length + 1}`, title: 'Chat', status: 'in_progress', description: null, assigneeAgentId: chat[2], conversationAgentId: chat[2], conversationUserId: MOCK_USER_ID, conversationState: 'waiting', createdByUserId: MOCK_USER_ID, createdByAgentId: null, createdAt: at, updatedAt: at };
			issues.push(issue);
			return json(200, issue);
		}
		const upload = url.pathname.match(/^\/api\/companies\/([^/]+)\/issues\/([^/]+)\/attachments$/);
		if (upload && method === 'POST') {
			const file = typeof FormData !== 'undefined' && body instanceof FormData ? body.get('file') : null;
			if (!file || typeof file === 'string') return json(400, { error: 'No file was sent.' });
			if (file.size > 10 * 1024 * 1024) return json(422, { error: 'Attachment is larger than the 10 MB limit' });
			if (!issues.some((i) => i.id === upload[2])) return json(404, { error: 'Issue not found' });
			const a = { id: nextId(3), issueId: upload[2], issueCommentId: null, originalFilename: (file as File).name, byteSize: file.size, contentType: file.type || 'application/octet-stream', createdAt: new Date(now()).toISOString() };
			files.push(a);
			return json(201, a);
		}
		const list = url.pathname.match(/^\/api\/companies\/([^/]+)\/issues$/);
		if (list && list[1] === MOCK_COMPANY_ID) {
			if (method === 'GET') {
				const who = url.searchParams.get('assigneeAgentId');
				// Paperclip's q searches more than titles; matching the title is enough for the plant.
				const q = url.searchParams.get('q')?.toLowerCase();
				return json(200, issues.filter((i) => (!who || i.assigneeAgentId === who) && (!q || String(i.title).toLowerCase().includes(q))));
			}
			if (typeof b.title !== 'string' || !b.title || typeof b.assigneeAgentId !== 'string') return json(422, { error: 'Title and assignee are required.' });
			const n = issues.length + 1;
			const issue = { id: nextId(1), identifier: `PLT-${n}`, title: b.title, status: b.status ?? 'todo', description: b.description ?? null, assigneeAgentId: b.assigneeAgentId, createdByUserId: MOCK_USER_ID, createdByAgentId: null, createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
			issues.push(issue);
			answer(issue);
			return json(201, issue);
		}
		const asked = url.pathname.match(/^\/api\/issues\/([^/]+)\/interactions(?:\/([^/]+)\/(accept|reject|respond|verdicts))?$/);
		if (asked) {
			if (!asked[2] && method === 'GET') return json(200, asks.filter((a) => a.issueId === asked[1] && Date.parse(a.createdAt as string) <= now()));
			const a = asks.find((x) => x.id === asked[2] && x.issueId === asked[1]);
			if (!a || method !== 'POST') return json(404, { error: 'Interaction not found' });
			if (a.status !== 'pending') return json(409, { error: 'Interaction is no longer pending' });
			const next: Record<string, string> = { accept: 'accepted', reject: 'rejected', respond: 'answered', verdicts: 'answered' };
			a.status = next[asked[3]];
			a.result = { version: 1, ...b };
			const issue = issues.find((i) => i.id === a.issueId);
			if (issue) answer(issue);
			return json(200, a);
		}
		const one = url.pathname.match(/^\/api\/issues\/([^/]+)(\/comments|\/read|\/attachments)?$/);
		if (!one) return null;
		const issue = issues.find((i) => i.id === one[1]);
		if (!issue) return json(404, { error: 'Issue not found' });
		if (!one[2] && method === 'GET') return json(200, served(issue));
		if (one[2] === '/attachments' && method === 'GET') return json(200, files.filter((a) => a.issueId === issue.id));
		if (one[2] === '/read' && method === 'POST') return json(200, { ok: true });
		if (one[2] === '/comments' && method === 'GET') {
			const all = visible(issue.id as string);
			const desc = url.searchParams.get('order') === 'desc';
			const ordered = desc ? [...all].reverse() : all;
			const limit = Number(url.searchParams.get('limit')) || ordered.length;
			return json(200, ordered.slice(0, limit));
		}
		if (one[2] === '/comments' && method === 'POST') {
			if (typeof b.body !== 'string' || !b.body.trim()) return json(422, { error: 'A comment needs a body.' });
			const c = comment(issue.id as string, b.body, now(), null);
			if (Array.isArray(b.attachmentIds)) for (const a of files) if (a.issueId === issue.id && b.attachmentIds.includes(a.id)) a.issueCommentId = c.id;
			if (b.reopen) issue.status = 'todo';
			answer(issue, !!issue.conversationAgentId && b.body.trim() === '/new');
			if (issue.conversationAgentId) ask(issue, b.body, now() + delay);
			return json(201, c);
		}
		return json(404, { error: 'This item is not available in the demo.' });
	};
	return { handle, addIssue };
}

/**
 * A fetch that serves the poller's endpoints from snapshots. Each agents request moves on to
 * the next snapshot; the badges request in the same tick reads the same one. A snapshot's
 * session is played back as the failure that causes it (redirect, 401, 503).
 *
 * Issues and comments are served too (see mockIssues), so the chat works against the mock.
 *
 * @param snapshots Source of snapshots, e.g. mockSnapshots(seed).
 * @param opts Options for the issues and comments.
 * @returns Fetch implementation for createPoller and the chat.
 */
export function mockFetch(snapshots: Iterable<Snapshot> | Iterator<Snapshot>, opts: MockOptions = {}): FetchLike {
	const issueServer = mockIssues(opts);
	const now = opts.now ?? Date.now;
	const started = now();
	const board = mockBoard(opts, issueServer.addIssue, started);
	const ministry = opts.ministry ?? true;
	if (ministry) {
		issueServer.addIssue(LEDGER_TITLE, 'Tribunal threshold: 3 live strikes\n\n| agent | agent id | date | finding | evidence link | expires | status |\n|---|---|---|---|---|---|---|', agentId(5));
		issueServer.addIssue(LESSONS_TITLE, 'The Lessons of the Tribunal are kept in the "lessons" document.', agentId(5));
	}
	const it: Iterator<Snapshot> = Symbol.iterator in snapshots ? (snapshots as Iterable<Snapshot>)[Symbol.iterator]() : snapshots as Iterator<Snapshot>;
	let current: Snapshot | null = null;
	/**
	 * Advance to the next snapshot, holding the last one if the source runs dry.
	 *
	 * @returns Current snapshot.
	 */
	const next = (): Snapshot | null => { const r = it.next(); if (!r.done) current = r.value; return current; };
	/**
	 * The failure response a non-ok session stands for.
	 *
	 * @param s Snapshot.
	 * @returns Response-like, or null when the session is ok.
	 */
	const failure = (s: Snapshot | null): ResponseLike | null => {
		if (!s || s.session === 'ok') return null;
		if (s.session === 'access-lapsed') return { type: 'opaqueredirect', status: 0, ok: false, text: async () => '' };
		return json(s.session === 'signed-out' ? 401 : 503, { error: s.session === 'signed-out' ? 'The demo session has expired. It will reconnect shortly.' : 'The demo is temporarily unavailable. It will retry shortly.' });
	};
	const base = `/api/companies/${MOCK_COMPANY_ID}`;
	return async (input: string, init?: RequestInit) => {
		const method = (init?.method ?? 'GET').toUpperCase();
		if (input.startsWith('/api/approvals/') || input.startsWith('/api/agents/') || input.startsWith(`${base}/approvals`) || input.startsWith(`${base}/activity`) || input.startsWith(`${base}/heartbeat-runs`)) {
			const lapse = failure(current);
			if (lapse) return lapse;
			const r = board.handle(method, input, now());
			if (r) return r;
		}
		if (input.startsWith('/api/issues/') || input.startsWith(`${base}/issues`) || input.startsWith(`${base}/chats/`)) {
			// The chat's requests fail the same way the roster's do while the mock session lapses.
			const lapse = failure(current);
			if (lapse) return lapse;
			let body: unknown = null;
			if (typeof FormData !== 'undefined' && init?.body instanceof FormData) body = init.body;
			else try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { return json(400, { error: 'The body is not JSON.' }); }
			const r = issueServer.handle(method, input, body);
			if (r) return r;
		}
		if (input === '/api/companies') return json(200, [{ id: MOCK_COMPANY_ID, name: MOCK_COMPANY_NAME }]);
		if (input === `${base}/routines` && method === 'GET') {
			return json(200, ministry ? [{ id: '00000000-0000-4000-8005-000000000001', companyId: MOCK_COMPANY_ID, title: ROUTINE_TITLE, assigneeAgentId: agentId(5), status: 'active' }] : []);
		}
		if (input === '/api/auth/get-session') return json(200, { session: { id: 'mock-session', userId: MOCK_USER_ID }, user: { id: MOCK_USER_ID, name: 'The Owner' } });
		if (input === `${base}/agents`) {
			const s = next();
			// A company without the Ministry has no Director either: the Enforcer is just a cleaner there.
			const agents = ministry ? s?.agents ?? [] : (s?.agents ?? []).map((x) => (x.name === 'State Enforcer' ? { ...x, name: 'Comrade Mop' } : x));
			return failure(s) ?? json(200, board.roster(agents, now()));
		}
		if (input === `${base}/sidebar-badges`) {
			const s = current ?? next();
			return failure(s) ?? json(200, s?.badges ?? {});
		}
		return json(404, { error: 'This item is not available in the demo.' });
	};
}

/** Ids the mock uses for people who are not on the generated roster. */
export const MOCK_EXTRA = {
	/** The new comrade in the hire scenario. */
	recruit: '00000000-0000-4000-8000-000000000101',
	/** Departed while the cockpit was closed: terminated. */
	purged: '00000000-0000-4000-8000-000000000102',
	/** Departed while the cockpit was closed: deleted outright. */
	vanished: '00000000-0000-4000-8000-000000000103',
	/** More terminated comrades, for the purge scenario (over the replay cap). */
	purgedMore: ['00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000106'],
	/** The owner's own manual seat, in the personnel scenario. */
	seat: '00000000-0000-4000-8000-000000000107',
};

/**
 * A night's activity for the pravda scenario, newest first, as Paperclip records it: with the
 * secret and environment rows the paper must never print mixed in.
 *
 * @param started When the mock started, epoch ms.
 * @returns Activity records.
 */
function feed(started: number): Record<string, unknown>[] {
	const rows: Record<string, unknown>[] = [];
	let k = 0;
	/**
	 * One record, a few minutes older than the last.
	 *
	 * @param action Action.
	 * @param actor Agent id, or null for a board user.
	 * @param entityId Entity id.
	 * @param details Details.
	 */
	const add = (action: string, actor: string | null, entityId: string, details: Record<string, unknown>): void => {
		k++;
		rows.push({ id: `00000000-0000-4000-8006-${String(k).padStart(12, '0')}`, companyId: MOCK_COMPANY_ID, actorType: actor ? 'agent' : 'user', actorId: actor ?? MOCK_USER_ID, action, entityType: action.split('.')[0], entityId, agentId: actor, details, createdAt: new Date(started - k * 23 * 60_000).toISOString() });
	};
	const issue = (n: number) => `00000000-0000-4000-8007-${String(n).padStart(12, '0')}`;
	add('secret.access.listed', agentId(4), issue(90), { secretName: 'MOCK_SECRET=never-show-this' });
	for (let n = 1; n <= 5; n++) add('issue.updated', agentId(n <= 3 ? 1 : 3), issue(n), { status: 'done', identifier: `PLT-${10 + n}`, _previous: { status: 'in_progress' } });
	add('environment.lease_acquired', agentId(1), issue(91), { token: 'MOCK_SECRET=never-show-this' });
	add('issue.updated', agentId(2), issue(6), { status: 'blocked', identifier: 'PLT-16' });
	for (let n = 7; n <= 10; n++) add('issue.created', agentId(1), issue(n), { title: `Five-year-plan task number ${n}`, identifier: `PLT-${10 + n}`, status: 'todo' });
	add('issue.comment_added', agentId(2), issue(6), { identifier: 'PLT-16', issueTitle: 'Review the pricing page', bodySnippet: 'MOCK_SECRET=never-show-this, pasted in a reply.' });
	add('agent.terminated', null, MOCK_EXTRA.purged, { cancellation: {} });
	add('approval.approved', null, '00000000-0000-4000-8003-000000000099', { type: 'hire_agent' });
	// A hire an agent files, as Paperclip logs it (the board's own create is agent.created).
	add('agent.hire_created', agentId(0), agentId(8), { name: 'Night Shift Welder', role: 'general' });
	add('approval.created', agentId(1), '00000000-0000-4000-8003-000000000098', { type: 'request_board_approval' });
	return rows;
}

/** How long a status the board stamped holds before the mock's drift takes the comrade back. */
const FORCED_MS = 90_000;

/** How long a woken comrade stays on shift in the mock. */
const WAKE_MS = 8_000;

/** Fields the personnel scenario and board stamps pin on a comrade. */
type Pinned = Pick<AgentState, 'status' | 'errorReason' | 'pauseReason'> & { pausedAt: string | null; until: number };

/**
 * The mock's board: approvals (a tribunal, a hire), terminations, and what became of departed
 * agents. It edits the roster the snapshots produce: terminated agents drop out, a hire joins.
 *
 * @param opts Options.
 * @param addIssue Files an issue in the mock (for the Director's report).
 * @param started When the mock started, epoch ms.
 * @returns Request handler and roster filter.
 */
function mockBoard(opts: MockOptions, addIssue: (title: string, description: string, assignee: string | null) => string, started: number) {
	const approvals: Record<string, unknown>[] = [];
	const terminated = new Set<string>();
	const pinned = new Map<string, Pinned>();
	let lastRoster: AgentState[] = [];
	let recruitStatus: string | null = null;
	let seq = 0;
	/**
	 * A fresh approval id.
	 *
	 * @returns UUID-shaped id.
	 */
	const aid = (): string => `00000000-0000-4000-8003-${String(++seq).padStart(12, '0')}`;
	const accused = agentId(3);
	if (opts.scenario === 'tribunal') {
		const report = addIssue('Daily Operational Hygiene Review', 'Findings: three live strikes for Shock Worker No. 3 (tests skipped twice, a broken form published).', agentId(5));
		approvals.push({
			id: aid(), type: 'request_board_approval', status: 'pending', requestedByAgentId: agentId(5), issueIds: [report],
			payload: {
				tribunal: true, agentId: accused, agentName: 'Shock Worker No. 3', strikes: 3, probation: false, reportIssueId: report,
				charge: 'Shipped work without running the tests, three times in eleven days.',
				strikeList: [
					{ date: '2026-09-12', finding: 'Merged a pricing change with failing tests.', serious: false },
					{ date: '2026-09-18', finding: 'Closed an issue as done without the checklist.', serious: false },
					{ date: '2026-09-22', finding: 'Published a page with a broken form, breaking a standing Lesson of the plant.', serious: true },
				],
			},
		});
	}
	if (opts.scenario === 'dossier') {
		// One filed by an agent (it lands on them), one filed by a board user (it lands on the Company Lead).
		approvals.push({
			id: aid(), type: 'request_board_approval', status: 'pending', requestedByAgentId: agentId(1), createdAt: new Date(started - 3_600_000).toISOString(),
			payload: {
				title: 'Buy a second anvil for the Production Floor',
				summary: 'The Plan cannot be fulfilled with one anvil. A second one doubles output on the night shift.',
				costUsd: 1200, recommendation: 'Approve before Friday.',
				plan: { weeks: 2, owner: 'Comrade Planner', risk: 'The floor may need reinforcing.' },
			},
		});
		approvals.push({
			id: aid(), type: 'relocate_canteen', status: 'pending', requestedByAgentId: null, requestedByUserId: 'mock-other-board-user', createdAt: new Date(started - 600_000).toISOString(),
			payload: { from: 'Ground floor', to: 'Roof', reason: 'Fresh air for the workers.', votes: ['for', 'for', 'against'] },
		});
	}
	if (opts.scenario === 'personnel') {
		pinned.set(accused, { status: 'error', errorReason: 'Issue PLT-7 expected a git workspace.', pauseReason: null, pausedAt: null, until: Infinity });
	}
	/**
	 * Recent runs for a comrade, newest first, made up from their id so they stay put.
	 *
	 * @param id Agent id.
	 * @param at Now.
	 * @param limit Most to return.
	 * @returns Run records, with the output fields Paperclip sends that the plant must not show.
	 */
	const runsOf = (id: string, at: number, limit: number): Record<string, unknown>[] => {
		const k = parseInt(id.slice(-4), 16) || 1;
		const out: Record<string, unknown>[] = [];
		const p = pinned.get(id);
		for (let i = 0; i < Math.min(limit, 5); i++) {
			const start = at - (i + 1) * (37 + ((k * (i + 3)) % 90)) * 60_000;
			const failed = (i === 0 && p?.status === 'error') || (k + i) % 4 === 0;
			out.push({
				id: `00000000-0000-4000-8004-${String(k * 10 + i).padStart(12, '0')}`, agentId: id, status: failed ? 'failed' : 'succeeded',
				startedAt: new Date(start).toISOString(), finishedAt: new Date(start + (2 + ((k + i) % 25)) * 60_000).toISOString(),
				error: failed ? (p?.errorReason ?? 'The run hit its time limit.') : null,
				stdoutExcerpt: 'MOCK_SECRET=never-show-this', usageJson: { tokens: 1234 },
			});
		}
		return out;
	};
	/**
	 * Apply a board stamp to a comrade, as Paperclip would.
	 *
	 * @param id Agent id.
	 * @param action Path word.
	 * @param at Now.
	 * @returns Response.
	 */
	const stamp = (id: string, action: string, at: number): ResponseLike => {
		const a = lastRoster.find((x) => x.id === id);
		if (!a) return json(404, { error: 'Agent not found' });
		const until = at + FORCED_MS;
		if (action === 'pause') {
			pinned.set(id, { status: 'paused', errorReason: a.errorReason, pauseReason: 'manual', pausedAt: new Date(at).toISOString(), until });
		} else if (action === 'resume') {
			pinned.set(id, { status: 'idle', errorReason: a.errorReason, pauseReason: null, pausedAt: null, until });
		} else if (action === 'clear-error') {
			if (a.status !== 'error') return json(409, { error: 'Only agents in error status can have their error cleared' });
			pinned.set(id, { status: 'idle', errorReason: null, pauseReason: null, pausedAt: null, until });
		} else {
			if (a.status === 'paused') return json(202, { status: 'skipped', reason: 'wakeup_skipped', message: 'Wakeup was skipped.' });
			pinned.set(id, { status: 'running', errorReason: null, pauseReason: null, pausedAt: null, until: at + WAKE_MS });
			return json(202, { id: `00000000-0000-4000-8005-${String(at % 1e9).padStart(12, '0')}`, status: 'queued', agentId: id });
		}
		return json(200, { id, status: pinned.get(id)?.status });
	};
	return {
		/**
		 * The roster as the board has left it.
		 *
		 * @param agents Generated roster.
		 * @param at Now.
		 * @returns Agents.
		 */
		roster(agents: AgentState[], at: number): AgentState[] {
			const out = agents.filter((a) => !terminated.has(a.id)).map((a) => {
				const p = pinned.get(a.id);
				if (p && p.until <= at) pinned.delete(a.id);
				return p && p.until > at ? { ...a, status: p.status, errorReason: p.errorReason, pauseReason: p.pauseReason } : { ...a };
			});
			if (opts.scenario === 'personnel') {
				out.push({ id: MOCK_EXTRA.seat, name: 'Chairman (Manual Seat)', title: 'Manual seat', role: null, status: 'paused', pauseReason: 'manual', errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: 'mock-seat' });
			}
			lastRoster = out;
			if (opts.scenario === 'hire' && at - started >= (opts.hireDelayMs ?? 6_000)) {
				if (recruitStatus === null) {
					recruitStatus = 'pending_approval';
					approvals.push({ id: aid(), type: 'hire_agent', status: 'pending', payload: { agentId: MOCK_EXTRA.recruit, name: 'Fresh Recruit', title: 'Generalist Executor', role: 'engineer', capabilities: 'Replaces Shock Worker No. 3. Must run the tests before shipping anything.' } });
				}
				if (recruitStatus !== 'terminated') {
					out.push({ id: MOCK_EXTRA.recruit, name: 'Fresh Recruit', title: 'Generalist Executor', role: 'engineer', status: recruitStatus, pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: agentId(0), urlKey: 'mock-recruit' });
				}
			}
			return out;
		},
		/**
		 * Serve an approvals or agents request.
		 *
		 * @param method HTTP method.
		 * @param path Path.
		 * @param at Now.
		 * @returns Response, or null when the path is not the board's.
		 */
		handle(method: string, path: string, at: number): ResponseLike | null {
			const url = new URL(path, 'http://mock');
			if (url.pathname === `/api/companies/${MOCK_COMPANY_ID}/approvals` && method === 'GET') {
				return json(200, approvals.filter((a) => a.status === (url.searchParams.get('status') ?? 'pending')));
			}
			const ap = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject|request-revision)$/);
			if (ap && method === 'POST') {
				const a = approvals.find((x) => x.id === ap[1]);
				if (!a) return json(404, { error: 'Approval not found' });
				if (a.status !== 'pending') return json(409, { error: 'Approval is already resolved' });
				a.status = ap[2] === 'approve' ? 'approved' : ap[2] === 'reject' ? 'rejected' : 'revision_requested';
				a.decidedAt = new Date().toISOString();
				a.decidedByUserId = MOCK_USER_ID;
				const p = a.payload as Record<string, unknown>;
				if (a.type === 'hire_agent') recruitStatus = ap[2] === 'approve' ? 'idle' : 'terminated';
				if (a.type === 'hire_agent' && ap[2] === 'reject') terminated.add(String(p.agentId));
				return json(200, a);
			}
			if (url.pathname === `/api/companies/${MOCK_COMPANY_ID}/activity` && method === 'GET' && !url.searchParams.get('entityId')) {
				return json(200, opts.scenario === 'pravda' ? feed(started) : []);
			}
			if (url.pathname === `/api/companies/${MOCK_COMPANY_ID}/activity` && method === 'GET') {
				// The server's record of who created each approval: the Director, linking the report.
				const a = approvals.find((x) => x.id === url.searchParams.get('entityId'));
				return json(200, a ? [{ action: 'approval.created', entityType: 'approval', entityId: a.id, actorType: a.requestedByUserId ? 'user' : 'agent', actorId: a.requestedByUserId ?? a.requestedByAgentId ?? agentId(0), details: { type: a.type, issueIds: a.issueIds ?? [] } }] : []);
			}
			const links = url.pathname.match(/^\/api\/approvals\/([^/]+)\/issues$/);
			if (links && method === 'GET') {
				const a = approvals.find((x) => x.id === links[1]);
				return a ? json(200, ((a.issueIds as string[] | undefined) ?? []).map((id) => ({ id }))) : json(404, { error: 'Approval not found' });
			}
			const one0 = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
			if (one0 && method === 'GET') {
				const a = approvals.find((x) => x.id === one0[1]);
				return a ? json(200, a) : json(404, { error: 'Approval not found' });
			}
			const term = url.pathname.match(/^\/api\/agents\/([^/]+)\/terminate$/);
			if (term && method === 'POST') { terminated.add(term[1]); return json(200, { id: term[1], status: 'terminated' }); }
			const act = url.pathname.match(/^\/api\/agents\/([^/]+)\/(pause|resume|clear-error|wakeup)$/);
			if (act && method === 'POST') return stamp(act[1], act[2], at);
			if (url.pathname === `/api/companies/${MOCK_COMPANY_ID}/heartbeat-runs` && method === 'GET') {
				const who = url.searchParams.get('agentId');
				return json(200, who ? runsOf(who, at, Number(url.searchParams.get('limit')) || 5) : []);
			}
			const one = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
			if (one && method === 'GET') {
				const id = one[1];
				if (terminated.has(id) || id === MOCK_EXTRA.purged || MOCK_EXTRA.purgedMore.includes(id)) return json(200, { id, status: 'terminated' });
				if (id === MOCK_EXTRA.vanished) return json(404, { error: 'Agent not found' });
				const a = lastRoster.find((x) => x.id === id);
				if (!a) return json(200, { id, status: 'idle' });
				const k = parseInt(id.slice(-4), 16) || 1;
				// The real record carries adapter configuration; the plant must never copy it out.
				return json(200, {
					...a, pausedAt: (pinned.get(id)?.until ?? 0) > at ? pinned.get(id)?.pausedAt ?? null : null, lastHeartbeatAt: a.lastHeartbeatAt ?? new Date(at - k * 7 * 60_000).toISOString(),
					budgetMonthlyCents: k % 3 === 0 ? 0 : 5000, spentMonthlyCents: (k * 1337) % 5200,
					adapterConfig: { apiKey: 'MOCK_SECRET=never-show-this' }, runtimeConfig: { env: { TOKEN: 'MOCK_SECRET=never-show-this' } },
				});
			}
			return null;
		},
	};
}
