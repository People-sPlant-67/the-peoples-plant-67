/**
 * The cockpit: builds the plant, starts the stage, and wires the crew, camera, roster,
 * minimap, name card and "PAPERS, PLEASE" overlay to a stream of snapshots. Shared by both
 * hosts: the extension (real Paperclip, extension-entry.ts) and the dev page (mock data,
 * dev-entry.ts). Each host supplies only its poller and, for the extension, its render workers.
 */
import { type IssueHref, setIssueHref } from './links';
import { feetOnScreen } from '../art/scene';
import type { FetchLike } from '../live/http';
import { companyLead, outfitFor } from '../live/personas';
import { dossierHolder } from '../live/placement';
import type { Poller } from '../live/poller';
import type { Snapshot } from '../live/types';
import { PRI, createSpriteClient } from '../preview/sprite-client';
import { OWN_PIECES, TRACK, buildWorld } from '../world/zones';
import { createCamera, viewToWorld } from './camera';
import { createCard } from './card';
import { el } from './dom';
import { createCeremonies } from './ceremonies';
import { ME_KEY, createChat } from './chat';
import { createComradeView } from './comrades';
import { createCrew } from './crew';
import { DOSSIER_STAMPS, createDossiers } from './dossier';
import { createFrameBank } from './frames';
import { createMinimap } from './minimap';
import { createOverlay } from './overlay';
import { DEFAULT_WIRING, type Wiring, wiringNote } from './wiring';
import { BOARD_STAMPS, createPersonnel } from './personnel';
import { POSTER_ORDER, createPosters, postersFor } from './posters';
import { createPravda } from './pravda';
import { CHAIRMAN } from '../art/archetypes';
import { createMinistry, plaqueHangs } from './ministry';
import { type HostKind, hostOf } from './host';
import { REGIMES } from '../live/regimes';
import { addressOf, loadSetup } from './setup-store';
import { createWizard } from './wizard';
import { createAsksWatch } from './asks-watch';
import { createScenery } from './scenery';
import type { FixtureId } from '../world/zones';
import { createReplyWatch } from './replies';
import { createWritingWatch } from './writing';
import { createRoster } from './roster';
import { createRadio } from './radio';
import { createRadioSet } from './radio-set';
import { createSound, createSoundPanel } from './sound';
import { type Voice, createCues } from './sound-cues';
import { STAMP_EVENT } from './stamp';
import { type Backdrop, startBackdrop } from './backdrop';
import { createStage } from './stage';
import { ACTIVITY_COLOUR } from './status';
import { installStyles } from './style';
import { createTracked } from './tracked';
import { createBabushka } from './babushka';
import { CHANGING, createChanging } from './changing';
import { createPuffs } from './puffs';
import { createWardrobe, type Look } from './wardrobe';
import { createWardrobeTab } from './wardrobe-tab';
import { createFurnish } from './furnish';
import { createFurnishings } from './furnishings';
import { createLayoutStore } from './layout-store';
import { createBreaks } from './breaks';
import { createAmbient } from './ambient';
import { type Parade, createKonami, createParade } from './parade';
import { type Visitors, createVisitors } from './visitors';
import { type Wink, createWink } from './wink';
import { type Celebration, PLAN_KEY, createCelebration, createPlanWatch, dayOf } from './plan-met';
import { type Layout, settle } from '../world/layout';

export interface BootOptions {
	/** Element the cockpit fills (normally document.body). */
	root: HTMLElement;
	/**
	 * Create and start the snapshot source; the cockpit calls this once, when it is ready to draw.
	 * The company is the one chosen at setup, or null for the first listed.
	 */
	startPoller: (onSnapshot: (s: Snapshot) => void, companyId: string | null) => Poller;
	/** Builds one render worker running src/preview/sprite-worker.ts; each host knows how. */
	makeWorker: () => Worker;
	/** Fetch for the chat's reads and writes: the same one the host's poller uses. */
	fetchImpl: FetchLike;
	/** Short note about where the data comes from, e.g. "mock data": the telephone says it. */
	sourceNote?: string;
	/** Where issues open outside the plant; return null when this host has no issue pages. Defaults to Paperclip's. */
	issueHref?: IssueHref;
	/**
	 * Who the plant draws from (see host.ts): 'paperclip' (company, own seat, the Ministry),
	 * 'bridge' (the local npx server) or 'demo' (the made-up plant). Defaults to 'paperclip'.
	 */
	host?: HostKind;
	/** Open the founding form by itself until the owner has been through it once. Defaults to true. */
	wizardOpens?: boolean;
	/** How to wire the harnesses (the bridge): said on the plant while nobody is on the roster, with any wiring trouble. */
	wiring?: Wiring;
}

/** Timings and counters, for the dev page and the headless report. */
export interface CockpitStats {
	/** Boot to world built, ms. */
	worldMs: number;
	/** Boot to the stage running, ms. */
	stageMs: number;
	/** Boot to the first comrade frame on screen, ms, or null until then. */
	firstComradeMs: number | null;
	/** Pixi's running average frame rate. */
	fps: number;
	comrades: number;
	frames: number;
	workers: string;
	/** Camera position and zoom. */
	cam: { x: number; y: number; zoom: number };
}

