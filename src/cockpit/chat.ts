/**
 * The chat panel inside a comrade's name card. It opens on the comrade's Agent Chat, their one
 * running conversation with the owner. Beside it: issue a directive (a new Paperclip
 * issue assigned to them), or pick one of their recent issues and reply in it (a comment).
 * Where Paperclip has no Agent Chat, it opens on a new directive, as before. While a thread is
 * open its comments are fetched every CHAT_POLL_MS, and opening it marks it read. Files go
 * with any message (parcels.ts), uploaded when it is sent.
 *
 * Every word from Paperclip is untrusted and only ever written with textContent. Markdown is read
 * safely by markdown.ts (headings, lists, emphasis, code), built from plain elements, never HTML.
 */
import { issueHref } from './links';
import { type FileLike, type Parcel, listParcels, parcelHref, sizeWords, uploadFile } from '../live/attachments';
import { FRESH_START, chatUnavailable, ensureChat, getChat } from '../live/chats';
import { type Interaction, listInteractions, outcomeWords } from '../live/interactions';
import {
	type Failure, type Message, type Thread, createDirective, failureWords, getThread, isClosed, listMessages, listThreads,
	markRead, openingOf, problemWith, reply, whoAmI,
} from '../live/directives';
import type { FetchLike } from '../live/http';
import type { AgentState } from '../live/types';
import { el, setText } from './dom';
import type { Host } from './host';
import { createAsks } from './interactions';
import { renderMarkdown } from './markdown';
import { createParcels, type Pending } from './parcels';
import type { TrackedList } from './tracked';

/** Gap between comment fetches while a thread is open. */
export const CHAT_POLL_MS = 5_000;
/** The thread itself (status, title) is re-read every this many comment fetches; a chat, every time (it says who is writing). */
const THREAD_EVERY = 3;
/** How long "Start afresh" waits for its second click. */
export const AFRESH_CONFIRM_MS = 4_000;
/** localStorage key for the signed-in board user's id, asked of Paperclip on opening (and confirmed by each send). */
export const ME_KEY = 'plant67.me';

export interface ChatDeps {
	fetchImpl: FetchLike;
	/** The company the poller found, or null before discovery. */
	companyId: () => string | null;
	/** The Company Lead to cc, or null when there is none on the roster. */
	lead: () => { id: string; name: string } | null;
	/** A comrade's current name, or null when they are not on the roster. */
	nameOf: (agentId: string) => string | null;
	tracked: TrackedList;
	/** Called when the owner has read a reply, so the bubble and roster can update. */
	onSeen: () => void;
	/** Called when a directive or reply has been sent. */
	onSent?: () => void;
	/** Called with what the open chat shows: whether its comrade is writing an answer. */
	onChatState?: (agentId: string, writing: boolean) => void;
	/** Called when the owner has answered one of a comrade's questions. */
	onAnswered?: () => void;
	isHidden?: () => boolean;
	/** What the server can do (files, waking the agent, Agent Chat, a board) and what it is called. */
	host: Pick<Host, 'files' | 'wakes' | 'server' | 'local' | 'chat' | 'board' | 'threadWords'>;
}

export interface Chat {
	el: HTMLElement;
	/** The comrade's questions: a column of slips beside the name card, for the cockpit to place. */
	asks: HTMLElement;
	/**
	 * Show the chat for a comrade (a different one resets it).
	 *
	 * @param agent Comrade.
	 * @param issueId A directive of theirs to open onto (a question waits there); else the chat, or a directive with an unread reply.
	 */
	open(agent: AgentState, issueId?: string): void;
	/** Refresh from the latest roster entry for the open comrade. */
	update(agent: AgentState): void;
	/** Stop polling and forget the comrade. */
	close(): void;
	/** Look again now: a reply to the open thread may have landed. */
	poke(): void;
	/**
	 * Put files in the box, as the 📎 or a drop would (for scripted checks).
	 *
	 * @param files Files.
	 */
	attach(files: FileLike[]): void;
}

/**
 * A fresh UUID for a comment's clientRequestId.
 *
 * @returns UUID v4 string.
 */
function uuid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	const b = new Uint8Array(16);
	crypto.getRandomValues(b);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Short time for a chat line: hours and minutes today, with the date on other days.
 *
 * @param iso ISO timestamp.
 * @returns Text, or '' for an unreadable time.
 */
