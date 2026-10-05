/**
 * The ceremonies: turns roster changes and pending approvals into scenes, and draws
 * their effects. It owns the director (scenes.ts), the train and doors (trainyard.ts), the
 * board's windows (verdict.ts), the stamps that fall over comrades, the airbrush fade and the
 * group photo.
 *
 * - Someone joins: they arrive by train (and wait at the desk if their hire needs you).
 * - Someone leaves: the plant asks Paperclip what became of them. Terminated means a short trial
 *   and the airbrush; anything else, they board the train quietly.
 * - A tribunal referral is pending: the court assembles and waits for your verdict.
 * - While the plant was closed: the last roster seen is kept in localStorage, and the difference
 *   is played back on opening, at most REPLAY_CAP ceremonies; the rest go in a notice.
 */
import type { Sprite } from 'pixi.js';
import type { Actor } from '../art/scene';
import { type HireRequest, type TribunalCase, approvalOrigin, approvalState, fate, toApprovals } from '../live/approvals';
import { UUID, request } from '../live/http';
import type { FetchLike } from '../live/http';
import { companyLead, personaOf } from '../live/personas';
import type { AgentState, Snapshot } from '../live/types';
import type { World } from '../world/types';
import { groupPhotoBitmap, paintGroupPhoto, photoQuad } from '../world/zones';
import { type Crew, type CrewChange, inScene } from './crew';
import { bitmapCanvas, el } from './dom';
import { type Verdict, arrival, departure, trial, tribunal } from './plays';
import { readRoster, saveRoster } from './remembered';
import { type Scene, createDirector } from './scenes';
import type { Stage } from './stage';
import { type Trainyard, createTrainyard } from './trainyard';
import { createBoard } from './verdict';

/** localStorage keys, namespaced because the extension shares Paperclip's origin. */
const UNPERSONED_KEY = 'plant67.unpersoned';
const CONVICTED_KEY = 'plant67.convicted';
/** How far back, on opening, a verdict given in the dashboard is still offered for finishing. */
const ADOPT_WINDOW_MS = 14 * 86_400_000;
/** Most airbrushed names remembered for the photo's list. */
const UNPERSONED_MAX = 60;

/** One airbrushed comrade. */
interface Unperson { name: string; date: string }

export interface CeremonyDeps {
	world: World;
	crew: Crew;
	stage: Stage;
	fetchImpl: FetchLike;
	/** World pixels to a point in the cockpit, CSS pixels. */
	toScreen(p: { x: number; y: number }): { x: number; y: number };
	/** Glide the camera to a world pixel. */
	glideTo(p: { x: number; y: number }): void;
	/** Feet of a comrade in world pixels. */
	feet(id: string): { x: number; y: number } | null;
	/** Something happened worth a sound: trainIn, trainOut, airbrush, or verdict. */
	onFx?(name: 'trainIn' | 'trainOut' | 'airbrush' | 'verdict'): void;
	/** What waits on the owner changed (a tribunal opened, decided or gone). */
	onWaiting?(): void;
	/** The train, for tests that run without a renderer (defaults to the real one). */
	yard?: Pick<Trainyard, 'arrive' | 'leave' | 'tick' | 'sortable'>;
}

export interface Ceremonies {
	/** Elements to add to the cockpit root. */
	els: HTMLElement[];
	/** Tribunals awaiting a verdict, and whether one of them is a guilty verdict left unfinished. */
	tribunals(): { count: number; unfinished: boolean };
	/**
	 * Glide to a waiting tribunal and open its case.
	 *
	 * @param k Which, counting from 0 (wraps): unfinished verdicts first.
	 */
	openTribunal(k: number): void;
	/** Newcomers whose hire waits for the owner, by agent id. */
	hiresWaiting(): string[];
	/** Call before crew.apply with a good snapshot: keeps leavers on stage for their departure. */
	beforeApply(s: Snapshot): void;
	/** Call after crew.apply with a good snapshot. */
	afterApply(s: Snapshot, change: CrewChange, first: boolean): void;
	tick(dt: number): void;
	/** Things besides comrades and props to depth-sort (the train). */
	extras(): { actor: Actor; sprite: Sprite }[];
	/**
	 * A click on a comrade (or on nothing, at a world point).
	 *
	 * @returns True when a ceremony handled it (a verdict or hire window, the photo).
	 */
	click(id: string | null, at: { x: number; y: number }): boolean;
	/** True while a window of the board is open. */
	readonly blocking: boolean;
	/** Close whatever the board has open. */
	escape(): boolean;
	/** The tab came back into view: fold a long backlog into a notice. */
	onVisible(): void;
	/** Scene ids, running then queued, for the dev handle and the tests. */
	scenes(): string[];
	/** Drop a stamp's word over a comrade, as a verdict does (a dossier decided). */
	stampOver(id: string, word: string, tone: 'red' | 'green' | 'amber'): void;
}