export interface Cockpit {
	/** Feed a snapshot by hand, as the poller would (the dev page uses this for scripted checks). */
	inject(s: Snapshot): void;
	stats(): CockpitStats;
	/** Comrade ids, names and positions, for scripted checks. */
	crewReport(): { id: string; name: string; zone: string; activity: string; walking: boolean; anim: string; dir: string; shadowing: string | null }[];
	/** Open the name card of a comrade. */
	select(id: string | null): void;
	/** Click a comrade, as the pointer would (the court and desk answer before the name card). */
	click(id: string): void;
	/** Centre the camera on a world pixel. */
	look(x: number, y: number): void;
	/** Play one sound effect (after the first click or key press), to hear it by name. */
	play(v: Voice): void;
	/** Whether sound has started, and the audio context's state. */
	soundState(): { unlocked: boolean; state: string | null };
	/** The radio: on, heard, and the tune playing. */
	radioState(): { on: boolean; audible: boolean; playing: string | null };
	/** Switch the radio on or off, as its box in the sound panel does. */
	clickRadio(): void;
	/**
	 * Click a fixture in the director's office, as the pointer would.
	 *
	 * @param id Fixture.
	 */
	openFixture(id: FixtureId): void;
	/**
	 * Dress a comrade in a look and send them to change, as Keep on the Wardrobe tab does.
	 *
	 * @param id Comrade.
	 * @param look The look, or null for their own.
	 */
	keepLook(id: string, look: Look | null): void;
	/** Who is changing or waiting to, and whether the attendant has turned away. */
	changingState(): { ids: string[]; away: boolean; outfits: Record<string, string> };
	/** The fixtures and posters: what is outlined, whether the telephone rings, the open note, the posters up. */
	sceneryState(): { active: FixtureId | null; ringing: boolean; note: FixtureId | null; posters: string[]; unrolled: string | null };
	/** Comrades writing an answer in their Agent Chat (the "…" bubble). */
	writingState(): string[];
	/** The wasteland behind the plant: baked yet, and how long it took (ms). */
	backdropState(): { done: boolean; ms: number | null; how: 'worker' | 'page' | null };
	/** The plant come alive: who is on which break, and the pigeons, far train and smoke. */
	aliveState(): { breaks: Record<string, string>; ambient: { sat: number; away: number; train: number | null; puffs: number } };
	/** The easter eggs: the parade, Sputnik and the bear, the wink, the plan fulfilled. */
	eggsState(): { parade: ReturnType<Parade['state']>; visitors: ReturnType<Visitors['state']>; wink: ReturnType<Wink['state']>; plan: ReturnType<Celebration['state']> };
	/** Set an easter egg off now, for checks (the parade as if the code were typed, the plan as if just met). */
	egg(which: 'parade' | 'sputnik' | 'bear' | 'plan'): void;
	/** Furnishing: open or not, what is held and why it will not go, and the layout shown. */
	furnishState(): ReturnType<ReturnType<typeof createFurnish>['state']> & { layout: Layout };
}

/** sessionStorage flag: the plant was reloaded for a new company with the founding form open. */
const REOPEN_KEY = 'plant67.reopenForm';

/** localStorage key for the edge-scroll setting. The extension runs on Paperclip's origin, so the key is namespaced. */
const EDGE_KEY = 'plant67.edgeScroll';

/**
 * Read the edge-scroll setting. Storage can be unavailable (privacy settings), so failures read as off.
 *
 * @returns Whether edge scrolling is on.
 */
function loadEdge(): boolean {
	try { return localStorage.getItem(EDGE_KEY) === '1'; } catch { return false; }
}

/**
 * Save the edge-scroll setting, ignoring storage that refuses.
 *
 * @param on Whether edge scrolling is on.
 */
function saveEdge(on: boolean): void {
	try { localStorage.setItem(EDGE_KEY, on ? '1' : '0'); } catch { /* The setting just won't survive a reload. */ }
}

/**
 * Wait for the browser to paint, so a "building" message shows before a long synchronous job.
 * A background tab gets no animation frames at all, and there is nothing to show there, so
 * it does not wait (otherwise a cockpit opened in a background tab would not start building
 * until it was looked at).
 *
 * @returns Resolves after the next frame, or at once in a hidden tab.
 */