export function when(iso: string): string {
	const t = new Date(iso);
	if (Number.isNaN(t.getTime())) return '';
	const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	return t.toDateString() === new Date().toDateString() ? time : `${t.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

/** Issue statuses in words, for the picker. */
const STATUS_WORDS: Record<string, string> = {
	backlog: 'backlog', todo: 'to do', in_progress: 'in progress', in_review: 'in review', answered: 'answered',
	blocked: 'blocked', done: 'done', cancelled: 'cancelled',
};

/**
 * The sentence for a failed send. When the request may have got through (no answer at all,
 * a server error, or a success whose answer could not be read), it says so, because
 * sending again could make a second issue.
 *
 * @param r Failure.
 * @param what "The directive" or "The reply".
 * @returns Sentence(s) for the error line.
 */
export function sendFailure(r: Failure, what: string, host: Pick<Host, 'server' | 'local'>): string {
	const refusedHere = r.status === 0 && !!r.detail;
	// The bridge answers a refusal with a sentence written for the owner: it says it best.
	if (host.local && r.status >= 400 && r.status < 500 && r.detail) return `${what} was not sent. ${r.detail.trim()} Your text is still here.`;
	// A server on this computer that does not answer has not taken anything. The notice on the
	// plant says how to start it again.
	if (host.local && r.session === 'unreachable' && r.status === 0 && !refusedHere) return `${what} was not sent, because ${host.server} did not answer. See the notice above. Your text is still here.`;
	const maybe = r.session === 'unreachable' && !refusedHere && (r.status === 0 || r.status >= 500 || (r.status >= 200 && r.status < 300));
	const name = host.server.charAt(0).toUpperCase() + host.server.slice(1);
	if (maybe && r.status >= 200 && r.status < 300) {
		return `${name} accepted ${what.toLowerCase()} but its answer could not be read, so the plant cannot follow it. Check the thread before sending it again.`;
	}
	const words = failureWords(r, `${what} was not sent`, host.server);
	return maybe
		? `${words} It may have reached ${host.server} anyway, so check the thread before sending it again. Your text is still here.`
		: `${words} Your text is still here.`;
}

/** What the panel shows: the comrade's chat, a new directive, or one of their issues. */
type View = 'chat' | 'new' | 'thread';

/**
 * Build the chat panel (empty until open()).
 *
 * @param d Dependencies.
 * @returns Chat.
 */
export function createChat(d: ChatDeps): Chat {
	const isHidden = d.isHidden ?? (() => document.hidden);
	const root = el('section', 'p67-chat');
	root.setAttribute('aria-label', 'Directives');
	const head = el('div', 'p67-chat-head');
	const heading = el('h3', '', 'Directives');
	const swap = el('button', 'p67-chat-swap', 'New directive');
	swap.type = 'button';
	swap.hidden = true;
	const afresh = el('button', 'p67-chat-swap', 'Start afresh');
	afresh.type = 'button';
	afresh.hidden = true;
	afresh.title = 'Start a fresh conversation: the comrade puts the earlier one out of mind. The history stays here.';
	const picker = el('select', 'p67-threads');
	picker.setAttribute('aria-label', 'Thread');
	const link = el('a', 'p67-open', `Open in ${d.host.server}`);
	link.target = '_blank';
	link.rel = 'noopener';
	link.hidden = true;
	head.append(heading, swap, afresh, picker, link);
	const log = el('div', 'p67-log');
	log.setAttribute('role', 'log');
	log.setAttribute('aria-live', 'polite');
	const writingLine = el('p', 'p67-writing');
	writingLine.setAttribute('aria-live', 'polite');
	writingLine.hidden = true;
	const note = el('p', 'p67-chat-note');
	const input = el('textarea', 'p67-input');
	input.rows = 3;
	const error = el('p', 'p67-chat-error');
	error.setAttribute('role', 'alert');
	const parcels = createParcels((sentence) => setText(error, sentence));
	const row = el('div', 'p67-send-row');
	const hint = el('span', 'p67-hint', 'Ctrl+Enter sends.');
	const send = el('button', 'p67-send', 'Issue directive');
	send.type = 'button';
	const tools = el('span', 'p67-send-tools');
	const host = d.host;
	/**
	 * A failed read in words: on a server that can stop (the bridge), how to start it again.
	 *
	 * @param r Failure.
	 * @param what What could not be done.
	 * @returns Sentence(s).
	 */
	const loadFailure = (r: Failure, what: string): string => (host.local && r.session === 'unreachable' && r.status === 0 && !r.detail
		? `${what}, because ${host.server} did not answer. See the notice above.`
		: failureWords(r, what, host.server));
	if (host.files) tools.append(parcels.button);
	tools.append(hint);
	row.append(tools, send);
	const asks = createAsks({
		fetchImpl: d.fetchImpl,
		nameOf: d.nameOf,
		onAnswered: (i, from, yes) => {
			// An answer that wakes the comrade who asked (not whoever is open now): show them at work at once.
			if (from.chat && (i.wakes === 'answer' || (i.wakes === 'yes' && yes))) d.onChatState?.(from.agentId, true);
			d.onAnswered?.();
			void load();
		},
	});
	root.append(head, log, writingLine, note, input, parcels.el, error, row);
	if (host.files) parcels.dropOnto(root);

	let agent: AgentState | null = null;
	let threads: Thread[] = [];
	let view: View = 'chat';
	/** The comrade's chat: null before its first message (or before it is known). */
	let chat: Thread | null = null;
	/** Whether this Paperclip has Agent Chat: unknown until asked, then yes, no, or unreadable just now. A host without it is never asked. */
	let chatAvailable: 'unknown' | 'yes' | 'no' | 'failed' = d.host.chat ? 'unknown' : 'no';
	let current: Thread | null = null;
	let messages: Message[] = [];
	let files: Parcel[] = [];
	/** What the comrade has asked on the open thread, answered or not. */
	let interactions: Interaction[] = [];
	/** Message bodies already read as markdown, by message id, so a new line does not redo the whole history. */
	let rendered = new Map<string, { body: string; el: HTMLElement }>();
	let shownKey = '';
	let loadNote = '';
	let sending = false;
	let requestId = uuid();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let afreshArmed: ReturnType<typeof setTimeout> | null = null;
	let polls = 0;
	/** A read was loaded out of sight: mark it seen and read once the owner can see it. */
	let owed = false;
	// Bumped whenever the comrade or thread changes, so a slow answer for the old one is dropped.
	let epoch = 0;
	let me: string | null = null;
	// Only a placeholder until Paperclip answers: the page's scripts share this storage.
	try { const kept = localStorage.getItem(ME_KEY); me = kept && kept.length <= 200 ? kept : null; } catch { /* Unknown until Paperclip says. */ }

	/**
	 * Remember the signed-in board user's id, to tell the owner's lines from other people's.
	 *
	 * @param id User id, or null.
	 */
	const learnMe = (id: string | null): void => {
		if (!id || id === me) return;
		me = id;
		try { localStorage.setItem(ME_KEY, id); } catch { /* It is relearned on the next send. */ }
	};
	// Ask Paperclip who is signed in, every time, so another board member's lines are told apart
	// before the owner's first send, and a stale or planted id in storage is corrected.
	void whoAmI(d.fetchImpl).then((id) => { if (id && id !== me) { learnMe(id); draw(); } });

	/**
	 * The name shown over a chat line.
	 *
	 * @param m Message.
	 * @returns Name, or '' for system notices.
	 */
	const who = (m: Message): string => {
		if (m.author.kind === 'system') return '';
		if (m.author.kind === 'agent') return d.nameOf(m.author.agentId) ?? 'A comrade no longer on the roster';
		return !me || !m.author.userId || m.author.userId === me ? 'You' : 'Another board member';
	};

	/**
	 * The parcels on a line, as download links.
	 *
	 * @param list Parcels.
	 * @returns Element, or null when there are none.
	 */
	const parcelLinks = (list: Parcel[]): HTMLElement | null => {
		if (!list.length) return null;
		const box = el('div', 'p67-msg-parcels');
		for (const p of list) {
			const a = el('a', 'p67-msg-parcel', `📦 ${p.name} · ${sizeWords(p.bytes)}`);
			a.href = parcelHref(p);
			a.download = p.name;
			a.rel = 'noopener';
			box.append(a);
		}
		return box;
	};

	/** Redraw the log when the lines, files or the loading note changed. */
	function drawLog(): void {
		const opening = current ? openingOf(current) : null;
		const lines = opening ? [opening, ...messages] : messages;
		const settled = interactions.filter((i) => i.status !== 'pending');
		const key = `${agent?.id ?? ''}|${view}|${current?.id ?? ''}|${loadNote}|${lines.map((m) => m.id).join(',')}|${files.map((p) => `${p.id}:${p.commentId}`).join(',')}|${settled.map((i) => `${i.id}:${i.status}`).join(',')}|${me}`;
		if (key === shownKey) return;
		shownKey = key;
		const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
		log.replaceChildren();
		const name = agent?.name ?? 'this comrade';
		if (view === 'new') {
			const lead = d.lead();
			const cc = lead && lead.id !== agent?.id ? ` The issue names the Company Lead, ${lead.name}, for the record, but does not wake them.` : '';
			log.append(el('p', 'p67-empty', host.wakes
				? `Write a directive for ${name}. It becomes a new ${host.server} issue assigned to them, and its first line becomes the title.${cc}`
				: `Write a directive for ${name}. Its first line becomes the title. ${name} reads it with your next prompt in their terminal. Their answer comes back here.`));
			return;
		}
		if (view === 'chat' && !lines.length && !loadNote) {
			log.append(el('p', 'p67-empty', `This is your running conversation with ${name}. Everything you write here goes to the same Paperclip chat, and their answers come back here. For work you want tracked as a task of its own, use New directive.`));
		}
		const onIssue = files.filter((p) => !p.commentId);
		// Answered questions sit among the lines where they were asked, as one sentence each.
		const byTime: (Message | Interaction)[] = [...lines, ...settled].sort((a, b) => ('at' in a ? a.at : a.createdAt).localeCompare('at' in b ? b.at : b.createdAt));
		for (const x of byTime) {
			if (!('at' in x)) { log.append(el('div', 'p67-msg p67-sys', outcomeWords(x))); continue; }
			const m = x;
			if (m.body.trim() === FRESH_START && m.author.kind === 'user') {
				log.append(el('div', 'p67-msg p67-sys', `A fresh conversation started here, ${when(m.at)}. ${name} has put what came before out of mind.`));
				continue;
			}
			const mine = m.author.kind === 'user' && who(m) === 'You';
			const line = el('div', `p67-msg ${m.author.kind === 'system' ? 'p67-sys' : mine ? 'p67-me' : 'p67-them'}`);
			const meta = [who(m), when(m.at)].filter(Boolean).join(' · ');
			if (meta) line.append(el('div', 'p67-who', meta));
			let r = rendered.get(m.id);
			if (!r || r.body !== m.body) { r = { body: m.body, el: renderMarkdown(m.body) }; rendered.set(m.id, r); }
			const body = el('div', 'p67-body');
			body.append(r.el);
			line.append(body);
			const attached = parcelLinks(m === opening ? onIssue : files.filter((p) => p.commentId === m.id));
			if (attached) line.append(attached);
			log.append(line);
		}
		// Files on the issue itself, with no opening line to hang on (a chat has no description).
		if (!opening && onIssue.length) {
			const line = el('div', 'p67-msg p67-sys', 'Files on this conversation:');
			line.append(parcelLinks(onIssue)!);
			log.append(line);
		}
		if (loadNote) log.append(el('p', 'p67-empty', loadNote));
		if (nearBottom || lines.length <= 1) log.scrollTop = log.scrollHeight;
	}

	/** Fill the thread picker, and the buttons beside it. */
	function drawPicker(): void {
		const name = agent?.name ?? 'this comrade';
		const want = [
			...(chatAvailable !== 'no' ? [['chat', `Chat with ${name}`]] : []),
			['new', 'New directive'],
			...threads.map((t) => [t.id, `${d.tracked.has(t.id) ? '★ ' : ''}${t.identifier ?? 'Issue'} · ${t.title} (${host.threadWords[t.status] ?? STATUS_WORDS[t.status] ?? t.status})`]),
		];
		const same = picker.options.length === want.length && want.every(([v, text], i) => picker.options[i].value === v && picker.options[i].text === text);
		if (!same) {
			picker.replaceChildren(...want.map(([v, text]) => { const o = el('option', '', text); o.value = v; return o; }));
		}
		picker.value = view === 'thread' ? current!.id : view;
		setText(heading, view === 'chat' ? 'Chat' : 'Directives');
		swap.hidden = chatAvailable === 'no' || !agent;
		setText(swap, view === 'chat' ? 'New directive' : 'Back to chat');
		afresh.hidden = view !== 'chat' || !chat;
		if (afresh.hidden) disarm();
		const ref = current?.identifier ?? current?.id;
		const href = ref ? issueHref(ref) : null;
		link.hidden = !href;
		if (href) link.href = href;
	}

	/** The composer's labels, the writing line, and the note about a comrade who cannot pick work up. */
	function drawComposer(): void {
		const name = agent?.name ?? 'this comrade';
		setText(send, sending ? 'Sending…' : view === 'chat' ? 'Send' : view === 'thread' ? 'Send reply' : 'Issue directive');
		send.disabled = sending || !agent;
		parcels.lock(sending);
		parcels.aim(view === 'chat' ? chat?.id ?? null : current?.id ?? null);
		input.placeholder = view === 'chat' ? `Write to ${name}.` : current ? `Reply to ${name} on ${current.identifier ?? 'this issue'}.` : `A directive for ${name}. The first line becomes the title.`;
		const writes = view === 'chat' && current?.conversation?.state === 'active';
		writingLine.hidden = !writes;
		setText(writingLine, writes ? `${name} is writing…` : '');
		let n = '';
		if (agent?.status === 'paused') n = `${name} is paused, so they will not pick this up until someone resumes them.`;
		// On the bridge, the next prompt both clears the error and hands this over: nothing more to say.
		else if (agent?.status === 'error' && host.board) n = `${name} is stopped with an error, so they will not pick this up until a board member clears it.`;
		else if (view === 'thread' && current && isClosed(current)) n = `This issue is ${current.status === 'done' ? 'done' : 'cancelled'}. A reply reopens it.`;
		// A message sent now would withdraw a question that says so: warn while there is text in the box.
		if (input.value.trim() && interactions.some((i) => i.status === 'pending' && i.supersededByMessage)) {
			n = `${n ? `${n} ` : ''}Sending a message withdraws the question above. Answer it first if you meant to.`;
		}
		setText(note, n);
		note.hidden = !n;
	}

	/** Show the questions waiting for the owner on the open thread. */
	function drawAsks(): void {
		const ref = current?.identifier ?? current?.id;
		asks.show(interactions.filter((i) => i.status === 'pending'), {
			who: agent?.name ?? 'This comrade', agentId: agent?.id ?? '', chat: view === 'chat', link: ref ? issueHref(ref) : null,
		});
	}

	/** Redraw everything. */
	function draw(): void {
		drawPicker();
		drawLog();
		drawAsks();
		drawComposer();
	}

	/** Stop the comment poll. */
	function stopPoll(): void {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	}

	/** Put "Start afresh" back to asking for its first click. */
	function disarm(): void {
		if (afreshArmed !== null) clearTimeout(afreshArmed);
		afreshArmed = null;
		setText(afresh, 'Start afresh');
	}

	/**
	 * Mark the open thread as read up to its newest line.
	 *
	 * @param t Thread.
	 */
	function seen(t: Thread): void {
		const newest = messages.at(-1)?.at ?? t.createdAt;
		if (d.tracked.markSeen(t.id, newest)) d.onSeen();
	}

	/**
	 * Fetch the open thread's comments (and now and then the thread itself and its files), then
	 * schedule the next.
	 *
	 * @param first True on opening the thread: also marks it read in Paperclip.
	 */
	async function load(first = false): Promise<void> {
		if (first) owed = false;
		stopPoll();
		const t = current;
		if (!t || !agent) return;
		const mine = epoch;
		const who = agent.id;
		if (!isHidden() || first) {
			const often = first || view === 'chat' || polls % THREAD_EVERY === 0;
			const [msgs, fresh, asked] = await Promise.all([
				listMessages(d.fetchImpl, t.id),
				often ? getThread(d.fetchImpl, t.id) : Promise.resolve(null),
				often ? listInteractions(d.fetchImpl, t.id) : Promise.resolve(null),
			]);
			if (mine !== epoch) return;
			polls++;
			if (fresh?.ok) {
				current = fresh.value;
				if (view === 'chat') { chat = fresh.value; d.onChatState?.(who, fresh.value.conversation?.state === 'active'); }
				threads = threads.map((x) => (x.id === fresh.value.id ? fresh.value : x));
			}
			// A failed read keeps the questions already shown: a passing fault must not wipe a half-filled form.
			if (asked?.ok) interactions = asked.value;
			let grew = false;
			if (msgs.ok) {
				// Tell Paperclip it has been read on opening, and again whenever new comments arrive
				// while it is on screen, so the dashboard's inbox agrees with what was seen here.
				grew = msgs.value.length !== messages.length;
				messages = msgs.value;
				loadNote = '';
				// Out of sight (a background tab, or behind the Personnel File) nothing counts as
				// seen: it is owed, and settled on the first load the owner can see.
				if (isHidden()) owed = owed || first || grew;
				else {
					seen(current!);
					if (first || grew || owed) void markRead(d.fetchImpl, t.id);
					owed = false;
				}
			} else loadNote = loadFailure(msgs, 'The thread could not be loaded');
			// Files change only with new lines, so they are read only then.
			if (first || grew) {
				const p = await listParcels(d.fetchImpl, t.id);
				if (mine !== epoch) return;
				if (p.ok) files = p.value;
			}
			draw();
		}
		if (mine === epoch) timer = setTimeout(() => void load(), CHAT_POLL_MS);
	}

	/**
	 * Switch to the chat, a new directive, or one of the comrade's issues.
	 *
	 * @param next View.
	 * @param t The issue, for the 'thread' view.
	 */
	function choose(next: View, t: Thread | null = null): void {
		epoch++;
		stopPoll();
		disarm();
		polls = 0;
		view = next;
		current = next === 'chat' ? chat : next === 'thread' ? t : null;
		messages = [];
		files = [];
		interactions = [];
		rendered = new Map();
		// A chat that could not be read earlier is asked for again, rather than shown as empty.
		const retry = next === 'chat' && chatAvailable === 'failed' && !!agent;
		if (retry) chatAvailable = 'unknown';
		loadNote = current ? (next === 'chat' ? 'Loading the conversation…' : 'Loading the thread…') : next === 'chat' && chatAvailable === 'unknown' ? 'Looking for your conversation…' : '';
		setText(error, '');
		draw();
		if (current) void load(true);
		if (retry) void findChat(agent!);
	}

	/**
	 * Open one of the comrade's directives, read first if it is not in the picker.
	 *
	 * @param a Comrade.
	 * @param issueId Directive.
	 */
	function goTo(a: AgentState, issueId: string): void {
		const t = threads.find((x) => x.id === issueId);
		if (t) { choose('thread', t); return; }
		void getThread(d.fetchImpl, issueId).then((r) => {
			if (r.ok && agent?.id === a.id && current?.id !== issueId) { threads = [r.value, ...threads.filter((x) => x.id !== issueId)]; choose('thread', r.value); }
		});
	}

	/**
	 * Ask Paperclip for the comrade's chat. Without Agent Chat on this Paperclip, the panel falls
	 * back to directives.
	 *
	 * @param a Comrade.
	 */
	async function findChat(a: AgentState): Promise<void> {
		const cid = d.companyId();
		// Said here, not by choose(): choose('chat') asks again after a failure, and would ask for ever.
		if (!cid) {
			chatAvailable = 'failed';
			if (view === 'chat') { loadNote = 'The plant has not found the company yet, so your conversation cannot be loaded. It will try again at the next check.'; draw(); }
			return;
		}
		const r = await getChat(d.fetchImpl, cid, a.id);
		if (agent?.id !== a.id) return;
		if (r.ok) {
			chatAvailable = 'yes';
			chat = r.value;
			if (view === 'chat') choose('chat');
			return;
		}
		chatAvailable = chatUnavailable(r) ? 'no' : 'failed';
		if (chatAvailable === 'no') { if (view === 'chat') choose('new'); else drawPicker(); return; }
		if (view === 'chat') { loadNote = `${failureWords(r, 'Your conversation could not be loaded', host.server)} The plant will try again at the next check.`; draw(); }
	}

	/** Fetch the comrade's recent issues for the picker. */
	async function loadThreads(): Promise<void> {
		const cid = d.companyId();
		if (!agent || !cid) return;
		const mine = epoch;
		const who = agent.id;
		const r = await listThreads(d.fetchImpl, cid, who);
		if (!agent || agent.id !== who) return;
		if (!r.ok) { if (mine === epoch) setText(error, loadFailure(r, 'The list of threads could not be loaded')); return; }
		// Keep the open thread in the list even if it has dropped out of the newest six.
		threads = view === 'thread' && current && !r.value.some((t) => t.id === current!.id) ? [current, ...r.value] : r.value;
		drawPicker();
	}

	/**
	 * Upload the files of a send to an issue. A file a failed send already put on this issue is
	 * not uploaded again; one put on another issue (the owner has since changed thread) is.
	 *
	 * @param cid Company.
	 * @param issueId Issue.
	 * @param box The files as they were when Send was pressed.
	 * @returns The uploaded parcels' ids, or the first failure and the file it stopped at.
	 */
	async function upload(cid: string, issueId: string, box: readonly Pending[]): Promise<{ ok: true; ids: string[] } | { ok: false; r: Failure; file: Pending }> {
		for (const p of box) {
			if (p.uploaded?.issueId === issueId) continue;
			const r = await uploadFile(d.fetchImpl, cid, issueId, p.file);
			if (!r.ok) return { ok: false, r, file: p };
			parcels.done(p, r.value, issueId);
		}
		return { ok: true, ids: box.map((p) => p.uploaded!.parcel.id) };
	}

	/**
	 * The words sent with files and no text: Paperclip needs a message body.
	 *
	 * @param box Files.
	 * @returns A sentence naming the files.
	 */
	const filesOnly = (box: readonly Pending[]): string => `Files attached: ${box.map((p) => p.file.name).join(', ')}.`;

	/**
	 * Send the text and files as a comment on a thread (the chat or an issue).
	 *
	 * @param cid Company.
	 * @param thread Thread.
	 * @param text Text as typed (or the files' names).
	 * @param mine The epoch the send began in.
	 * @param box The files as they were when Send was pressed.
	 * @returns The message as saved, or null when it failed (and the error line says why).
	 */
	async function comment(cid: string, thread: Thread, text: string, mine: number, box: readonly Pending[]): Promise<Message | null> {
		const up = await upload(cid, thread.id, box);
		if (!up.ok) {
			const before = box.some((p) => p !== up.file && p.uploaded?.issueId === thread.id);
			if (mine === epoch) setText(error, `${failureWords(up.r, `${up.file.file.name} could not be attached`, host.server)} The message was not posted.${before ? ' The files before it are on the issue already; they go with the message when you send it again.' : ''} Your text and files are still here.`);
			return null;
		}
		const r = await reply(d.fetchImpl, thread, text, requestId, up.ids);
		if (!r.ok) { if (mine === epoch) setText(error, sendFailure(r, view === 'chat' ? 'The message' : 'The reply', host)); return null; }
		if (r.value.author.kind === 'user') learnMe(r.value.author.userId);
		return r.value;
	}

	/** Send what is in the box: a chat message, a new directive, or a reply on the open thread. */
	async function submit(): Promise<void> {
		if (sending || !agent) return;
		// The files go with the comrade and thread of this press of Send, whatever is opened meanwhile.
		const box = [...parcels.pending];
		const typed = input.value;
		const text = !typed.trim() && box.length ? filesOnly(box) : typed;
		const problem = problemWith(text);
		if (problem) { setText(error, problem); input.focus(); return; }
		const cid = d.companyId();
		if (!cid) { setText(error, 'The plant has not found the company yet, so nothing can be sent. Wait for the next check.'); return; }
		sending = true;
		setText(error, '');
		drawComposer();
		const to = agent;
		const mine = epoch;
		try {
			// Everything after an await checks `mine === epoch`: if the owner has moved to another
			// comrade or thread meanwhile, the box and the error line are theirs now, not this send's.
			if (view === 'new') await issue(cid, to, text, mine, box);
			else if (view === 'chat') {
				let target = chat;
				if (!target) {
					const r = await ensureChat(d.fetchImpl, cid, to.id);
					if (!r.ok) {
						if (mine !== epoch) return;
						if (chatUnavailable(r)) {
							chatAvailable = 'no';
							choose('new');
							setText(error, 'This Paperclip has no Agent Chat, so this is now a directive instead. Press Issue directive to send it.');
						} else setText(error, sendFailure(r, 'The message', host));
						return;
					}
					// The message still goes to this comrade's chat; the panel learns of the chat only if it still shows them.
					if (mine === epoch) { chat = r.value; chatAvailable = 'yes'; }
					target = r.value;
				}
				const m = await comment(cid, target, text, mine, box);
				if (!m) return;
				d.tracked.add(target.id, to.id, m.at, true);
				d.onSent?.();
				d.onChatState?.(to.id, true);
				if (mine !== epoch) return;
				done(m);
				if (!current) { current = target; void load(true); } else void load();
			} else if (current) {
				const thread = current;
				const m = await comment(cid, thread, text, mine, box);
				if (!m) return;
				d.tracked.markSeen(thread.id, m.at);
				d.onSent?.();
				if (mine !== epoch) return;
				done(m);
				if (isClosed(thread)) current = { ...thread, status: 'todo' };
				void load();
			}
		} finally {
			sending = false;
			drawComposer();
		}
	}

	/**
	 * Clear the box after a message was saved, and show it at once.
	 *
	 * @param m The message as saved.
	 */
	function done(m: Message): void {
		requestId = uuid();
		input.value = '';
		parcels.clear();
		if (!messages.some((x) => x.id === m.id)) messages = [...messages, m];
		draw();
	}

	/**
	 * Issue a directive, then hang the files on the new issue.
	 *
	 * @param cid Company.
	 * @param to Comrade.
	 * @param text Directive.
	 * @param mine The epoch the send began in.
	 * @param box The files as they were when Send was pressed.
	 */
	async function issue(cid: string, to: AgentState, text: string, mine: number, box: readonly Pending[]): Promise<void> {
		const r = await createDirective(d.fetchImpl, cid, to.id, text, d.lead());
		if (!r.ok) {
			if (mine === epoch) setText(error, sendFailure(r, 'The directive', host));
			void loadThreads();
			return;
		}
		learnMe(r.value.createdByUserId);
		d.tracked.add(r.value.id, to.id, r.value.createdAt);
		d.onSent?.();
		// The directive exists now, so the files go on it; any that fail stay in the box, to go with a reply.
		const up = await upload(cid, r.value.id, box);
		if (mine !== epoch) return;
		input.value = '';
		const attached = box.filter((p) => p.uploaded?.issueId === r.value.id).length;
		const left = box.filter((p) => p.uploaded?.issueId !== r.value.id).map((p) => p.file);
		parcels.clear();
		threads = [r.value, ...threads.filter((t) => t.id !== r.value.id)];
		choose('thread', r.value);
		if (!up.ok) {
			parcels.add(left);
			setText(error, `${failureWords(up.r, `The directive was issued, but ${up.file.file.name} could not be attached`, host.server)} ${attached ? 'The files before it are on the issue. ' : ''}What is left in the box goes with your next reply.`);
		}
	}

	picker.addEventListener('change', () => {
		if (picker.value === 'chat' || picker.value === 'new') { choose(picker.value); return; }
		const t = threads.find((x) => x.id === picker.value) ?? null;
		if (t) choose('thread', t); else choose('new');
	});
	swap.addEventListener('click', () => choose(view === 'chat' ? 'new' : 'chat'));
	afresh.addEventListener('click', () => {
		if (afreshArmed === null) {
			setText(afresh, 'Click again to start afresh');
			afreshArmed = setTimeout(disarm, AFRESH_CONFIRM_MS);
			return;
		}
		disarm();
		void freshStart();
	});
	send.addEventListener('click', () => void submit());
	input.addEventListener('input', () => { requestId = uuid(); if (error.textContent) setText(error, ''); drawComposer(); });
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
		else if (e.key === 'Escape') input.blur();
		// Keys typed here are for the text, not the camera.
		e.stopPropagation();
	});
	if (typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)) hint.textContent = '⌘+Enter sends.';

	/** Start a fresh conversation in the chat: Paperclip's "/new". The box is left alone. */
	async function freshStart(): Promise<void> {
		if (sending || !agent || !chat) return;
		sending = true;
		drawComposer();
		const to = agent, target = chat, mine = epoch;
		try {
			const r = await reply(d.fetchImpl, target, FRESH_START, uuid());
			if (!r.ok) { if (mine === epoch) setText(error, failureWords(r, 'The fresh start was not sent', host.server)); return; }
			d.tracked.add(target.id, to.id, r.value.at, true);
			d.onChatState?.(to.id, true);
			if (mine !== epoch) return;
			if (!messages.some((x) => x.id === r.value.id)) messages = [...messages, r.value];
			draw();
			void load();
		} finally {
			sending = false;
			drawComposer();
		}
	}

	return {
		el: root,
		asks: asks.el,
		open(a, want) {
			if (agent?.id === a.id) {
				this.update(a);
				if (want && current?.id !== want) goTo(a, want);
				return;
			}
			agent = a;
			threads = [];
			chat = null;
			chatAvailable = chatAvailable === 'no' ? 'no' : 'unknown';
			input.value = '';
			parcels.clear();
			requestId = uuid();
			// Open straight onto a directive with an unread reply, if there is one; else the chat.
			const unread = d.tracked.unreadFor(a.id);
			choose(chatAvailable === 'no' ? 'new' : 'chat');
			void findChat(a);
			void loadThreads().then(() => {
				const target = want ?? (unread && !unread.chat ? unread.issueId : null);
				if (target && agent?.id === a.id && view !== 'thread') goTo(a, target);
			});
		},
		update(a) {
			if (agent?.id !== a.id) return;
			agent = a;
			// Each check of the roster is also a chance to find a chat that could not be read.
			if (view === 'chat' && chatAvailable === 'failed' && d.companyId()) { chatAvailable = 'unknown'; void findChat(a); }
			drawComposer();
		},
		close() {
			epoch++;
			stopPoll();
			disarm();
			agent = null;
			current = null;
			chat = null;
			messages = [];
			files = [];
			interactions = [];
			threads = [];
			shownKey = '';
			drawAsks();
		},
		poke() {
			// Nothing typed and not in a thread: go to a directive with an unread reply, if there is one.
			if (view !== 'thread' && agent && !input.value.trim()) {
				const u = d.tracked.unreadFor(agent.id);
				const t = u && !u.chat ? threads.find((x) => x.id === u.issueId) : undefined;
				if (t) { choose('thread', t); return; }
			}
			if (current && agent) void load();
		},
		attach: (list) => parcels.add(list),
	};
}