/**
 * Read JSON from localStorage, or a fallback when storage is missing or holds junk.
 *
 * @param key Key.
 * @param fallback Value when nothing usable is stored.
 * @returns Parsed value.
 */
function load<T>(key: string, fallback: T): T {
	try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

/**
 * Write JSON to localStorage, ignoring storage that refuses.
 *
 * @param key Key.
 * @param v Value.
 */
function save(key: string, v: unknown): void {
	try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* It just won't survive a reload. */ }
}

/**
 * Whether a point is inside a convex quad.
 *
 * @param q Corners in order.
 * @param x X.
 * @param y Y.
 * @returns True inside.
 */
function inQuad(q: [number, number][], x: number, y: number): boolean {
	let sign = 0;
	for (let k = 0; k < q.length; k++) {
		const [ax, ay] = q[k], [bx, by] = q[(k + 1) % q.length];
		const c = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
		if (!c) continue;
		if (!sign) sign = c;
		else if (c !== sign) return false;
	}
	return true;
}

/**
 * Set up the ceremonies.
 *
 * @param d Dependencies.
 * @returns Ceremonies.
 */
export function createCeremonies(d: CeremonyDeps): Ceremonies {
	const { world, crew, stage } = d;
	const scene = world.scene;
	const yard = d.yard ?? createTrainyard(stage, scene);
	let last: Snapshot | null = null;
	/** Verdicts carried out here, by approval id. */
	const verdicts = new Map<string, 'guilty' | 'pardoned'>();
	/** Hires decided here, by agent id. */
	const hired = new Map<string, 'approved' | 'refused'>();
	/** Cases seen, by approval id (kept after the snapshot drops them, for a retry). */
	const cases = new Map<string, TribunalCase>();
	/** Leavers held before apply, waiting for Paperclip to say what became of them. */
	const leaving: AgentState[] = [];
	/** Comrades found guilty here: never tried a second time when they leave the roster, even after a reload. */
	const convicted = new Set<string>(load<unknown[]>(CONVICTED_KEY, []).filter((x): x is string => typeof x === 'string' && UUID.test(x)));
	/** Unfinished verdicts whose agent is being looked up, so the lookup is not repeated. */
	const pruning = new Set<string>();
	let warnedNoDirector = false;
	let warnedTwoDirectors = false;
	/** Referrals whose filing record Paperclip has confirmed (true) or refuted (false), by approval id. */
	const filedByDirector = new Map<string, boolean>();
	/** Referrals heard on the last snapshot, to notice one decided elsewhere. */
	let heardBefore = new Map<string, TribunalCase>();
	let lookedForApproved = false;
	/** Cases the owner has opened, so their court assembles. */
	const opened = new Set<string>();
	let unpersoned = load<Unperson[]>(UNPERSONED_KEY, []).filter((u) => u && typeof u.name === 'string');
	paintGroupPhoto(scene.base, unpersoned.length);
	stage.refreshBase();
	const photo = photoQuad(scene.base);

	// DOM: effects over comrades, the notice, the photo close-up and list.
	const fxLayer = el('div', 'p67-fx');
	const notice = el('div', 'p67-notice');
	notice.hidden = true;
	notice.setAttribute('role', 'status');
	const noticeText = el('p');
	const noticeClose = el('button', 'p67-close', '×');
	noticeClose.type = 'button';
	noticeClose.setAttribute('aria-label', 'Close the notice');
	noticeClose.addEventListener('click', () => { notice.hidden = true; });
	notice.append(noticeClose, noticeText);
	const photoBox = el('section', 'p67-photo');
	photoBox.hidden = true;
	photoBox.setAttribute('role', 'dialog');
	photoBox.setAttribute('aria-label', 'The group photo');

	const board = createBoard({
		fetchImpl: d.fetchImpl,
		onTribunal: (id, v) => {
			verdicts.set(id, v);
			d.onFx?.('verdict');
			const c = cases.get(id) ?? board.unfinishedCases().find((x) => x.approvalId === id);
			if (v === 'guilty' && c) { convicted.add(c.agentId); save(CONVICTED_KEY, [...convicted].slice(-50)); }
			tellWaiting();
		},
		// Closed without a verdict: the court rises until the case is opened again.
		onClose: (id) => { opened.delete(id); tellWaiting(); },
		onHire: (approvalId, v) => {
			const h = last?.approvals?.hires.find((x) => x.approvalId === approvalId);
			if (h) hired.set(h.agentId, v);
		},
	});

	/** Stamps falling over comrades: which comrade, the element, and time left. */
	const stamps: { id: string; e: HTMLElement; t: number }[] = [];
	/** Airbrushings in progress: comrade id and time spent. */
	const fades = new Map<string, number>();
	let photoT = 0;

	/**
	 * Show a sentence at the top of the plant.
	 *
	 * @param text Sentence(s).
	 */
	const say = (text: string): void => {
		noticeText.textContent = text;
		notice.hidden = false;
	};

	/**
	 * Open the photo panel: the photo large, and who has been airbrushed from it.
	 *
	 * @param fresh The name just airbrushed, for the caption (or null to just look).
	 */
	const showPhoto = (fresh: string | null): void => {
		photoBox.replaceChildren();
		const close = el('button', 'p67-close', '×');
		close.type = 'button';
		close.setAttribute('aria-label', 'Close the photo');
		close.addEventListener('click', () => { photoBox.hidden = true; });
		const canvas = bitmapCanvas(groupPhotoBitmap(fresh ? unpersoned.length - 1 : unpersoned.length), 5);
		photoBox.append(close, el('h2', '', 'The collective'), canvas);
		if (fresh) {
			photoBox.append(el('p', 'p67-photo-cap', `${fresh} has been airbrushed from the record.`));
			// The scratch lands a beat after the photo appears.
			setTimeout(() => { canvas.replaceWith(bitmapCanvas(groupPhotoBitmap(unpersoned.length), 5)); }, 700);
			photoT = 3_400;
		} else {
			const list = el('ol', 'p67-unpersons');
			for (const u of [...unpersoned].reverse()) list.append(el('li', '', `${u.name}, airbrushed ${u.date}.`));
			photoBox.append(unpersoned.length ? list : el('p', 'p67-photo-cap', 'Nobody has been airbrushed from this photo yet.'));
			photoT = 0;
		}
		photoBox.hidden = false;
	};

	/**
	 * Add comrades to the airbrushed record and scratch them out of the photo on the wall.
	 *
	 * @param names Their names.
	 */
	const record = (names: string[]): void => {
		// Another plant tab may have added names since: start from what is stored now.
		unpersoned = load<Unperson[]>(UNPERSONED_KEY, unpersoned).filter((u) => u && typeof u.name === 'string');
		const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
		unpersoned = [...unpersoned, ...names.map((name) => ({ name, date }))].slice(-UNPERSONED_MAX);
		save(UNPERSONED_KEY, unpersoned);
		paintGroupPhoto(scene.base, unpersoned.length);
		stage.refreshBase();
	};

	/**
	 * Drop a stamp's word over a comrade.
	 *
	 * @param id Comrade id.
	 * @param word The word.
	 * @param tone Ink.
	 */
	const stampOver = (id: string, word: string, tone: 'red' | 'green' | 'amber'): void => {
		const e = el('div', `p67-fall p67-${tone}`, word);
		fxLayer.append(e);
		stamps.push({ id, e, t: 1_600 });
	};

	const director = createDirector(crew, (name, args) => {
		const id = typeof args.id === 'string' ? args.id : '';
		if (name === 'trainIn' || name === 'trainOut' || name === 'airbrush') d.onFx?.(name);
		if (name === 'trainIn') yard.arrive();
		else if (name === 'trainOut') yard.leave();
		else if (name === 'stamp') stampOver(id, String(args.word ?? ''), args.tone === 'green' ? 'green' : 'red');
		else if (name === 'airbrush') fades.set(id, 0);
		else if (name === 'photo') {
			const who = String(args.name ?? 'A comrade');
			record([who]);
			showPhoto(who);
		}
	});

	/**
	 * Whether an agent is on the latest roster.
	 *
	 * @param id Agent id.
	 * @returns True if present.
	 */
	const present = (id: string): boolean => !!last?.agents.some((a) => a.id === id);

	/**
	 * Whether a hire still waits for the board.
	 *
	 * @param id Agent id.
	 * @returns True while waiting.
	 */
	const hirePending = (id: string): boolean => {
		if (hired.get(id) === 'approved') return false;
		const a = last?.agents.find((x) => x.id === id);
		return !!a && (a.status === 'pending_approval' || !!last?.approvals?.hires.some((h) => h.agentId === id));
	};

	/**
	 * Mark a newcomer for the train: hidden now, queued once the leavers' fates are known.
	 *
	 * @param a The newcomer.
	 * @param into The list of arrivals being gathered.
	 */
	const arrive = (a: AgentState, into: AgentState[]): void => {
		if (director.has(`arr:${a.id}`) || into.some((x) => x.id === a.id)) return;
		crew.setHidden(a.id, true);
		into.push(a);
	};

	/**
	 * Ask Paperclip what became of a leaver.
	 *
	 * @param a The leaver (already held as dep:<id>).
	 * @returns Their departure or trial, or null when there is nothing to play.
	 */
	const farewell = async (a: AgentState): Promise<Scene | null> => {
		// Already tried and airbrushed here: just let them go, never a second trial.
		if (convicted.has(a.id)) { crew.release(a.id, `dep:${a.id}`); return null; }
		const f = await fate(d.fetchImpl, a.id);
		return f === 'terminated' ? trial(world, a.id, a.name) : departure(world, a.id, a.name);
	};

	/**
	 * Queue what happened in order: departures and trials first, then arrivals (so a replacement
	 * arrives after the one they replace), and on opening, fold anything past the cap into a notice.
	 *
	 * @param leavers Leavers held under dep:<id>.
	 * @param arrivals Newcomers, already hidden.
	 * @param fold Trim the backlog afterwards.
	 */
	const queueChanges = (leavers: AgentState[], arrivals: AgentState[], fold: boolean): void => {
		void Promise.all(leavers.map(farewell)).then((scenes) => {
			for (const sc of scenes) if (sc) director.enqueue(sc);
			for (const a of arrivals) director.enqueue(arrival(world, a.id, a.name, () => hirePending(a.id), () => !present(a.id)));
			if (fold) trim();
		});
	};

	/**
	 * Fold a backlog of more than REPLAY_CAP ceremonies into a notice.
	 */
	const trim = (): void => {
		const dropped = director.trimBacklog();
		if (!dropped.length) return;
		// Trials skipped in the replay still happened: those comrades are scratched out of the photo too.
		const purged = dropped.filter((s) => s.kind === 'trial').map((s) => s.who);
		if (purged.length) record(purged);
		say(`While you were away: ${dropped.map((s) => s.summary).join(' ')}`);
	};

	/**
	 * Cases waiting for the owner: verdicts left unfinished first, then open referrals.
	 *
	 * @returns Cases.
	 */
	const waitingCases = (): TribunalCase[] => [
		...board.unfinishedCases().filter((t) => present(t.agentId) && verdicts.get(t.approvalId) !== 'guilty'),
		...heard().filter((t) => !verdicts.has(t.approvalId) && !board.unfinished(t.approvalId)),
	];
	/** Tell the cockpit that what waits may have changed. */
	const tellWaiting = (): void => { d.onWaiting?.(); };
	/**
	 * Glide to a waiting case and open it.
	 *
	 * @param k Which case (wraps).
	 */
	const openTribunal = (k: number): void => {
		if (board.deciding) return;
		const open = waitingCases();
		const t = open[((k % open.length) + open.length) % open.length];
		if (!t) return;
		const dock = world.marks.dock.pos;
		const p = d.feet(t.agentId);
		d.glideTo(p ?? { x: dock[0], y: dock[1] });
		openCase(t);
	};

	/**
	 * Open the verdict window for a case.
	 *
	 * @param t Case.
	 */
	const openCase = (t: TribunalCase): void => {
		if (board.deciding) return;
		const a = last?.agents.find((x) => x.id === t.agentId);
		if (!a) return;
		// The window names whoever the roster says the id is: that is who would be terminated.
		board.showTribunal(t, { name: a.name, title: a.title ?? a.role }, async () => {
			const problem = await checkCase(t);
			// The court assembles only for a case that passed its checks.
			if (!problem && board.open) opened.add(t.approvalId);
			return problem;
		});
	};

	/**
	 * Everything that must hold before a verdict can be given here.
	 *
	 * @param t Case.
	 * @returns A sentence saying what is wrong, or null.
	 */
	const checkCase = async (t: TribunalCase): Promise<string | null> => {
		if (!present(t.agentId)) return 'The accused is no longer on the roster, so there is nothing to decide.';
		const director = enforcer();
		if (!director) return 'The plant cannot tell which agent is the Director of Operational Hygiene right now (none, or more than one, matches), so it will not act on referrals.';
		if (!t.reportIssueId) return 'This referral has no report from the Director of Operational Hygiene, so it cannot be decided here.';
		const cid = last?.companyId ?? '';
		// Paperclip's own record of who created the referral, and what they linked to it then:
		// the caller cannot set these, unlike the "requested by" field on the referral itself.
		const [origin, st] = await Promise.all([approvalOrigin(d.fetchImpl, cid, t.approvalId), approvalState(d.fetchImpl, t.approvalId)]);
		if (!origin || !st) return 'Paperclip could not confirm who filed this referral just now. Try again in a moment.';
		if (origin.actorType !== 'agent' || origin.actorId !== director) return 'Paperclip\'s own record shows this referral was not filed by the Director of Operational Hygiene, so the plant will not act on it. Check it in the dashboard.';
		if (!origin.issueIds.includes(t.reportIssueId)) return 'The Director did not link this report to the referral when filing it, so the plant will not act on it. Check it in the dashboard.';
		if (!st.tribunal || st.agentId !== t.agentId) return 'Paperclip\'s copy of this referral names someone else, so the plant will not act on it.';
		if (board.unfinished(t.approvalId) && st.status !== 'approved') return 'Paperclip does not show a guilty verdict for this referral, so there is nothing to finish. Check the approval in the dashboard.';
		return null;
	};

	/**
	 * The Director of Operational Hygiene's id, if on the roster.
	 *
	 * @returns Agent id or null.
	 */
	const enforcer = (): string | null => {
		// Exactly one: if a second agent's name or title also matches, the plant cannot tell which
		// is the real Director, so it hears no referrals at all until that is sorted out.
		const all = (last?.agents ?? []).filter((a) => personaOf(a)?.id === 'enforcer');
		if (all.length > 1 && !warnedTwoDirectors) {
			warnedTwoDirectors = true;
			say(`More than one agent looks like the Director of Operational Hygiene (${all.map((a) => a.name).join(', ')}), so the plant will not hear tribunal referrals until only one does. Rename the others in Paperclip.`);
		}
		return all.length === 1 ? all[0].id : null;
	};

	/**
	 * Referrals the plant will hear: filed by the Director, with a report, against someone on the roster.
	 *
	 * @returns Cases.
	 */
	const heard = (): TribunalCase[] => candidates().filter((t) => filedByDirector.get(t.approvalId) === true);

	/**
	 * Referrals that claim to be the Director's, with a report, against someone on the roster.
	 * The claim is only a first filter: heard() also needs Paperclip's filing record to agree.
	 *
	 * @returns Cases.
	 */
	const candidates = (): TribunalCase[] => {
		const dir = enforcer();
		return (last?.approvals?.tribunals ?? []).filter((t) => !!dir && t.requestedBy === dir && !!t.reportIssueId && present(t.agentId));
	};

	/**
	 * Ask Paperclip who really filed each new candidate; the court waits only for those the
	 * Director filed with the report linked. Unanswered checks are tried again next snapshot.
	 */
	const verifyFilings = (): void => {
		const dir = enforcer();
		const cid = last?.companyId;
		if (!dir || !cid) return;
		for (const t of candidates()) {
			if (filedByDirector.has(t.approvalId)) continue;
			filedByDirector.set(t.approvalId, false);
			void approvalOrigin(d.fetchImpl, cid, t.approvalId).then((o) => {
				if (!o) { filedByDirector.delete(t.approvalId); return; }
				filedByDirector.set(t.approvalId, o.actorType === 'agent' && o.actorId === dir && o.issueIds.includes(t.reportIssueId!));
				if (last) convene(last);
			});
		}
	};

	/**
	 * Assemble the court for each open case.
	 *
	 * @param s Snapshot.
	 */
	/**
	 * A referral may be approved in the dashboard (guilty) while its comrade stays alive: the
	 * termination never happened. Such verdicts are taken on as unfinished, after Paperclip confirms
	 * they are approved tribunals against that same comrade, so ВИНОВЕН can finish them here.
	 *
	 * @param candidates Cases that may have been decided elsewhere.
	 */
	const adoptApproved = (candidates: TribunalCase[]): void => {
		for (const t of candidates) {
			if (!t.reportIssueId || verdicts.has(t.approvalId) || board.unfinished(t.approvalId) || !present(t.agentId) || convicted.has(t.agentId)) continue;
			const dir = enforcer();
			if (!dir || !last?.companyId) continue;
			void Promise.all([approvalState(d.fetchImpl, t.approvalId), approvalOrigin(d.fetchImpl, last.companyId, t.approvalId)]).then(([st, origin]) => {
				if (!st || st.status !== 'approved' || !st.tribunal || st.agentId !== t.agentId || !present(t.agentId)) return;
				// Only a referral the Director really filed, with this report, is offered for finishing.
				if (!origin || origin.actorType !== 'agent' || origin.actorId !== dir || !origin.issueIds.includes(t.reportIssueId!)) return;
				board.adopt(t);
				if (last) convene(last);
			});
		}
	};

	const convene = (s: Snapshot): void => {
		const nowHeard = new Map(heard().map((t) => [t.approvalId, t]));
		adoptApproved([...heardBefore.values()].filter((t) => !nowHeard.has(t.approvalId) && board.deciding !== t.approvalId));
		heardBefore = nowHeard;
		// Once, on opening: verdicts given elsewhere while the plant was closed.
		if (!lookedForApproved && s.companyId && UUID.test(s.companyId)) {
			lookedForApproved = true;
			void request(d.fetchImpl, 'GET', `/api/companies/${s.companyId}/approvals?status=approved`).then((g) => {
				if (!g.ok) return;
				const dir = enforcer();
				// Recent verdicts only: an old one left unfinished was most likely left on purpose.
				const since = Date.now() - ADOPT_WINDOW_MS;
				adoptApproved(toApprovals(g.body, 'approved').tribunals.filter((t) => !!dir && t.requestedBy === dir && !!t.reportIssueId && !!t.decidedAt && Date.parse(t.decidedAt) >= since));
			});
		}
		verifyFilings();
		const directors = s.agents.filter((a) => personaOf(a)?.id === 'enforcer').length;
		if (directors === 0 && s.approvals?.tribunals.length && !warnedNoDirector) {
			warnedNoDirector = true;
			say('Tribunal referrals are waiting in Paperclip, but no Director of Operational Hygiene is on the roster, so the plant will not hear them. Decide them in the dashboard, or check the Director\'s name and title.');
		}
		// Unfinished verdicts whose comrade has gone: if Paperclip says terminated (or gone), nothing is left to finish.
		for (const u of board.unfinishedCases()) {
			if (present(u.agentId) || pruning.has(u.approvalId)) continue;
			pruning.add(u.approvalId);
			void fate(d.fetchImpl, u.agentId).then((f) => { if (f === 'terminated' || f === 'gone') board.forget(u.approvalId); pruning.delete(u.approvalId); tellWaiting(); });
		}
		for (const t of [...heard(), ...board.unfinishedCases().filter((u) => present(u.agentId))]) {
			cases.set(t.approvalId, t);
			if (verdicts.has(t.approvalId) || director.has(`trib:${t.approvalId}`)) continue;
			const name = s.agents.find((a) => a.id === t.agentId)?.name ?? t.agentName;
			director.enqueue(tribunal(world, t.approvalId, t.agentId, name,
				() => ({ judge: companyLead(last?.agents ?? [])?.id ?? null, prosecutor: enforcer() }),
				() => opened.has(t.approvalId),
				(): Verdict => verdicts.get(t.approvalId) ?? null,
				() => heard().some((x) => x.approvalId === t.approvalId) || board.deciding === t.approvalId || board.unfinished(t.approvalId),
				() => !present(t.agentId)));
		}
		tellWaiting();
	};

	return {
		els: [fxLayer, board.el, notice, photoBox],
		tribunals() {
			const open = waitingCases();
			return { count: open.length, unfinished: open.some((t) => board.unfinished(t.approvalId)) };
		},
		openTribunal,
		hiresWaiting: () => (last?.approvals?.hires ?? []).filter((h) => !hired.has(h.agentId) && present(h.agentId)).map((h) => h.agentId),
		get blocking() { return board.open || !photoBox.hidden; },
		beforeApply(s) {
			if (s.session !== 'ok') return;
			const ids = new Set(s.agents.map((a) => a.id));
			for (const c of crew.list()) {
				// Someone on a break or fidgeting is taken from it for their farewell.
				if (ids.has(c.id) || c.gone || inScene(c)) continue;
				// Held under the id their departure scene will use, so apply keeps them on stage.
				if (crew.hold(c.id, `dep:${c.id}`)) leaving.push(c.agent);
			}
		},
		afterApply(s, change, first) {
			if (s.session !== 'ok') return;
			last = s;
			const known = readRoster();
			const leavers = leaving.splice(0);
			const arrivals: AgentState[] = [];
			if (first && known && known.companyId === s.companyId) {
				const now = new Set(s.agents.map((a) => a.id));
				const kept = known.agents;
				const before = new Set(kept.map((k) => k.id));
				for (const k of kept) {
					if (now.has(k.id)) continue;
					const ghost: AgentState = { id: k.id, name: k.name, title: k.title, role: k.role, status: 'idle', pauseReason: null, errorReason: null, lastHeartbeatAt: null, reportsTo: null, urlKey: null };
					crew.ghost(ghost, `dep:${k.id}`);
					leavers.push(ghost);
				}
				for (const a of s.agents) if (!before.has(a.id)) arrive(a, arrivals);
			} else if (!first) {
				for (const id of change.arrived) { const a = s.agents.find((x) => x.id === id); if (a) arrive(a, arrivals); }
			}
			// Hires already waiting when the plant opens still come in by train to wait at the desk.
			if (first) for (const a of s.agents) if (a.status === 'pending_approval') arrive(a, arrivals);
			if (leavers.length || arrivals.length || first) queueChanges(leavers, arrivals, first);
			if (s.agents.length) saveRoster(s.companyId, s.agents);
			convene(s);
		},
		tick(dt) {
			director.step(dt);
			yard.tick(dt);
			for (const [id, t0] of fades) {
				const t = t0 + dt;
				const c = crew.get(id);
				if (!c) { fades.delete(id); continue; }
				c.alpha = Math.max(0, 1 - t / 1_300);
				if (t >= 1_300) { fades.delete(id); crew.setHidden(id, true); c.alpha = 1; } else fades.set(id, t);
			}
			for (let i = stamps.length - 1; i >= 0; i--) {
				const s = stamps[i];
				s.t -= dt;
				const p = d.feet(s.id);
				if (s.t <= 0 || !p) { s.e.remove(); stamps.splice(i, 1); continue; }
				const q = d.toScreen({ x: p.x, y: p.y - 70 });
				s.e.style.transform = `translate(${Math.round(q.x)}px, ${Math.round(q.y)}px) translate(-50%, -50%) rotate(-8deg)`;
			}
			if (photoT > 0) { photoT -= dt; if (photoT <= 0) photoBox.hidden = true; }
		},
		extras() {
			const t = yard.sortable();
			return t ? [t] : [];
		},
		click(id, at) {
			if (id) {
				if (board.deciding) return true;
				for (const t of cases.values()) {
					const scene = `trib:${t.approvalId}`;
					if (!director.has(scene) || verdicts.has(t.approvalId)) continue;
					const judge = companyLead(last?.agents ?? [])?.id;
					const pros = last?.agents.find((a) => personaOf(a)?.id === 'enforcer')?.id;
					if (id === t.agentId || id === judge || id === pros) { openCase(t); return true; }
				}
				if (board.deciding) return true;
				const h: HireRequest | undefined = last?.approvals?.hires.find((x) => x.agentId === id);
				if (h && !hired.has(id)) { board.showHire(h); return true; }
				return false;
			}
			if (inQuad(photo, at.x, at.y)) { showPhoto(null); return true; }
			return false;
		},
		escape() {
			if (board.open) { board.hide(); return true; }
			if (!photoBox.hidden) { photoBox.hidden = true; return true; }
			return false;
		},
		onVisible: trim,
		scenes: () => director.ids(),
		stampOver,
	};
}
