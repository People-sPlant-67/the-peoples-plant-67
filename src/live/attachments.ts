/**
 * Files on issues ("parcels" in the plant): upload one to an issue, list an issue's files, and
 * the link to fetch one. Paperclip decides which types it accepts; the plant checks only the
 * size first, because above the limit the live instance drops the connection instead of answering.
 *
 * Seen on the live instance (2026.916.0): POST /companies/:id/issues/:id/attachments takes one
 * multipart field `file` and answers 201 with the attachment; above 10 MB it answers 422 with a
 * sentence. A comment's `attachmentIds` hangs uploaded files on that comment.
 */
import type { Result } from './directives';
import { type FetchLike, UUID, fail, request } from './http';
import { listOf } from './poller';

/** Paperclip's default limit per file (10 MB). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Most files on one message (Paperclip allows 20 per comment). */
export const MAX_FILES = 10;

/** A file on an issue, as the plant shows it. */
export interface Parcel {
	id: string;
	name: string;
	bytes: number;
	/** The comment it hangs on, or null for a file on the issue itself. */
	commentId: string | null;
}

/** The slice of a browser File the plant reads. */
export interface FileLike extends Blob {
	readonly name: string;
}

/**
 * A file size in words.
 *
 * @param n Bytes.
 * @returns For example "12 KB" or "3.4 MB".
 */
export function sizeWords(n: number): string {
	if (n < 1024) return `${n} bytes`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * Check a file before it goes in the box.
 *
 * @param file File.
 * @returns A sentence saying what is wrong, or null when it can be sent.
 */
export function fileProblem(file: { name: string; size: number }): string | null {
	if (file.size === 0) return `${file.name} is empty, so it was not added.`;
	if (file.size > MAX_FILE_BYTES) return `${file.name} is ${sizeWords(file.size)}; Paperclip takes files up to ${sizeWords(MAX_FILE_BYTES)}, so it was not added.`;
	return null;
}

/**
 * Read an attachment.
 *
 * @param raw Attachment object from the API.
 * @returns Parcel, or null without a usable id.
 */
export function toParcel(raw: unknown): Parcel | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const id = typeof r.id === 'string' && UUID.test(r.id) ? r.id : null;
	if (!id) return null;
	const comment = typeof r.issueCommentId === 'string' && UUID.test(r.issueCommentId) ? r.issueCommentId : null;
	return {
		id,
		name: typeof r.originalFilename === 'string' && r.originalFilename.trim() ? r.originalFilename.trim().slice(0, 200) : 'A file',
		bytes: typeof r.byteSize === 'number' && Number.isFinite(r.byteSize) && r.byteSize >= 0 ? r.byteSize : 0,
		commentId: comment,
	};
}

/**
 * Where a parcel is fetched from. Always as a download: a file an agent uploaded could be a web
 * page, and opening it as a page would run it with the owner's Paperclip sign-in. Paperclip's
 * content route answers `download=1` with `Content-Disposition: attachment` (open-source server,
 * routes/issues.ts), and the live instance's own `downloadPath` is this same path, so the header
 * holds however the link is opened (a new tab or a middle click ignores the `download` attribute).
 *
 * @param p Parcel.
 * @returns Same-origin path.
 */
export function parcelHref(p: Parcel): string {
	return `/api/attachments/${p.id}/content?download=1`;
}

/**
 * Upload one file to an issue.
 *
 * @param f Fetch.
 * @param companyId Company.
 * @param issueId Issue.
 * @param file File.
 * @returns The parcel as saved.
 */
export async function uploadFile(f: FetchLike, companyId: string, issueId: string, file: FileLike): Promise<Result<Parcel>> {
	if (!UUID.test(companyId) || !UUID.test(issueId)) return { ok: false, session: 'unreachable', status: 0, detail: 'The issue id is not in the form Paperclip uses, so nothing was sent.' };
	const problem = fileProblem(file);
	if (problem) return { ok: false, session: 'unreachable', status: 0, detail: problem };
	const form = new FormData();
	form.append('file', file, file.name);
	const g = await request(f, 'POST', `/api/companies/${companyId}/issues/${issueId}/attachments`, form);
	if (!g.ok) return fail(g);
	const p = toParcel(g.body);
	return p ? { ok: true, value: p } : { ok: false, session: 'unreachable', status: 201, detail: null };
}

/**
 * Every file on an issue.
 *
 * @param f Fetch.
 * @param issueId Issue.
 * @returns Parcels.
 */
export async function listParcels(f: FetchLike, issueId: string): Promise<Result<Parcel[]>> {
	if (!UUID.test(issueId)) return { ok: false, session: 'unreachable', status: 0, detail: 'The issue id is not in the form Paperclip uses.' };
	const g = await request(f, 'GET', `/api/issues/${issueId}/attachments`);
	if (!g.ok) return fail(g);
	return { ok: true, value: listOf(g.body).map(toParcel).filter((p): p is Parcel => !!p) };
}
