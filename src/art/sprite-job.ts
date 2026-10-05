/**
 * One comrade sprite frame as plain, transferable data: the unit of work the preview's
 * render workers take. Pure and DOM-free, so it runs the same in a Web Worker, on the main
 * thread and in Node (scripts and tests keep calling `renderAvatar` directly).
 */

import { type PigeonFrame, renderFarTrain, renderPigeon, renderPuff } from './ambient';
import { type Anim, type Dir, headTopIn, renderAvatar } from './avatar';
import { type BannerDir, renderBanner, renderBear, renderFlag, renderSputnik } from './eggs';
import { type Facing, type PieceKind, renderPiece } from './furniture';
import type { Outfit } from './outfits';
import { type BaseFrame, HAZE, renderLandmark, wasteLandmarks } from './wasteland';

/** Everything needed to render one frame. The outfit is plain data, so it survives postMessage. */
export interface SpriteRequest {
	outfit: Outfit;
	anim: Anim;
	dir: Dir;
	frame: number;
}

/** A furniture piece to render, turned. */
export interface PieceRequest {
	piece: PieceKind;
	facing: Facing;
}

/**
 * The life around the plant: a puff of smoke, a pigeon, the far train (already faded
 * into the haze), or one of the wasteland's landmarks again (drawn over the far train, which passes
 * behind them).
 */
export type AmbientRequest =
	| { ambient: 'puff'; k: number }
	| { ambient: 'pigeon'; f: PigeonFrame; yaw: number }
	| { ambient: 'farTrain'; base: BaseFrame }
	| { ambient: 'landmark'; id: string; base: BaseFrame }
	// The easter eggs: a marcher's flag, the parade's banner, Sputnik, the bear.
	| { ambient: 'flag'; dir: Dir }
	| { ambient: 'banner'; dir: BannerDir }
	| { ambient: 'sputnik' }
	| { ambient: 'bear'; f: number; yaw: number };

/**
 * The cache key for a picture of the life around the plant: different for every different picture.
 *
 * @param r Request.
 * @returns Key.
 */
export function ambientKey(r: AmbientRequest): string {
	switch (r.ambient) {
		case 'puff': return `puff|${r.k}`;
		case 'pigeon': return `pigeon|${r.f}|${r.yaw}`;
		case 'landmark': return `landmark|${r.id}`;
		case 'farTrain': return 'farTrain';
		case 'flag': return `flag|${r.dir}`;
		case 'banner': return `banner|${r.dir}`;
		case 'sputnik': return 'sputnik';
		case 'bear': return `bear|${r.f}|${r.yaw}`;
		default: { const never: never = r; return never; }
	}
}

/** How far the far train is faded into the haze. */
export const FAR_TRAIN_HAZE = 0.7;

/** Anything the render workers take. */
export type JobRequest = SpriteRequest | PieceRequest | AmbientRequest;

/** A rendered frame stripped to what a display needs: pixels plus the speech-bubble anchor. */
export interface SpritePixels {
	w: number;
	h: number;
	/** RGBA, row-major. Its buffer is transferred (not copied) out of a worker. */
	rgba: Uint8ClampedArray;
	/**
	 * Point just above the head or hat, in sprite pixels (see `headTopIn`); for a piece, a pigeon,
	 * a puff or the far train, its anchor; for a landmark, where its top-left goes on the base layer.
	 */
	top: { x: number; y: number };
}

/**
 * Cache and de-duplication key for one frame of one outfit.
 *
 * @param {string} outfitId Outfit id (the same id always means the same clothes).
 * @param {Anim} anim Animation.
 * @param {Dir} dir Direction.
 * @param {number} frame Frame index.
 * @returns {string} Key.
 */
export function spriteKey(outfitId: string, anim: Anim, dir: Dir, frame: number): string {
	return `${outfitId}|${anim}|${dir}|${frame}`;
}

/**
 * Render one frame and read its head-top point while the group buffer is still at hand,
 * so the depth and group buffers never have to cross a thread boundary.
 *
 * @param {SpriteRequest} r Outfit, animation, direction and frame.
 * @returns {SpritePixels} Pixels and head-top point.
 */
export function renderSprite(r: SpriteRequest): SpritePixels {
	const f = renderAvatar(r.outfit, r.anim, r.dir, r.frame);
	return { w: f.w, h: f.h, rgba: f.rgba, top: headTopIn(f) };
}

/**
 * Render whatever a job asks for: a comrade's frame, or a piece of furniture whose `top` is the
 * middle of its tile.
 *
 * @param {JobRequest} r Request.
 * @returns {SpritePixels} Pixels.
 */
export function renderJob(r: JobRequest): SpritePixels {
	if ('piece' in r) {
		const f = renderPiece(r.piece, r.facing);
		return { w: f.w, h: f.h, rgba: f.rgba, top: { x: f.ax, y: f.ay } };
	}
	if ('ambient' in r) {
		if (r.ambient === 'landmark') {
			const m = wasteLandmarks().find((x) => x.id === r.id);
			if (!m) throw new Error(`There is no landmark called ${r.id}.`);
			const s = renderLandmark(r.base, m);
			return { w: s.sprite.w, h: s.sprite.h, rgba: s.sprite.rgba, top: { x: s.x, y: s.y } };
		}
		const f = r.ambient === 'puff' ? renderPuff(r.k)
			: r.ambient === 'pigeon' ? renderPigeon(r.f, r.yaw)
			: r.ambient === 'flag' ? renderFlag(r.dir)
			: r.ambient === 'banner' ? renderBanner(r.dir)
			: r.ambient === 'sputnik' ? renderSputnik()
			: r.ambient === 'bear' ? renderBear(r.f, r.yaw)
			: renderFarTrain(r.base);
		if (r.ambient === 'farTrain') {
			const h = [1, 3, 5].map((k) => parseInt(HAZE.slice(k, k + 2), 16));
			for (let k = 0; k < f.rgba.length; k += 4) for (let c = 0; c < 3; c++) f.rgba[k + c] += (h[c] - f.rgba[k + c]) * FAR_TRAIN_HAZE;
		}
		return { w: f.w, h: f.h, rgba: f.rgba, top: { x: f.ax, y: f.ay } };
	}
	return renderSprite(r);
}
