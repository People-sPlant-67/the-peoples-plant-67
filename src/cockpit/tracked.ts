/**
 * The directives the plant has issued, remembered in localStorage (on the Paperclip origin,
 * under a plant67 key) so the reply bubble survives a reload: which comrade each issue went
 * to, the newest comment the owner has seen, and whether a comrade has written since.
 *
 * Storage can be missing or refuse writes (privacy settings, a full quota); then the list just
 * lives for this page. The storage is injectable so the tests run under Node.
 */

/** localStorage key. */
export const TRACK_KEY = 'plant67.directives';
/** Most directives remembered, and most chats; the oldest of each is forgotten first. */
export const TRACK_MAX = 30;

/** One issued directive. */
export interface Tracked {
	issueId: string;
	agentId: string;
	/** When it was issued (ISO), for ordering. */
	issuedAt: string;
	/** Newest comment time (ISO) the owner has seen, or '' before any. */
	seenAt: string;
	/** A comrade has commented since seenAt. */
	unread: boolean;
	/** The comrade's Agent Chat rather than a directive (absent in older records). */
	chat?: boolean;
}

/** The slice of Storage used. */
export interface StoreLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface TrackedList {
	/** Every tracked directive, newest first. */
	all(): Tracked[];
	has(issueId: string): boolean;
	/**
	 * Remember a directive just issued, or a chat just written in (it moves to the front).
	 *
	 * @param chat True for the comrade's Agent Chat.
	 */
	add(issueId: string, agentId: string, issuedAt: string, chat?: boolean): void;
	/**
	 * Record the newest comment on an issue. It counts as unread when a comrade wrote it after
	 * the last one seen.
	 *
	 * @returns True when the unread state changed.
	 */
	sawLatest(issueId: string, at: string, byAgent: boolean): boolean;
	/**
	 * The owner has read the thread up to this time.
	 *
	 * @returns True when the unread state changed.
	 */
	markSeen(issueId: string, at: string): boolean;
	/** Comrade ids with at least one unread reply. */
	unreadAgents(): Set<string>;
	/** The newest unread directive for a comrade, if any. */
	unreadFor(agentId: string): Tracked | undefined;
}

/**
 * The page's localStorage, or null where reading it throws.
 *
 * @returns Storage or null.
 */
function defaultStore(): StoreLike | null {
	try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/**
 * Check one stored record, since storage is shared with the Paperclip page and could hold anything.
 *
 * @param x Parsed value.
 * @returns True for a well-formed record.
 */
function valid(x: unknown): x is Tracked {
	const t = x as Tracked;
	return !!t && typeof t === 'object' && typeof t.issueId === 'string' && typeof t.agentId === 'string'
		&& typeof t.issuedAt === 'string' && typeof t.seenAt === 'string' && typeof t.unread === 'boolean'
		&& (t.chat === undefined || typeof t.chat === 'boolean');
}

/**
 * Keep the newest TRACK_MAX directives and the newest TRACK_MAX chats, so a busy chat, which
 * comes back to the front with every message, never pushes out a directive awaiting its answer.
 *
 * @param list Records, newest first.
 * @returns The records kept, in the same order.
 */
function cap(list: Tracked[]): Tracked[] {
	let chats = 0, directives = 0;
	return list.filter((t) => (t.chat ? ++chats : ++directives) <= TRACK_MAX);
}

/**
 * Load the list.
 *
 * @param store Storage, or null for memory only (defaults to localStorage).
 * @returns Tracked list.
 */
export function createTracked(store: StoreLike | null = defaultStore()): TrackedList {
	let list: Tracked[] = [];
	/**
	 * Read the list from storage. Every change reads first, so two plant tabs do not overwrite
	 * each other's directives with stale copies. Unreadable storage keeps the copy in memory.
	 */
	const load = (): void => {
		try {
			const raw = store?.getItem(TRACK_KEY);
			if (raw === null || raw === undefined) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) list = cap(parsed.filter(valid));
		} catch { /* Keep what is in memory. */ }
	};
	load();

	/** Write the list back, ignoring storage that refuses. */
	const save = (): void => {
		try { store?.setItem(TRACK_KEY, JSON.stringify(list)); } catch { /* It just won't survive a reload. */ }
	};
	/**
	 * Find a record.
	 *
	 * @param id Issue id.
	 * @returns Record or undefined.
	 */
	const find = (id: string): Tracked | undefined => list.find((t) => t.issueId === id);

	return {
		all: () => [...list],
		has: (id) => !!find(id),
		add(issueId, agentId, issuedAt, chat = false) {
			load();
			const was = find(issueId);
			// Writing again in a chat never moves what was seen backwards.
			const seenAt = was && was.seenAt > issuedAt ? was.seenAt : issuedAt;
			const entry: Tracked = { issueId, agentId, issuedAt, seenAt, unread: false };
			if (chat) entry.chat = true;
			list = cap([entry, ...list.filter((t) => t.issueId !== issueId)]);
			save();
		},
		sawLatest(issueId, at, byAgent) {
			load();
			const t = find(issueId);
			if (!t || !byAgent || at <= t.seenAt || t.unread) return false;
			t.unread = true;
			save();
			return true;
		},
		markSeen(issueId, at) {
			load();
			const t = find(issueId);
			if (!t) return false;
			const was = t.unread;
			if (at > t.seenAt) t.seenAt = at;
			t.unread = false;
			save();
			return was;
		},
		unreadAgents: () => { load(); return new Set(list.filter((t) => t.unread).map((t) => t.agentId)); },
		unreadFor: (agentId) => list.find((t) => t.unread && t.agentId === agentId),
	};
}
