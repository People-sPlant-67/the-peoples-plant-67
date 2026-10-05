/**
 * Interactions: what a comrade asks the owner inside a chat or an issue, and the owner's answer.
 * Six kinds exist in Paperclip; five are answered in the plant, and a request to connect an
 * account is sent to Paperclip's own page (credentials never pass through the plant).
 *
 * Seen on the live instance (2026.916.0): ask_user_questions and request_confirmation, with every
 * answer waking the comrade (continuationPolicy wake_assignee). The other kinds follow the
 * open-source server's shapes (packages/shared/src/validators/issue.ts). Anything that does not
 * parse is an 'unknown' interaction, shown with its title and a link to Paperclip.
 *
 * Every string here is untrusted: written only with textContent. Before any answer is sent, the
 * interaction is read again; if it has been answered, withdrawn or changed since it was shown,
 * nothing is sent.
 */
import type { Failure, Result } from './directives';
import { type FetchLike, UUID, fail, request } from './http';
import { listOf } from './poller';

/** Longest text kept from one field (a prompt, a label, details). */
const TEXT_MAX = 4_000;
/** Most options, items or tasks read from one interaction. */
const LIST_MAX = 200;
/** Most questions Paperclip takes answers to in one go; a longer form is answered in Paperclip. */
export const ANSWERS_MAX = 20;

/** What every interaction carries. */
interface Base {
	id: string;
	issueId: string;
	/** 'pending' until answered; then 'answered', 'accepted', 'rejected', 'expired' and so on. */
	status: string;
	title: string | null;
	createdAt: string;
	/** A chat message sent while it is pending withdraws it. */
	supersededByMessage: boolean;
	/** What wakes the comrade (a run): any answer, only a yes, or nothing. */
	wakes: 'answer' | 'yes' | null;
	/** The status, payload and result as read, to tell whether it changed before an answer goes. */
	fingerprint: string;
}

/** What a confirmation is about (a pull request, a document). */
export interface Target {
	label: string | null;
	/** The comrade's own name for it, such as a repository and number. */
	key: string | null;
	href: string | null;
}

/** One option of a question or a checklist. */
export interface Choice {
	id: string;
	label: string;
	description: string | null;
	/** The option asks for the owner's own words. */
	freeText: boolean;
}

/** One question of an ask_user_questions. */
export interface Question {
	id: string;
	prompt: string;
	help: string | null;
	multi: boolean;
	required: boolean;
	options: Choice[];
	/** An "Other" box goes with the options (Paperclip's default, unless an option already asks for own words). */
	other: boolean;
}

/** One item to give a verdict on, with what it points at. */
export interface VerdictItem extends Choice {
	preview: string | null;
	href: string | null;
	/** Decided already (in Paperclip, meanwhile): Paperclip ignores a second verdict on it. */
	decided: VerdictValue | null;
}

/** One suggested task. */
export interface SuggestedTask {
	key: string;
	title: string;
	description: string | null;
	assigneeAgentId: string | null;
	parentKey: string | null;
}

/** An answer a verdict can be. */
export type VerdictValue = 'approve' | 'reject' | 'defer';

/** Everything the plant knows how to show. */
export type Interaction =
	| Base & { kind: 'confirm'; prompt: string; details: string | null; target: Target | null; acceptLabel: string | null; rejectLabel: string | null; reasonRequired: boolean; reasonAllowed: boolean; locked: string | null }
	| Base & { kind: 'checklist'; prompt: string; details: string | null; target: Target | null; options: Choice[]; defaults: string[]; min: number; max: number | null; acceptLabel: string | null; rejectLabel: string | null; reasonRequired: boolean; reasonAllowed: boolean; locked: string | null }
	| Base & { kind: 'questions'; questions: Question[]; submitLabel: string | null }
	| Base & { kind: 'tasks'; tasks: SuggestedTask[] }
	| Base & { kind: 'verdicts'; prompt: string; details: string | null; items: VerdictItem[]; verdicts: VerdictValue[]; reasonOn: VerdictValue[] }
	| Base & { kind: 'connect'; service: string }
	| Base & { kind: 'unknown'; rawKind: string };

