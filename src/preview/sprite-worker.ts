/**
 * Render worker: renders comrade frames off the main thread and hands the pixels back by
 * transferring their buffer, so nothing is copied. Loaded by sprite-client.ts through Vite's
 * `new Worker(new URL(...), { type: 'module' })`. A worker of its own can instead be asked for
 * the wasteland behind the plant (backdrop.ts), which it sends back piece by piece.
 */

import { type JobRequest, renderJob } from '../art/sprite-job';
import { type BackdropReply, type BackdropRequest, backdropPieces } from '../cockpit/backdrop';

/** Message from the page: one frame (or furniture piece) to render, tagged so the reply can be matched to it. */
export interface WorkerIn { id: number; req: JobRequest }

/** Reply: the frame's pixels and head-top point, or why it could not be rendered. */
export type WorkerOut =
	| { id: number; ok: true; w: number; h: number; rgba: ArrayBuffer; top: { x: number; y: number } }
	| { id: number; ok: false; message: string };

// The DOM lib types `self` as a Window; in a dedicated worker only these two members matter.
const scope = self as unknown as {
	onmessage: ((e: MessageEvent<WorkerIn | BackdropRequest>) => void) | null;
	postMessage(msg: WorkerOut | BackdropReply, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
	if ('backdrop' in e.data) {
		const { base, trackY } = e.data.backdrop;
		try {
			backdropPieces(base, trackY, (p) => {
				const buf = p.rgba.buffer as ArrayBuffer;
				scope.postMessage({ backdropPiece: { x: p.x, y: p.y, w: p.w, h: p.h, rgba: buf } }, [buf]);
			});
			scope.postMessage({ backdropDone: true });
		} catch (err) {
			scope.postMessage({ backdropFailed: (err as Error).message ?? String(err) });
		}
		return;
	}
	const { id, req } = e.data;
	try {
		const px = renderJob(req);
		const buf = px.rgba.buffer as ArrayBuffer;
		scope.postMessage({ id, ok: true, w: px.w, h: px.h, rgba: buf, top: px.top }, [buf]);
	} catch (err) {
		scope.postMessage({ id, ok: false, message: (err as Error).message ?? String(err) });
	}
};