function nextPaint(): Promise<void> {
	if (document.hidden) return Promise.resolve();
	return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

/**
 * Boot the cockpit into a root element.
 *
 * @param o Options.
 * @returns Handle for scripted checks.
 */
export async function boot(o: BootOptions): Promise<Cockpit> {
	const t0 = performance.now();
	setIssueHref(o.issueHref ?? null);
	installStyles(document);
	const root = el('div', 'p67-root');
	const stageEl = el('div', 'p67-stage');
	const booting = el('div', 'p67-boot', 'The plant is being built. This takes about a second.');
	root.append(stageEl, booting);
	o.root.replaceChildren(root);
	await nextPaint();

	// The owner's choices from founding the plant: the portrait and the Ministry's notice are built into the wall.
	const loaded = loadSetup();
	const host = hostOf(o.host ?? 'paperclip');
	const world = buildWorld({ portrait: loaded.portrait, founded: plaqueHangs(loaded, host.ministry) });
	const worldMs = performance.now() - t0;
	const scene = world.scene;
	let stage;
	try {
		stage = await createStage(stageEl, scene);
	} catch (err) {
		booting.textContent = `The renderer could not start, so the plant cannot be drawn. The browser said: ${(err as Error).message}`;
		throw err;
	}
	const stageMs = performance.now() - t0;
	booting.remove();

	const client = createSpriteClient(o.makeWorker);
	/** What the telephone says: the last check, and a frame that failed to render. */
	let lineWords = `The plant has not heard from ${host.server} yet.`;
	let frameFailed = false;
	const frames = createFrameBank(client, (err) => {
		console.error(err);
		frameFailed = true;
	});
	// What each comrade wears: the look kept in this browser, else their own.
	const wardrobe = createWardrobe();
	const crew = createCrew(world, { outfitOf: (a) => wardrobe.wearing(a.id, outfitFor(a)) });
	const sound = createSound(window);
	const cues = createCues(sound);
	const radio = createRadio(sound);
	const radioSet = createRadioSet(stage, scene, radio);
	root.addEventListener(STAMP_EVENT, () => cues.stamp());
	const view = createComradeView(stage, scene, frames, (id, kind) => cues.bubble(kind, screenX(id), id));

	// The corner speaker; the levels and settings open from the radiogram (the top bar went).
	const edgeBox = el('input');
	edgeBox.type = 'checkbox';
	edgeBox.checked = loadEdge();
	edgeBox.addEventListener('change', () => saveEdge(edgeBox.checked));
	const edgeLabel = el('label', 'p67-sound-setting', '');
	edgeLabel.append(edgeBox, document.createTextNode('Edge scrolling: move the view when the pointer rests at the edge of the window.'));
	const speaker = createSoundPanel(sound, radio, [edgeLabel], stageEl);
	const corner = el('div', 'p67-corner');
	corner.append(speaker.button);
	// The owner's setup and the Ministry's inspection; the wall, the paper and the form follow them.
	// Its callbacks name the scenery, Pravda, the poller and the form, which are made further down:
	// that is safe only because none of them is called while the cockpit is still being built.
	const ministry = createMinistry({
		fetchImpl: o.fetchImpl,
		initial: loaded,
		available: host.ministry,
		paintPortrait: (inside, address) => { scenery.setPortrait(inside ?? CHAIRMAN); pravda.setOwner(inside, address); },
		paintFounded: (f) => scenery.setFounded(f),
		refresh: () => void poller?.refresh(),
		// Begin again for the new company, with the form open where the owner left it.
		reload: () => { try { sessionStorage.setItem(REOPEN_KEY, '1'); } catch { /* It just stays shut. */ } location.reload(); },
		onChange: () => wizard.update(),
	});
	const wizard = createWizard({
		host,
		wiring: o.wiring,
		fetchImpl: o.fetchImpl,
		setup: () => ministry.setup,
		save: (next) => ministry.apply(next),
		roster: () => ministry.roster,
		inspection: () => ministry.inspection,
		drawn: () => ministry.drawn,
		watch: (on) => ministry.watch(on),
	});
	corner.prepend(wizard.button);
	/** The company's name, for the stencil on the wall. */
	let companyName = '';
	/** The last check failed: the telephone rings. */
	let offline = false;
	/** A good snapshot has come in, so the posters can say what waits. */
	let heard = false;
	/** The noticeboard's words: the counts, and approvals nobody can carry. */
	let boardWords: string[] = [];

	let selected: string | null = null;
	let companyId: string | null = null;
	const tracked = createTracked();
	let unread = tracked.unreadAgents();
	/** Who carries a dossier, from the last good snapshot. */
	let carriers = new Set<string>();
	/** Re-read who has unread replies and show it on the roster (the bubbles read it each frame). */
	const repliesChanged = (): void => {
		unread = tracked.unreadAgents();
		roster.update(crew.list(), selected, unread);
		flagCard();
	};
	/**
	 * Whether the open comrade has something waiting on the Directives tab: a dossier they
	 * carry, or an unread reply. Not needsYou: that also covers an error, whose fix is on the
	 * Personnel File.
	 *
	 * @returns True when the owner should look there.
	 */
	const directivesWaiting = (): boolean => !!selected && (carriers.has(selected) || unread.has(selected));
	/** Flag the Directives tab while the owner is on the Personnel File and something waits there. */
	const flagCard = (): void => card.flagDirectives(card.tab === 'file' && directivesWaiting());
	// Who is writing an answer in their chat, for the "…" bubble. When one stops, their answer has
	// probably landed: look for it now rather than at the next reply check.
	const writingWatch = createWritingWatch({ fetchImpl: o.fetchImpl, tracked, onChange: () => {}, onDone: () => void replyWatch.check() });
	const chat = createChat({
		fetchImpl: o.fetchImpl,
		host,
		companyId: () => companyId,
		lead: () => {
			const boss = companyLead(crew.list().map((c) => c.agent));
			return boss ? { id: boss.id, name: boss.name } : null;
		},
		nameOf: (id) => crew.get(id)?.agent.name ?? null,
		tracked,
		onSeen: repliesChanged,
		onSent: () => { cues.sent(); void asksWatch.check(); },
		onChatState: (id, writing) => writingWatch.see(id, writing),
		onAnswered: () => void asksWatch.check(),
		// Behind the Personnel File tab the chat is out of sight: a reply must not count as seen.
		isHidden: () => document.hidden || card.tab !== 'directives',
	});
	const card = createCard(
		world,
		host,
		() => { selected = null; chat.close(); dossiers.show(null); personnel.show(null, false); wardrobeTab.open(null); roster.update(crew.list(), null, unread); },
		(t) => {
			personnel.show(selected ? crew.get(selected)?.agent ?? null : null, t === 'file');
			wardrobeTab.open(t === 'wardrobe' ? selected : null);
			// Back on Directives: read the thread now, which also marks a waiting reply as seen.
			if (t === 'directives') chat.poke();
			// The questions beside the card belong to the Directives tab.
			chat.asks.classList.toggle('p67-away', t !== 'directives');
			flagCard();
		},
		(c) => changing.words(c.id) ?? breaks.words(c.id),
	);
	let poller: Poller | null = null;
	const personnel = createPersonnel({
		fetchImpl: o.fetchImpl,
		host,
		companyId: () => companyId,
		nameOf: (id) => crew.get(id)?.agent.name ?? null,
		onActed: (id, a) => {
			ceremonies.stampOver(id, BOARD_STAMPS[a].word, BOARD_STAMPS[a].tone);
			// Look again now, so the comrade walks off without waiting for the next check.
			void poller?.refresh();
		},
	});
	const dossiers = createDossiers({
		fetchImpl: o.fetchImpl,
		me: () => { try { return localStorage.getItem(ME_KEY); } catch { return null; } },
		onDecided: (_o, v, holder) => {
			if (holder) ceremonies.stampOver(holder, DOSSIER_STAMPS[v].word, DOSSIER_STAMPS[v].tone);
			// Look again now, so the "!" goes without waiting for the next check.
			void poller?.refresh();
		},
		onStale: () => void poller?.refresh(),
	});
	card.directives.append(dossiers.section, chat.el);
	card.file.append(personnel.el);
	const replyWatch = createReplyWatch({
		fetchImpl: o.fetchImpl,
		tracked,
		onChange: () => { repliesChanged(); chat.poke(); },
	});
	const overlay = createOverlay(host, () => wizard.open('connect'));
	const emptyNote = wiringNote(o.wiring ?? DEFAULT_WIRING, 'p67-empty-plant');
	emptyNote.setAttribute('role', 'status');
	emptyNote.hidden = true;
	// Wiring the bridge found broken (a hook whose Node has gone): said until the page is reloaded after a fix.
	const wiringTrouble = el('p', 'p67-empty-plant p67-wiring-trouble', (o.wiring?.warnings ?? []).join(' '));
	wiringTrouble.setAttribute('role', 'alert');
	wiringTrouble.hidden = !o.wiring?.warnings.length;
	const pravda = createPravda({ fetchImpl: o.fetchImpl, sent: () => new Set(tracked.all().map((t) => t.issueId)) });
	const camera = createCamera({
		el: stageEl,
		world: stage.size,
		isBlocked: () => card.openId !== null || overlay.open || ceremonies.blocking || dossiers.open || pravda.open || wizard.isOpen,
		edgeEnabled: () => edgeBox.checked,
		onClick: (p) => {
			const at = viewToWorld(camera.cam, p);
			// While furnishing, a click picks out furniture, not comrades or fixtures.
			if (furnish.active) { furnish.click(at); return; }
			const id = view.pick(at);
			// The court, the desk and the photo answer clicks before the name card does.
			if (ceremonies.click(id, at)) return;
			// A bust counts clicks for its wink, and is otherwise clicked like the floor; anything else starts the count again.
			if (id) wink.reset(); else wink.click(at);
			// A comrade standing in front of a fixture is clicked, not the thing behind them.
			const f = id ? null : scenery.hit(at);
			if (f) { openFixture(f, null); return; }
			scenery.closeNote();
			speaker.close();
			select(id);
		},
	});

	/**
	 * Feet of a comrade in world pixels.
	 *
	 * @param id Comrade id.
	 * @returns Point, or null if unknown.
	 */
	const feet = (id: string): { x: number; y: number } | null => {
		const c = crew.get(id);
		if (!c) return null;
		const [x, y] = feetOnScreen(scene, c.pos);
		return { x, y };
	};

	/**
	 * Select a comrade (open their card) or clear the selection.
	 *
	 * @param id Comrade id, or null.
	 * @param issueId A directive of theirs to open onto (a question waits there).
	 */
	function select(id: string | null, issueId?: string): void {
		const c = id ? crew.get(id) : undefined;
		if (!c) { card.hide(); selected = null; }
		else {
			selected = c.id;
			card.show(c);
			// Open the chat first: switching tab pokes the chat, which must already be on this comrade.
			chat.open(c.agent, issueId);
			// A comrade with a dossier, an unread reply or a question opens on Directives, whichever tab was last used.
			if (directivesWaiting() || asksWatch.waiting.has(c.id)) card.setTab('directives');
		}
		dossiers.show(selected);
		personnel.show(c?.agent ?? null, card.tab === 'file');
		wardrobeTab.open(card.tab === 'wardrobe' ? selected : null);
		chat.asks.classList.toggle('p67-away', card.tab !== 'directives');
		flagCard();
		roster.update(crew.list(), selected, unread);
	}

	const roster = createRoster((id) => {
		const p = feet(id);
		if (p) camera.glideTo({ x: p.x, y: p.y - 30 });
		select(id);
	}, host);
	const minimap = createMinimap(scene.frame, { w: 210, h: 130 }, (p) => camera.jumpTo(p));
	const ceremonies = createCeremonies({
		world, crew, stage, fetchImpl: o.fetchImpl,
		threshold: () => (ministry.on ? REGIMES[ministry.setup.regime].strikes : null),
		toScreen: (p) => ({ x: (p.x - camera.cam.x) * camera.cam.zoom, y: (p.y - camera.cam.y) * camera.cam.zoom }),
		glideTo: (p) => camera.glideTo({ x: p.x, y: p.y - 30 }),
		feet: (id) => feet(id),
		onFx: (name) => { if (name === 'verdict') cues.verdict(); else if (name === 'airbrush') cues.airbrush(); else cues.train(); },
		onWaiting: () => showPosters(),
	});

	// The wardrobe: the attendant at the гардероб, the puffs, the changing, the tab.
	const babushka = createBabushka(scene, world, frames, stage.layer);
	const puffs = createPuffs(stage.bubbles);
	/** Outfits rendered ahead for a change, held until it ends. */
	const prefetched = new Map<string, number>();
	const changing = createChanging({
		crew, world,
		attendant: (away) => babushka.turn(away),
		token: () => babushka.hand(),
		puff(id) {
			const c = crew.get(id);
			if (!c) return;
			const [x, y] = feetOnScreen(scene, c.pos);
			puffs.at(x, y - 30);
			sound.play('rustle');
		},
		prefetch(o, still) {
			prefetched.set(o.id, (prefetched.get(o.id) ?? 0) + 1);
			if (prefetched.get(o.id) === 1) frames.retain(o.id);
			if (still) frames.still(o.id);
			// Only the standing frames facing the room: walking is baked once they wear it.
			for (let f = 0; f < 4; f++) frames.get(o, 'idle', world.marks.cloak.dir, f);
		},
		unfetch(o) {
			const n = (prefetched.get(o.id) ?? 1) - 1;
			if (n > 0) { prefetched.set(o.id, n); return; }
			prefetched.delete(o.id);
			frames.release(o.id);
		},
		onChange: (id) => { if (id === selected) card.update(crew.get(id)); },
	});
	/**
	 * Keep a look for a comrade (null: their own) and send them to change into it.
	 *
	 * @param id Comrade.
	 * @param look Look, or null.
	 */
	const keepLook = (id: string, look: Look | null): void => {
		const c = crew.get(id);
		if (!c) return;
		if (look) wardrobe.set(id, look); else wardrobe.clear(id);
		// The crew has not looked at the wardrobe again yet, so starting the change now pins what they have on.
		changing.start(id, wardrobe.wearing(id, outfitFor(c.agent)));
	};
	const wardrobeTab = createWardrobeTab({
		// A preview has an id of its own, so dropping it never touches a comrade wearing the same look.
		render: (o, dir) => client.request({ ...o, id: `preview~${o.id}` }, 'idle', dir, 0, PRI.SHEET),
		forget: (id) => client.drop(`preview~${id}`),
		own: (id) => { const c = crew.get(id); return c ? outfitFor(c.agent) : null; },
		kept: (id) => wardrobe.get(id),
		keep: (id, look) => keepLook(id, look),
		reset: (id) => keepLook(id, null),
	});
	card.wardrobe.append(wardrobeTab.el);

	// Questions from comrades, for the ВОПРОС poster; a new one rings the bell.
	const asksWatch = createAsksWatch({ fetchImpl: o.fetchImpl, tracked, onChange: (fresh) => showPosters(fresh > 0), onNew: () => sound.play('bell') });
	/**
	 * Glide to a comrade, then open their card.
	 *
	 * @param id Comrade.
	 * @param issueId A directive to open onto.
	 */
	const goTo = (id: string, issueId?: string): void => {
		const p = feet(id);
		if (p) camera.glideTo({ x: p.x, y: p.y - 30 });
		select(id, issueId);
	};
	/** Who carries each dossier, from the last good snapshot (one entry per dossier). */
	let carried: string[] = [];
	const posters = createPosters({
		rustle: () => sound.play('rustle'),
		go(kind, k) {
			if (kind === 'tribunal') { ceremonies.openTribunal(k); return; }
			if (kind === 'hire') {
				const ids = ceremonies.hiresWaiting();
				const id = ids[k % ids.length];
				if (!id) return;
				const p = feet(id);
				const [dx, dy] = feetOnScreen(scene, world.marks.desk.pos);
				camera.glideTo(p ? { x: p.x, y: p.y - 30 } : { x: dx, y: dy - 30 });
				ceremonies.click(id, { x: -1, y: -1 });
				return;
			}
			if (kind === 'dossier') { const id = carried[k % carried.length]; if (id) goTo(id); return; }
			const asked = [...asksWatch.waiting.values()].filter((a) => crew.get(a.agentId));
			const a = asked[k % asked.length];
			if (a) goTo(a.agentId, a.chat ? undefined : a.issueId);
		},
	});
	/**
	 * Show what waits on the posters, once the plant has heard from Paperclip.
	 *
	 * @param questionNews A question the plant had not seen before just came in: its poster may unroll.
	 */
	function showPosters(questionNews = false): void {
		if (!heard) return;
		const t = ceremonies.tribunals();
		const asked = [...asksWatch.waiting.values()].filter((a) => crew.get(a.agentId));
		const askers = new Set(asked.map((a) => a.agentId));
		posters.update(postersFor({
			tribunals: t.count, unfinished: t.unfinished,
			hires: ceremonies.hiresWaiting().length,
			dossiers: carried.length, stray: dossiers.unrouted(),
			questions: asked.reduce((n, a) => n + a.count, 0),
			askedBy: askers.size === 1 ? crew.get([...askers][0])?.agent.name ?? null : null,
			// Questions only unroll when the watch heard a new one: the first read of a conversation finds what was already waiting.
		}), questionNews ? [] : ['question']);
	}

	// Furnishing: the furniture follows the layout kept for the company, and the tool
	// wall opens the drawer to change it.
	const layoutStore = createLayoutStore();
	const furnishings = createFurnishings({
		world, stage,
		piece: (kind, facing) => client.piece(kind, facing, PRI.SHEET),
		refloor: () => crew.refloor(),
	});
	const furnish = createFurnish({
		world, stage, stageEl, furnishings,
		cam: () => camera.cam,
		view: () => camera.view,
		glideTo: (p) => camera.glideTo(p),
		standing: () => crew.list().filter((c) => !c.hidden).map((c) => c.pos),
		save: (l) => { if (furnishedFor) layoutStore.save(furnishedFor, l); },
		// The drawer covers the bottom of the screen: the roster and the minimap step aside meanwhile.
		onOpen: () => { select(null); speaker.close(); parade.stop(); root.classList.add('p67-furnishing'); },
		onClose: () => root.classList.remove('p67-furnishing'),
	});
	/** The company whose layout is shown. */
	let furnishedFor: string | null = null;

	// The plant comes alive: idle comrades' breaks and everyone's fidgets; smoke, the far
	// train and pigeons outside.
	const breaks = createBreaks({
		crew, world,
		usable: () => furnishings.usable(),
		prefetch: (o, anim, dir) => frames.want(o, anim, dir),
		onChange: (id) => { if (id === selected) card.update(crew.get(id)); },
	});
	/**
	 * Where a base-layer point is across the screen, 0 to 1, or null when off screen.
	 *
	 * @param x Base-layer x.
	 * @param y Base-layer y.
	 * @returns Share of the width, or null.
	 */
	const baseScreenX = (x: number, y: number): number | null => {
		const { cam, view: v } = camera;
		const sx = (x - cam.x) * cam.zoom / v.w, sy = (y - cam.y) * cam.zoom / v.h;
		return sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1 ? sx : null;
	};
	/**
	 * Pan a sound gently: never hard into one ear.
	 *
	 * @param pan -1 to 1.
	 * @returns Pan.
	 */
	const softPan = (pan: number): number => Math.max(-0.6, Math.min(0.6, pan * 0.6));
	const ambient = createAmbient({
		stage, world, crew,
		render: (req) => client.ambient(req, PRI.PREBAKE),
		screenX: baseScreenX,
		play: (voice, pan, gain) => sound.play(voice, { pan: softPan(pan), gain, ambient: true }),
	});

	// The easter eggs, all secret: the May Day parade on the Konami code, the bust's wink,
	// Sputnik and the bear on their timers, and the five-year plan fulfilled. Their sounds are effects.
	const konami = createKonami();
	/**
	 * Play an easter egg's sound, panned.
	 *
	 * @param voice Voice.
	 * @param pan -1 to 1.
	 * @param gain Level.
	 */
	const eggSound = (voice: Voice, pan: number, gain: number): void => sound.play(voice, { pan: softPan(pan), gain });
	const parade = createParade({
		crew, world, stage,
		// Eight small pictures, wanted within seconds: ahead of the frames baked in the background.
		render: (req) => client.ambient(req, PRI.ANIM),
		zOf: (id) => view.zOf(id),
		prefetch: (o, anim, dir) => frames.want(o, anim, dir),
		glideTo: (p) => camera.glideTo(p),
		screenX: baseScreenX,
		play: eggSound,
	});
	const visitors = createVisitors({ stage, world, render: (req) => client.ambient(req, PRI.PREBAKE), screenX: baseScreenX, play: eggSound });
	const wink = createWink({
		stage,
		bustAt(x, y) {
			const id = furnishings.thingAt(x, y);
			const kind = id ? OWN_PIECES.find((o) => o.id === id)?.kind ?? furnishings.layout.pieces.find((p) => p.id === id)?.kind : undefined;
			const box = id && kind === 'lenin' ? furnishings.boxOf(id) : null;
			return id && box ? { id, box } : null;
		},
		screenX: baseScreenX,
		play: eggSound,
	});
	const celebration = createCelebration({
		crew, world, stage, root,
		cam: () => camera.cam,
		view: () => camera.view,
		glideTo: (p) => camera.glideTo(p),
		prefetch: (o, anim, dir) => frames.want(o, anim, dir),
		screenX: baseScreenX,
		play: eggSound,
	});
	const planWatch = createPlanWatch({
		today: () => dayOf(new Date()),
		load: () => { try { return localStorage.getItem(PLAN_KEY); } catch { return null; } },
		save: (day) => { try { localStorage.setItem(PLAN_KEY, day); } catch { /* It may come again today. */ } },
		onMet: () => celebration.start(),
	});

	const scenery = createScenery({
		stage, scene, stageEl,
		cam: () => camera.cam,
		view: () => camera.view,
		comradeAt: (at) => view.pick(at),
		glideTo: (p) => camera.glideTo(p),
		label: (id) => ({
			radiogram: 'Radiogram: sound and settings',
			noticeboard: `Noticeboard: the counts from ${host.server}`,
			pravda: pravda.words,
			telephone: offline ? `Telephone: ${host.server} cannot be reached` : `Telephone: the line to ${host.server}`,
			plaque: companyName ? `The People's Plant #67 · ${companyName}` : "The People's Plant #67",
			toolWall: furnish.active ? 'Repair Brigade: finish furnishing' : 'Repair Brigade: furnish the plant',
		})[id],
		open: (id, opener) => openFixture(id, opener),
	});
	/**
	 * What a fixture's note card says.
	 *
	 * @param id Fixture.
	 * @returns Heading and sentences.
	 */
	const noteOf = (id: FixtureId): { title: string; lines: string[] } => {
		if (id === 'noticeboard') return { title: 'Noticeboard', lines: boardWords.length ? boardWords : ['The counts have not been read yet.'] };
		if (id === 'telephone') {
			const lines = [lineWords];
			if (frameFailed) lines.push('A comrade frame failed to render, so someone may freeze on an old frame.');
			if (o.sourceNote) lines.push(o.sourceNote);
			return { title: 'Telephone', lines };
		}
		return { title: "The People's Plant #67", lines: [companyName ? `The plant of ${companyName}.` : 'The company has not been read yet.'] };
	};
	/** The panel was opened from the radiogram, so it follows the radiogram as the plant moves. */
	let radioPanel = false;
	/**
	 * The radiogram's box on the page.
	 *
	 * @returns Viewport pixels.
	 */
	const radioBox = (): { left: number; top: number; right: number; bottom: number } => {
		const b = scenery.box('radiogram'), r = stageEl.getBoundingClientRect();
		return { left: r.left + b.left, top: r.top + b.top, right: r.left + b.right, bottom: r.top + b.bottom };
	};
	/**
	 * Open what a fixture holds: the sound panel, the paper, or a note card. A second click closes it.
	 *
	 * @param id Fixture.
	 * @param opener The keyboard button that opened it, or null for the pointer.
	 */
	function openFixture(id: FixtureId, opener: HTMLElement | null): void {
		if (id !== 'radiogram') speaker.close();
		if (id === 'radiogram') {
			scenery.closeNote();
			speaker.toggle(radioBox(), opener);
			radioPanel = speaker.open;
			return;
		}
		if (id === 'pravda') { scenery.closeNote(); pravda.read(); return; }
		if (id === 'toolWall') { scenery.closeNote(); if (furnish.active) furnish.close(); else furnish.open(opener); return; }
		if (scenery.noteFor === id) { scenery.closeNote(); return; }
		const n = noteOf(id);
		scenery.showNote(id, n.title, n.lines, opener);
	}

	root.append(corner, roster.el, minimap.el, card.el, chat.asks, dossiers.el, posters.el, ...ceremonies.els, ...scenery.els, ...furnish.els, pravda.el, overlay.el, emptyNote, wiringTrouble, speaker.panel, wizard.el);
	pravda.setOwner(loaded.portrait, addressOf(loaded));
	/** The company-gone notice has opened the form once; it waits for the owner from then on. */
	let goneShown = false;

	// Open on the director's office: the menus, the counts and the emergency lamp are there,
	// and the posters say what waits elsewhere.
	const [hx, hy] = feetOnScreen(scene, [3.6 * world.tile, 2.6 * world.tile, 60]);
	camera.jumpTo({ x: hx, y: hy });

	let backNotice = 0;

	/**
	 * Take in a snapshot. The roster only moves on good data: while the session is lapsed the
	 * poller repeats the last roster, and placement would slowly send everyone to the canteen
	 * as heartbeats age, so the plant freezes as it was instead.
	 *
	 * @param s Snapshot.
	 */
	function onSnapshot(s: Snapshot): void {
		const recovered = overlay.update(s);
		ministry.see(s);
		emptyNote.hidden = !(o.wiring && s.session === 'ok' && !s.agents.length);
		// The company chosen at setup has gone: the form opens on Connect, once, to choose again.
		if (s.session === 'company-gone' && host.companies && !goneShown) { goneShown = true; wizard.open('connect', 'The company this plant was set up for is no longer listed in Paperclip. Choose one below. The plant will not guess.'); }
		if (s.session === 'ok' || crew.list().length === 0) {
			const first = crew.list().length === 0;
			// Someone leaving while at the cloakroom: the change is called off first, so their farewell
			// (or trial) is played out as for anyone else.
			if (s.session === 'ok') {
				const staying = new Set(s.agents.map((a) => a.id));
				for (const id of changing.ids) if (!staying.has(id)) changing.cancel(id);
			}
			ceremonies.beforeApply(s);
			const change = crew.apply(s);
			if (first && s.agents.length > 0) pravda.start(s);
			pravda.seen(s);
			ceremonies.afterApply(s, change, first && s.agents.length > 0);
			dossiers.update(s);
			if (s.session === 'ok' && s.approvals) {
				const a = s.approvals;
				carried = a.others.map((x) => dossierHolder(x, s.agents)?.id).filter((id): id is string => !!id);
				carriers = new Set(carried);
				cues.approvals([
					...a.tribunals.map((t) => ({ id: t.approvalId, holder: t.agentId })),
					...a.hires.map((h) => ({ id: h.approvalId, holder: h.agentId })),
					...a.others.map((x) => ({ id: x.approvalId, holder: dossierHolder(x, s.agents)?.id ?? null })),
				]);
			}
		}
		companyId = s.companyId;
		// Each company keeps its own furniture: show it once the company is known.
		if (s.companyId && s.companyId !== furnishedFor) {
			furnish.close();
			furnishedFor = s.companyId;
			furnishings.set(settle(world, furnishings.home, layoutStore.load(s.companyId)));
		}
		// A failed check knows no company: keep the name from the last good one.
		if (s.session === 'ok' || s.companyName) companyName = s.companyName ?? '';
		const stray = dossiers.unrouted();
		if (s.session === 'ok') heard = true;
		const b = s.badges;
		// A failed check keeps the last counts on the board; the note says when they were read.
		if (b) scenery.setCounts([b.inbox, b.approvals, b.failedRuns]);
		else if (s.session === 'ok') scenery.setCounts(null);
		planWatch.see(b ? [b.inbox, b.approvals, b.failedRuns] : null, s.session === 'ok' && !!b && !s.badgesStale);
		if (b || s.session === 'ok') boardWords = [
			...(b ? [`Inbox ${b.inbox}, approvals ${b.approvals}, failed runs ${b.failedRuns}.`] : []),
			...(b && s.badgesStale ? ['These counts could not be refreshed, so they may be out of date.'] : []),
			...(stray ? [`${stray === 1 ? 'An approval has' : `${stray} approvals have`} nobody on the roster to carry ${stray === 1 ? 'it' : 'them'}; decide ${stray === 1 ? 'it' : 'them'} in Paperclip.`] : []),
		];
		const time = new Date(s.at).toLocaleTimeString();
		// "Came back" stays up for one more check, then the line goes back to the usual time.
		if (recovered) { lineWords = `The connection to ${host.server} came back at ${time}.`; backNotice = 1; }
		else if (s.session !== 'ok') lineWords = `The check at ${time} failed; the plant will try again shortly.`;
		else if (backNotice > 0) backNotice--;
		else lineWords = `Last checked at ${time}.`;
		offline = s.session !== 'ok';
		scenery.setRinging(offline);
		if (scenery.noteFor) { const n = noteOf(scenery.noteFor); scenery.updateNote(n.title, n.lines); }
		showPosters();
		roster.update(crew.list(), selected, unread);
		card.update(selected ? crew.get(selected) : undefined);
		const sel = selected ? crew.get(selected) : undefined;
		if (sel) chat.update(sel.agent);
		personnel.update(sel?.agent);
		flagCard();
		if (selected && !sel) { selected = null; chat.close(); }
		wizard.update();
	}

	window.addEventListener('keydown', (e) => {
		// The founding form keeps its own keys while it is open; Escape closes it from anywhere.
		if (wizard.isOpen) { if (e.key === 'Escape') wizard.close(); return; }
		const t = e.target as HTMLElement | null;
		// Keys aimed at a control (the chat box, the thread picker) are not for the camera. On a button
		// (a poster, a fixture) Escape and zoom still work: there are no zoom buttons any more.
		if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
		if (!furnish.active && konami(e.key, e.code)) parade.start();
		if (furnish.key(e)) { e.preventDefault(); return; }
		if (t?.tagName === 'BUTTON' && !['Escape', '+', '=', '-', '_'].includes(e.key)) return;
		if (e.key === 'Escape') { if (pravda.escape() || dossiers.escape() || ceremonies.escape() || scenery.closeNote() || speaker.close()) return; if (card.openId) select(null); return; }
		if (e.key === '+' || e.key === '=') camera.zoomBy(1);
		else if (e.key === '-' || e.key === '_') camera.zoomBy(-1);
		else if (e.key === 'ArrowLeft') camera.panBy(-80, 0);
		else if (e.key === 'ArrowRight') camera.panBy(80, 0);
		else if (e.key === 'ArrowUp') camera.panBy(0, -80);
		else if (e.key === 'ArrowDown') camera.panBy(0, 80);
		else return;
		e.preventDefault();
	});
	new ResizeObserver(() => camera.resize()).observe(stageEl);

	/**
	 * Where a comrade stands across the screen, 0 to 1, or null when off screen.
	 *
	 * @param id Comrade id.
	 * @returns Share of the width, or null.
	 */
	function screenX(id: string): number | null {
		const p = feet(id);
		if (!p) return null;
		const { cam, view: v } = camera;
		const x = (p.x - cam.x) * cam.zoom / v.w, y = (p.y - cam.y) * cam.zoom / v.h;
		return x >= 0 && x <= 1 && y >= 0 && y <= 1.15 ? x : null;
	}

	// Siberia's box in world pixels, for the wind: its floor corners, projected.
	const sib = world.zones.siberia.tiles;
	const sibPts = [[sib.x0, sib.y0], [sib.x1, sib.y0], [sib.x0, sib.y1], [sib.x1, sib.y1]].map(([tx, ty]) => feetOnScreen(scene, [tx * world.tile, ty * world.tile, 0]));
	const sibBox = { x0: Math.min(...sibPts.map((p) => p[0])), x1: Math.max(...sibPts.map((p) => p[0])), y0: Math.min(...sibPts.map((p) => p[1])), y1: Math.max(...sibPts.map((p) => p[1])) };
	/**
	 * How much of the screen Siberia fills, 0 to 1.
	 *
	 * @returns Share.
	 */
	function siberiaShare(): number {
		const { cam, view: v } = camera;
		const w = v.w / cam.zoom, h = v.h / cam.zoom;
		const ix = Math.max(0, Math.min(cam.x + w, sibBox.x1) - Math.max(cam.x, sibBox.x0));
		const iy = Math.max(0, Math.min(cam.y + h, sibBox.y1) - Math.max(cam.y, sibBox.y0));
		// The box is a diamond's bounds, so it overstates; half the screen of it is already all wind.
		return Math.min(1, (ix * iy) / (w * h) * 1.6);
	}

	let miniT = 0, cardT = 0, windT = 0, posterT = 0;
	/** The wasteland, baked in idle time once the first comrade is drawn, so the plant itself is never later. */
	let backdrop: Backdrop | null = null;
	stage.app.ticker.add((tk) => {
		// A worker of its own, so the page only places finished pieces; on the page, in idle-time slices, where none will do.
		if (!backdrop && view.firstFrameMs !== null) backdrop = startBackdrop(o.makeWorker, { base: scene.base, trackY: TRACK.y, place: (p) => stage.addBackdrop(p), done: () => stage.showBackdrop(), clear: () => stage.clearBackdrop() });
		// Clamp: after a hidden tab the first delta can be minutes, which would teleport walkers.
		const dt = Math.min(tk.deltaMS, 100);
		crew.step(dt);
		breaks.tick(dt);
		ambient.tick(dt);
		parade.tick(dt);
		visitors.tick(dt);
		wink.tick(dt);
		celebration.tick(dt);
		// The ceremonies wait while the paper is open, so the replay plays once it is put down.
		if (!pravda.holding) ceremonies.tick(dt);
		camera.tick(dt, performance.now());
		radioSet.tick(dt);
		stage.setCamera(camera.cam);
		changing.tick(dt);
		babushka.tick(dt);
		puffs.tick(dt);
		wardrobeTab.tick(dt);
		view.sync(crew, dt, selected, unread, [...ceremonies.extras(), babushka.extra(), ...parade.extras(), ...visitors.extras()], writingWatch.writing);
		parade.draw();
		scenery.tick(dt);
		furnish.tick(dt);
		posters.tick(dt);
		if (!speaker.open) radioPanel = false;
		else if (radioPanel) speaker.follow(radioBox());
		cues.frame(crew.list().filter((c) => !c.hidden).map((c) => ({ id: c.id, anim: c.anim, frame: c.frame, screenX: screenX(c.id) })), camera.cam.zoom);
		miniT += dt; cardT += dt; windT += dt; posterT += dt;
		// Hires are decided and comrades come and go between snapshots: look again now and then.
		if (posterT >= 500) { posterT = 0; showPosters(); }
		if (windT >= 250) { windT = 0; sound.setWind(siberiaShare()); }
		if (miniT >= 100) {
			miniT = 0;
			minimap.draw(crew.list().map((c) => {
				const [x, y] = feetOnScreen(scene, c.pos);
				return { x, y, colour: ACTIVITY_COLOUR[c.place.activity], alert: c.needsYou };
			}), camera.cam, camera.view);
		}
		// The card says "Walking to..." while someone walks, so refresh it now and then.
		if (cardT >= 400) { cardT = 0; if (selected) card.update(crew.get(selected)); }
	});

	poller = o.startPoller(onSnapshot, loaded.companyId);
	let reopen = false;
	try { reopen = sessionStorage.getItem(REOPEN_KEY) === '1'; sessionStorage.removeItem(REOPEN_KEY); } catch { /* Not reopened. */ }
	if (reopen || (!loaded.done && (o.wizardOpens ?? true))) wizard.open();
	replyWatch.start();
	writingWatch.start();
	asksWatch.start();

	return {
		inject: onSnapshot,
		select,
		click: (id) => { if (!ceremonies.click(id, { x: -1, y: -1 })) select(id); },
		look: (x, y) => camera.jumpTo({ x, y }),
		play: (v) => sound.play(v),
		soundState: () => ({ unlocked: sound.unlocked, state: sound.state }),
		radioState: () => ({ on: radio.on, audible: radio.audible, playing: radio.playing }),
		clickRadio: () => radio.set(!radio.on),
		openFixture: (id) => openFixture(id, null),
		keepLook,
		changingState: () => ({ ids: changing.ids, away: babushka.away, outfits: Object.fromEntries(crew.list().filter((c) => c.held === CHANGING || changing.ids.includes(c.id)).map((c) => [c.id, c.outfit.id])) }),
		sceneryState: () => ({ active: scenery.active, ringing: scenery.ringing, note: scenery.noteFor, posters: POSTER_ORDER.filter((k) => posters.poster(k)), unrolled: posters.unrolled }),
		writingState: () => [...writingWatch.writing],
		backdropState: () => ({ done: backdrop?.done ?? false, ms: backdrop?.ms ?? null, how: backdrop?.how ?? null }),
		furnishState: () => ({ ...furnish.state(), layout: furnishings.layout }),
		aliveState: () => ({ breaks: Object.fromEntries(breaks.doing), ambient: ambient.state() }),
		eggsState: () => ({ parade: parade.state(), visitors: visitors.state(), wink: wink.state(), plan: celebration.state() }),
		egg(which) {
			if (which === 'parade') parade.start();
			else if (which === 'plan') celebration.start();
			else visitors.send(which);
		},
		stats: () => ({
			worldMs, stageMs,
			firstComradeMs: view.firstFrameMs === null ? null : view.firstFrameMs + stageMs,
			fps: stage.app.ticker.FPS,
			comrades: crew.list().length,
			frames: frames.size,
			workers: frames.describe(),
			cam: { ...camera.cam },
		}),
		crewReport: () => crew.list().map((c) => ({
			id: c.id, name: c.agent.name, zone: c.place.zone, activity: c.place.activity,
			walking: c.path.length > 0, anim: c.anim, dir: c.dir, shadowing: c.shadow ? crew.get(c.shadow)?.agent.name ?? null : null,
		})),
	};
}