/** An answer, one shape per Paperclip endpoint. */
export type Answer =
	| { kind: 'accept'; selectedOptionIds?: string[]; selectedClientKeys?: string[] }
	| { kind: 'reject'; reason?: string }
	| { kind: 'respond'; answers: { questionId: string; optionIds: string[]; otherText?: string | null }[] }
	| { kind: 'verdicts'; verdicts: { id: string; verdict: VerdictValue; reason?: string | null }[] };

/**
 * A trimmed string field, or null.
 *
 * @param v Raw value.
 * @param max Longest kept.
 * @returns String or null.
 */
function text(v: unknown, max = TEXT_MAX): string | null {
	return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * An object field, or null.
 *
 * @param v Raw value.
 * @returns Object or null.
 */
function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/**
 * The items of an array field that are objects, at most LIST_MAX.
 *
 * @param v Raw value.
 * @returns Objects.
 */
function objects(v: unknown): Record<string, unknown>[] {
	return Array.isArray(v) ? v.slice(0, LIST_MAX).map(obj).filter((x): x is Record<string, unknown> => !!x) : [];
}

/**
 * Read one option.
 *
 * @param r Raw option.
 * @returns Choice, or null without an id and label.
 */
function choice(r: Record<string, unknown>): Choice | null {
	const id = text(r.id, 160), label = text(r.label, 1_000);
	return id && label ? { id, label, description: text(r.description), freeText: r.freeText === true } : null;
}

/**
 * Read what a confirmation is about. A target the plant cannot put into words locks the question:
 * a yes would give leave for something the owner has not seen.
 *
 * @param v Raw target.
 * @returns The target (null when there is none), or 'unreadable'.
 */
function targetOf(v: unknown): Target | null | 'unreadable' {
	if (v === null || v === undefined) return null;
	const t = obj(v);
	const target = t ? { label: text(t.label, 120), key: text(t.key, 120), href: text(t.href, 2_000) } : null;
	return target && (target.label || target.key || target.href) ? target : 'unreadable';
}

/**
 * Read an interaction.
 *
 * @param raw Interaction object from the API.
 * @returns Interaction, or null without a usable id.
 */
export function toInteraction(raw: unknown): Interaction | null {
	const r = obj(raw);
	if (!r) return null;
	const id = typeof r.id === 'string' && UUID.test(r.id) ? r.id : null;
	const issueId = typeof r.issueId === 'string' && UUID.test(r.issueId) ? r.issueId : null;
	if (!id || !issueId) return null;
	const p = obj(r.payload) ?? {};
	const status = text(r.status, 40) ?? 'unknown';
	const base: Base = {
		id, issueId, status,
		title: text(r.title, 240),
		createdAt: text(r.createdAt, 40) ?? new Date(0).toISOString(),
		supersededByMessage: p.supersedeOnUserComment === true,
		wakes: r.continuationPolicy === 'wake_assignee' ? 'answer' : r.continuationPolicy === 'wake_assignee_on_accept' ? 'yes' : null,
		fingerprint: `${status}|${JSON.stringify(r.payload ?? null)}|${JSON.stringify(r.result ?? null)}`,
	};
	const unseen = 'This is about something the plant cannot show. Decide it in Paperclip, where you can see what a yes would allow.';
	const unknown = (): Interaction => ({ ...base, kind: 'unknown', rawKind: text(r.kind, 60) ?? 'unknown' });
	const choices = (v: unknown) => objects(v).map(choice).filter((c): c is Choice => !!c);
	switch (r.kind) {
		case 'request_confirmation': {
			const prompt = text(p.prompt);
			if (!prompt) return unknown();
			// A yes here can approve a tool action or a secret proposal: those are decided in Paperclip.
			const target = targetOf(p.target);
			const locked = p.toolAction ? 'This asks you to approve an action by a tool. Decide it in Paperclip, where you can see all of it.'
				: p.secretProposal ? 'This asks you to approve a secret. Decide it in Paperclip, where you can see all of it.'
					: target === 'unreadable' ? unseen : null;
			return { ...base, kind: 'confirm', prompt, details: text(p.detailsMarkdown, 20_000), target: target === 'unreadable' ? null : target, acceptLabel: text(p.acceptLabel, 80), rejectLabel: text(p.rejectLabel, 80), reasonRequired: p.rejectRequiresReason === true, reasonAllowed: p.allowDeclineReason !== false, locked };
		}
		case 'request_checkbox_confirmation': {
			const prompt = text(p.prompt);
			const options = choices(p.options);
			if (!prompt || !options.length) return unknown();
			const known = new Set(options.map((o) => o.id));
			const defaults = Array.isArray(p.defaultSelectedOptionIds) ? p.defaultSelectedOptionIds.filter((x): x is string => typeof x === 'string' && known.has(x)) : [];
			const min = typeof p.minSelected === 'number' && Number.isInteger(p.minSelected) && p.minSelected >= 0 ? p.minSelected : 0;
			const max = typeof p.maxSelected === 'number' && Number.isInteger(p.maxSelected) && p.maxSelected >= 0 ? p.maxSelected : null;
			const target = targetOf(p.target);
			return { ...base, kind: 'checklist', prompt, details: text(p.detailsMarkdown, 20_000), target: target === 'unreadable' ? null : target, options, defaults, min, max, acceptLabel: text(p.acceptLabel, 80), rejectLabel: text(p.rejectLabel, 80), reasonRequired: p.rejectRequiresReason === true, reasonAllowed: p.allowDeclineReason !== false, locked: target === 'unreadable' ? unseen : null };
		}
		case 'ask_user_questions': {
			const questions = objects(p.questions).map((q): Question | null => {
				const qid = text(q.id, 160), prompt = text(q.prompt);
				const options = choices(q.options);
				if (!qid || !prompt || !options.length || (q.selectionMode !== 'single' && q.selectionMode !== 'multi')) return null;
				return { id: qid, prompt, help: text(q.helpText), multi: q.selectionMode === 'multi', required: q.required === true, options, other: q.allowOther !== false && !options.some((o) => o.freeText) };
			});
			if (!questions.length || questions.length > ANSWERS_MAX || questions.some((q) => !q)) return unknown();
			return { ...base, kind: 'questions', questions: questions as Question[], submitLabel: text(p.submitLabel, 120) };
		}
		case 'suggest_tasks': {
			const tasks = objects(p.tasks).map((t): SuggestedTask | null => {
				const key = text(t.clientKey, 120), title = text(t.title, 240);
				if (!key || !title) return null;
				const who = typeof t.assigneeAgentId === 'string' && UUID.test(t.assigneeAgentId) ? t.assigneeAgentId : null;
				return { key, title, description: text(t.description, 20_000), assigneeAgentId: who, parentKey: text(t.parentClientKey, 120) };
			});
			if (!tasks.length || tasks.some((t) => !t)) return unknown();
			return { ...base, kind: 'tasks', tasks: tasks as SuggestedTask[] };
		}
		case 'request_item_verdicts': {
			const prompt = text(p.prompt);
			const values0 = new Set<unknown>(['approve', 'reject', 'defer']);
			const decided = new Map(objects(obj(r.result)?.items).filter((x) => typeof x.id === 'string' && values0.has(x.verdict)).map((x) => [x.id as string, x.verdict as VerdictValue]));
			const items = objects(p.items).map((x): VerdictItem | null => {
				const c = choice(x);
				return c ? { ...c, preview: text(x.previewMarkdown, 20_000), href: text(x.href, 2_000), decided: decided.get(c.id) ?? null } : null;
			}).filter((x): x is VerdictItem => !!x);
			if (!prompt || !items.length) return unknown();
			const values = (v: unknown, d: VerdictValue[]): VerdictValue[] => Array.isArray(v) ? v.filter((x): x is VerdictValue => x === 'approve' || x === 'reject' || x === 'defer') : d;
			const verdicts = values(p.verdicts, ['approve', 'reject']);
			if (!verdicts.includes('approve') || !verdicts.includes('reject')) return unknown();
			return { ...base, kind: 'verdicts', prompt, details: text(p.detailsMarkdown, 20_000), items, verdicts, reasonOn: values(p.requireReasonOn, ['reject']) };
		}
		case 'connection_intent': {
			const service = text(p.serviceName, 160);
			return service ? { ...base, kind: 'connect', service } : unknown();
		}
		default:
			return unknown();
	}
}

/**
 * Every interaction on an issue, oldest first.
 *
 * @param f Fetch.
 * @param issueId Issue.
 * @returns Interactions.
 */
export async function listInteractions(f: FetchLike, issueId: string): Promise<Result<Interaction[]>> {
	if (!UUID.test(issueId)) return { ok: false, session: 'unreachable', status: 0, detail: 'The issue id is not in the form Paperclip uses.' };
	const g = await request(f, 'GET', `/api/issues/${issueId}/interactions`);
	if (!g.ok) return fail(g);
	const list = listOf(g.body).map(toInteraction).filter((x): x is Interaction => !!x && x.issueId === issueId);
	return { ok: true, value: list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
}

/** What an answer came to: done, refused before sending because the question moved on, or failed. */
export type Answered = { ok: true; value: Interaction | null } | { ok: false; stale: string } | Failure;

/**
 * Answer an interaction. It is read again first: if it is no longer pending, or has changed since
 * it was shown, nothing is sent and the sentence says why.
 *
 * @param f Fetch.
 * @param shown The interaction as the owner saw it.
 * @param a The answer.
 * @returns The interaction as answered (null if Paperclip's answer could not be read), stale, or a failure.
 */
export async function answer(f: FetchLike, shown: Interaction, a: Answer): Promise<Answered> {
	if (!UUID.test(shown.issueId) || !UUID.test(shown.id)) return { ok: false, session: 'unreachable', status: 0, detail: 'The question\'s id is not in the form Paperclip uses, so nothing was sent.' };
	if (shown.kind === 'connect' || shown.kind === 'unknown' || ((shown.kind === 'confirm' || shown.kind === 'checklist') && shown.locked)) return { ok: false, stale: 'This one is answered in Paperclip, not here.' };
	const now = await listInteractions(f, shown.issueId);
	if (!now.ok) return now;
	const fresh = now.value.find((x) => x.id === shown.id);
	if (!fresh) return { ok: false, stale: 'The question is no longer there, so nothing was sent.' };
	if (fresh.status !== 'pending') return { ok: false, stale: 'The question has been answered or withdrawn meanwhile, so nothing was sent.' };
	if (fresh.fingerprint !== shown.fingerprint) return { ok: false, stale: 'The question changed after you read it, so nothing was sent. Read it again.' };
	// Each kind of answer has an endpoint of the same name.
	const { kind, ...body } = a;
	const g = await request(f, 'POST', `/api/issues/${shown.issueId}/interactions/${shown.id}/${kind}`, body);
	if (!g.ok) return fail(g);
	return { ok: true, value: toInteraction(g.body) };
}

/**
 * A resolved interaction in a sentence, for the chat log.
 *
 * @param i Interaction.
 * @returns Sentence.
 */
export function outcomeWords(i: Interaction): string {
	const what = i.title ? `"${i.title}"` : i.kind === 'questions' ? 'The questions' : 'The request';
	switch (i.status) {
		case 'answered': return `${what}: answered.`;
		case 'accepted': return `${what}: accepted.`;
		case 'rejected': return `${what}: declined.`;
		case 'expired': return `${what}: withdrawn by a later message.`;
		case 'cancelled': case 'withdrawn': return `${what}: withdrawn.`;
		case 'skipped': return `${what}: skipped.`;
		default: return `${what}: ${i.status.replace(/_/g, ' ')}.`;
	}
}
