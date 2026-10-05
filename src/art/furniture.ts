/**
 * Furniture: the catalogue the owner furnishes the plant from. Each floor piece is
 * modelled once, standing on the origin and facing +x (screen south-east), and is turned by
 * rendering it with a turned view, the way comrades are, so a quarter turn costs no new model.
 * Every piece fits on one tile. The posters are wall signs, painted like env.ts's.
 */
import { textWidth } from './font';
import { INK, type MaterialName } from './palette';
import { type Frame, RES, TILE, fitBounds, makeView, project, render } from './render';
import { type Footprint, type Prop, footprintOf } from './scene';
import { type Pattern, type Prim, type V3, box, cone, cylinder, ellipsoid, hash, roundCone } from './sdf';
import { type Sign, STAR, bitmap, centred } from './env';

/** A floor piece in the catalogue. */
export type PieceKind = 'palm' | 'rubber' | 'lenin' | 'banner' | 'globe' | 'bookcase' | 'soda' | 'chess' | 'firePoint' | 'loudspeaker';
/** A poster in the catalogue. */
export type PosterKind = 'space' | 'harvest' | 'quiet' | 'lenin' | 'fiveYear';
/** Quarter turns from facing south-east: 0 SE, 1 SW, 2 NW, 3 NE. */
export type Facing = 0 | 1 | 2 | 3;

/** Every floor piece, in the drawer's order. */
export const PIECE_KINDS: readonly PieceKind[] = ['palm', 'rubber', 'lenin', 'banner', 'globe', 'bookcase', 'soda', 'chess', 'firePoint', 'loudspeaker'];
/** Every poster, in the drawer's order. */
export const POSTER_KINDS: readonly PosterKind[] = ['space', 'harvest', 'quiet', 'lenin', 'fiveYear'];

/**
 * A ring lying in the x–z plane (its axis along y), for the globe's meridian.
 *
 * @param c Centre.
 * @param R Ring radius.
 * @param r Tube radius.
 * @param mat Material.
 * @param group Outline group.
 * @returns Primitive.
 */
function ring(c: V3, R: number, r: number, mat: MaterialName, group: string): Prim {
	return {
		sdf: (x, y, z) => {
			const dx = x - c[0], dy = y - c[1], dz = z - c[2];
			const q = Math.sqrt(dx * dx + dz * dz) - R;
			return Math.sqrt(q * q + dy * dy) - r;
		},
		mat, group, origin: c,
		min: [c[0] - R - r, c[1] - r, c[2] - R - r], max: [c[0] + R + r, c[1] + r, c[2] + R + r],
	};
}

/**
 * A pixel picture laid on a face that looks along +x: u runs across it (towards -y, screen
 * right), v down it. Lets a star or a stripe sit on a cloth or a panel as a surface pattern.
 *
 * @param rows Picture rows, '#' = on.
 * @param cell World units per picture pixel.
 * @param mat Material where it is on.
 * @returns Pattern, centred on the primitive's origin.
 */
function picture(rows: readonly string[], cell: number, mat: MaterialName): Pattern {
	const w = rows[0].length, h = rows.length;
	return (_lx, ly, lz, nx) => {
		if (nx < 0.9) return null;
		const u = Math.floor(-ly / cell + w / 2), v = Math.floor(-lz / cell + h / 2);
		return rows[v]?.[u] === '#' ? { mat } : null;
	};
}

/**
 * A fan of palm fronds from a crown: each frond rises, then droops, in two tapering segments.
 *
 * @param p Primitives to push into.
 * @param top The crown.
 * @param n How many fronds.
 * @param reach How far each reaches out.
 */
function fronds(p: Prim[], top: V3, n: number, reach: number): void {
	for (let k = 0; k < n; k++) {
		const a = (k / n) * Math.PI * 2 + 0.3;
		const dx = Math.cos(a), dy = Math.sin(a);
		const mid: V3 = [top[0] + dx * reach * 0.5, top[1] + dy * reach * 0.5, top[2] + 7 + (k % 2) * 3];
		const tip: V3 = [top[0] + dx * reach, top[1] + dy * reach, top[2] - 6 - (k % 3) * 3];
		const leaflets: Pattern = (lx, ly) => (Math.floor((lx * dx + ly * dy) / 2.2) % 2 ? { shift: -1 } : null);
		p.push(roundCone(top, mid, 1.4, 2.6, 'bottleGreen', { group: `frond${k}`, pattern: leaflets }));
		p.push(roundCone(mid, tip, 2.6, 0.9, 'bottleGreen', { group: `frond${k}`, pattern: leaflets }));
	}
}

/** Book spines' colours, read along a shelf. */
const SPINES: MaterialName[] = ['red', 'navyWork', 'bottleGreen', 'brownLeather', 'mustard', 'red', 'cream', 'oliveDrab', 'brickRed', 'charcoal'];

/** Each piece's model: standing on the origin, its front towards +x. */
const MODELS: Record<PieceKind, () => Prim[]> = {
	// A palm in a hooped wooden tub: the kind every Palace of Culture lobby had.
	palm: () => {
		const p: Prim[] = [];
		p.push(cylinder([0, 0, 8], 10, 8, 1.2, 'wood', { group: 'tub', pattern: (_lx, _ly, lz, _nx, _ny, nz) => (nz < 0.9 && Math.abs(Math.abs(lz) - 4.5) < 1.1 ? { mat: 'iron' } : null) }));
		p.push(cylinder([0, 0, 16.2], 8.6, 0.6, 0.3, 'oil', { group: 'soil' }));
		p.push(roundCone([0, 0, 15], [1.5, -1, 56], 2.8, 1.8, 'wood', { group: 'trunk', pattern: (_lx, _ly, lz) => (((lz % 4) + 4) % 4 < 1.2 ? { shift: -1 } : null) }));
		fronds(p, [1.5, -1, 56], 8, 18.5);
		return p;
	},
	// A rubber plant (фикус) in an enamel pot: big glossy leaves up a single stem.
	rubber: () => {
		const p: Prim[] = [];
		p.push(cone([0, 0, 8], 8, 7, 9, 'medWhite', { group: 'pot', pattern: (_lx, _ly, lz) => (Math.abs(lz - 4) < 1.4 ? { mat: 'navyWork' } : null) }));
		p.push(roundCone([0, 0, 14], [0, 0, 64], 1.2, 0.9, 'woodDark', { group: 'stem' }));
		const leaves: [number, number, number][] = [[1, 0, 24], [0, 1, 30], [-1, 0, 36], [0, -1, 42], [1, 0, 48], [0, 1, 54], [-1, 0, 59]];
		leaves.forEach(([sx, sy, z], k) => {
			const r: V3 = [sx ? 9 : 4.4, sy ? 9 : 4.4, 2];
			p.push(ellipsoid([sx * 8.5, sy * 8.5, z], r, 'pine', { group: `leaf${k}`, pattern: (lx, ly) => (Math.abs(sx ? ly : lx) < 0.5 ? { shift: 1 } : null) }));
		});
		p.push(ellipsoid([0, 0, 66], [2, 2, 4], 'pine', { group: 'bud' }));
		return p;
	},
	// A bronze bust of Lenin on a red plinth with a gold plate: the red corner's centrepiece.
	lenin: () => {
		const p: Prim[] = [];
		p.push(box([0, 0, 2], [11, 11, 2], 0.5, 'brickRed', { group: 'plinthFoot' }));
		p.push(box([0, 0, 18], [9, 9, 14], 0.6, 'red', { group: 'plinth', pattern: (_lx, ly, lz, nx) => (nx > 0.9 && Math.abs(ly) < 5 && Math.abs(lz - 4) < 2.2 ? { mat: 'gold' } : null) }));
		p.push(box([0, 0, 33], [10, 10, 1.2], 0.4, 'brickRed', { group: 'plinthTop' }));
		// Jacket shoulders with the shirt and tie showing in a V at the front.
		p.push(ellipsoid([0, 0, 39.5], [7.5, 12, 6], 'bronze', {
			group: 'shoulders',
			pattern: (lx, ly, lz) => (lx > 4 && Math.abs(ly) < (lz + 2) * 0.9 && lz > -2 ? { shift: Math.abs(ly) < 0.9 ? -1 : 1 } : null),
		}));
		p.push(roundCone([0, 0, 42], [0.5, 0, 48], 3.8, 3.4, 'bronze', { group: 'neck' }));
		// The great bald dome, a brow over shadowed eyes, ears either side.
		p.push(ellipsoid([0, 0, 54], [6.6, 6, 7.4], 'bronze', {
			group: 'head',
			pattern: (lx, ly, lz) => (lx > 4.8 && lz > -1.6 && lz < 0.2 && Math.abs(ly) > 0.8 ? { shift: -2 } : lz > 3 ? { shift: 1 } : null),
		}));
		for (const s of [-1, 1]) p.push(ellipsoid([-0.5, s * 6, 53], [1.4, 1, 2], 'bronze', { group: `ear${s}` }));
		// The moustache and pointed goatee: what makes a bald bronze head Lenin.
		p.push(ellipsoid([5.9, 0, 50.3], [1.2, 3, 0.9], 'bronze', { group: 'moustache', pattern: () => ({ shift: -1 }) }));
		p.push(roundCone([5.2, 0, 48.4], [6.4, 0, 44.6], 2.4, 0.8, 'bronze', { group: 'beard', pattern: () => ({ shift: -1 }) }));
		return p;
	},
	// A red velvet banner (знамя) on a stand: gold star, fringe and tassels, a spear on top.
	banner: () => {
		const p: Prim[] = [];
		for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) p.push(roundCone([0, 0, 2], [dx * 10, dy * 10, 0.8], 1.6, 1, 'woodDark', { group: 'feet' }));
		p.push(roundCone([0, 0, 0], [0, 0, 98], 1.2, 1, 'woodDark', { group: 'pole' }));
		p.push(cone([0, 0, 101], 3.5, 2.2, 0, 'gold', { group: 'spear' }));
		p.push(roundCone([0.5, -15, 90], [0.5, 15, 90], 0.8, 0.8, 'gold', { group: 'bar' }));
		const star = picture(STAR, 1.6, 'gold');
		p.push(box([1.5, 0, 72], [0.7, 14, 17], 0.3, 'red', {
			group: 'cloth',
			pattern: (lx, ly, lz, nx, ny, nz) => (lz < -14.2 ? { mat: 'gold', shift: Math.floor(ly) % 2 ? -1 : 0 } : star(lx, ly, lz - 3, nx, ny, nz) ?? (Math.sin(ly / 3) > 0.6 ? { shift: -1 } : null)),
		}));
		for (const s of [-1, 1]) p.push(ellipsoid([1.5, s * 14.5, 51], [1.4, 1.4, 3], 'gold', { group: `tassel${s}` }));
		return p;
	},
	// A schoolroom globe on a turned stand, brass meridian round it.
	globe: () => {
		const p: Prim[] = [];
		p.push(cylinder([0, 0, 1.5], 8, 1.5, 0.6, 'woodDark', { group: 'globeFoot' }));
		p.push(roundCone([0, 0, 2], [0, 0, 26], 2.2, 1.4, 'woodDark', { group: 'globeStem' }));
		p.push(ring([0, 0, 40], 13.5, 0.9, 'brass', 'meridian'));
		p.push(ellipsoid([0, 0, 40], [11.5, 11.5, 11.5], 'fadedBlue', {
			group: 'globe',
			pattern: (lx, ly, lz) => {
				const lon = Math.atan2(ly, lx), lat = Math.asin(Math.max(-1, Math.min(1, lz / 11.5)));
				if (Math.abs(lat) > 1.25) return { mat: 'medWhite' };
				const n = hash(Math.floor(lon * 2.2), Math.floor(lat * 3), 67) + hash(Math.floor(lon * 4.4), Math.floor(lat * 6), 68) * 0.5;
				return n > 0.95 ? { mat: n > 1.2 ? 'sand' : 'oliveDrab' } : null;
			},
		}));
		return p;
	},
	// A glazed-less bookcase of collected works, shelves of coloured spines.
	bookcase: () => {
		const p: Prim[] = [];
		p.push(box([-5.5, 0, 36], [1, 19, 36], 0.3, 'woodDark', { group: 'caseBack' }));
		for (const s of [-1, 1]) p.push(box([0, s * 18, 36], [6.5, 1.2, 36], 0.4, 'woodDark', { group: 'caseSide' }));
		for (const z of [1.5, 18, 35, 52, 70.5]) p.push(box([0, 0, z], [6.5, 19, 1.4], 0.4, 'woodDark', { group: 'caseShelf' }));
		[3, 20, 37, 54].forEach((z0, k) => {
			const hz = 6.2 - (k % 2) * 0.8;
			p.push(box([-0.5, 0, z0 + hz], [4.5, 16.6, hz], 0.2, 'red', {
				group: `books${k}`,
				pattern: (_lx, ly, lz, nx) => {
					const b = Math.floor((ly + 17) / 2.6);
					if (lz > hz - 1.6 - hash(b, k, 5) * 2.4) return nx > 0.9 ? { mat: 'oil' } : null;
					return { mat: SPINES[(b + k * 3) % SPINES.length], shift: nx > 0.9 && Math.abs(lz) < 0.8 ? 1 : 0 };
				},
			}));
		});
		return p;
	},
	// A gazirovka machine: soda water for three kopecks, one faceted glass for everybody.
	soda: () => {
		const p: Prim[] = [];
		p.push(box([0, 0, 32], [9, 13, 32], 1.2, 'medWhite', {
			group: 'sodaBody',
			pattern: (_lx, ly, lz, nx) => {
				if (lz > 22) return { mat: 'red', shift: nx > 0.9 && Math.abs(lz - 27) < 0.9 && Math.abs(ly) < 9 && Math.floor(ly) % 3 ? 2 : 0 };
				if (lz < -28) return { mat: 'red' };
				if (nx > 0.9 && lz > 15 && lz < 19 && Math.abs(ly + 7) < 3) return { mat: 'charcoal' };
				if (nx > 0.9 && Math.abs(lz - 10) < 1.6 && Math.abs(ly - 8.5) < 1.6) return { mat: 'brass' };
				return null;
			},
		}));
		// The niche the glass stands in, the glass, and the coin slot beside it.
		p.push(box([9.4, -1.5, 30], [0.6, 6, 7], 0.2, 'charcoal', { group: 'niche' }));
		p.push(cylinder([8.4, -1.5, 26.5], 1.6, 2.6, 0.3, 'ice', { group: 'glass', pattern: (lx, ly) => (Math.floor(Math.atan2(ly, lx) * 2.5) % 2 ? { shift: 1 } : null) }));
		p.push(box([9.4, 8, 36], [0.5, 1.2, 2], 0.2, 'iron', { group: 'slot' }));
		return p;
	},
	// A chess table with a game in progress and a stool at two opposite corners, so the players sit
	// side by side across the screen rather than one hiding the other.
	chess: () => {
		const p: Prim[] = [];
		p.push(box([0, 0, 24], [11, 11, 1.4], 0.4, 'wood', {
			group: 'board',
			pattern: (lx, ly, _lz, _nx, _ny, nz) => (nz > 0.9 && Math.abs(lx) < 9 && Math.abs(ly) < 9 ? { mat: (Math.floor((lx + 9) / 4.5) + Math.floor((ly + 9) / 4.5)) % 2 ? 'woodDark' : 'cream' } : null),
		}));
		p.push(roundCone([0, 0, 0.5], [0, 0, 23], 2.2, 1.6, 'woodDark', { group: 'tableLeg' }));
		p.push(cylinder([0, 0, 1], 7, 1, 0.4, 'woodDark', { group: 'tableFoot' }));
		const men: [number, number, MaterialName, number][] = [[-6, -4, 'medWhite', 4], [-2, 3, 'medWhite', 5], [3, -6, 'charcoal', 4], [5, 2, 'charcoal', 6], [1, -1, 'medWhite', 3.5], [6, 6, 'charcoal', 3.5]];
		men.forEach(([x, y, m, h], k) => {
			p.push(cone([x, y, 25.4 + h / 2], h / 2, 1.6, 0.7, m, { group: `man${k}` }));
			p.push(ellipsoid([x, y, 25.6 + h], [1, 1, 1], m, { group: `man${k}` }));
		});
		for (const s of [-1, 1]) {
			p.push(cylinder([s * 15, -s * 15, 15], 4.5, 1.2, 0.5, 'wood', { group: `stool${s}` }));
			p.push(roundCone([s * 15, -s * 15, 0], [s * 15, -s * 15, 14], 1.4, 1.2, 'woodDark', { group: `stoolLeg${s}` }));
		}
		return p;
	},
	// The fire point (пожарный щит): a red board with conical buckets, an axe, a hook and a
	// shovel, and the sand box in front.
	firePoint: () => {
		const p: Prim[] = [];
		for (const s of [-1, 1]) p.push(box([-3, s * 17, 33], [1.4, 1.4, 33], 0.3, 'woodDark', { group: 'boardLeg' }));
		p.push(box([-2, 0, 44], [1, 19, 20], 0.4, 'red', { group: 'fireBoard', pattern: (_lx, ly, lz, nx) => (nx > 0.9 && (Math.abs(Math.abs(ly) - 17.6) < 0.7 || Math.abs(Math.abs(lz) - 18.6) < 0.7) ? { mat: 'medWhite' } : null) }));
		for (const y of [-11, -3]) {
			p.push(cone([2.5, y, 50], 6, 0.6, 3.6, 'red', { group: `bucket${y}`, pattern: (_lx, _ly, lz) => (lz > 4.8 ? { mat: 'iron' } : null) }));
			p.push(box([0, y, 57.5], [1.6, 0.6, 0.6], 0.2, 'iron', { group: 'hook' }));
		}
		// The axe: handle down the board, head up top.
		p.push(roundCone([0.8, 7, 30], [0.8, 7, 54], 0.9, 0.9, 'wood', { group: 'axe' }));
		p.push(box([0.8, 9.2, 53], [0.6, 3, 2.4], 0.2, 'steel', { group: 'axeHead' }));
		// The hook (багор) along the bottom, and a shovel up the side.
		p.push(roundCone([0.8, -16, 30], [0.8, 14, 30], 0.7, 0.7, 'red', { group: 'bagor' }));
		p.push(box([0.8, 15, 31.8], [0.4, 0.6, 2.2], 0.1, 'iron', { group: 'bagor' }));
		p.push(roundCone([0.8, 13.5, 37], [0.8, 13.5, 61], 0.8, 0.8, 'wood', { group: 'shovel' }));
		p.push(box([0.8, 13.5, 37], [0.4, 3, 4], 0.4, 'iron', { group: 'shovelBlade' }));
		p.push(box([8, 0, 7], [6, 14, 7], 0.5, 'red', { group: 'sandBox', pattern: (_lx, _ly, lz, _nx, _ny, nz) => (nz > 0.9 && lz > 6 ? { mat: 'sand' } : null) }));
		return p;
	},
	// A street loudspeaker on a pole, two horns facing out: the radio-point (радиоточка) for the floor.
	loudspeaker: () => {
		const p: Prim[] = [];
		p.push(cylinder([0, 0, 2], 7, 2, 0.6, 'iron', { group: 'poleFoot' }));
		p.push(roundCone([0, 0, 0], [0, 0, 98], 1.6, 1.2, 'iron', { group: 'speakerPole' }));
		p.push(box([0, 0, 76], [3, 3, 4], 0.6, 'greyWool', { group: 'junction' }));
		// Two horns splayed apart, one to the front and one to the side, so both mouths face the room.
		p.push(roundCone([1, 0, 92], [15, 0, 94], 1.4, 5.6, 'medWhite', { group: 'horn0' }));
		p.push(ellipsoid([20.2, 0, 94], [0.6, 4.6, 4.6], 'charcoal', { group: 'mouth0' }));
		p.push(roundCone([0, 1, 86], [0, 15, 88], 1.4, 5.6, 'medWhite', { group: 'horn1' }));
		p.push(ellipsoid([0, 20.2, 88], [4.6, 0.6, 4.6], 'charcoal', { group: 'mouth1' }));
		return p;
	},
};

/** What the drawer and the card call each piece. */
export const PIECE_NAMES: Record<PieceKind, string> = {
	palm: 'Potted palm',
	rubber: 'Rubber plant',
	lenin: 'Bust of Lenin',
	banner: 'Red banner',
	globe: 'Globe',
	bookcase: 'Bookcase',
	soda: 'Soda-water machine',
	chess: 'Chess table',
	firePoint: 'Fire point',
	loudspeaker: 'Loudspeaker',
};

/**
 * A piece's primitives, standing on the origin and facing south-east.
 *
 * @param kind Piece.
 * @returns Primitives.
 */
export function piecePrims(kind: PieceKind): Prim[] {
	return MODELS[kind]();
}

/**
 * A piece's primitives turned and stood at a point in the world, for drawing it into a scene with
 * everything else (the plant's own soda machine and chess table). Each primitive is wrapped: the
 * world point, its surface offset and its normal are turned back into the piece's own frame, so its
 * shape and patterns are exactly as modelled.
 *
 * @param kind Piece.
 * @param facing Quarter turns from facing south-east.
 * @param at Where it stands.
 * @returns Primitives in world space.
 */
export function placedPrims(kind: PieceKind, facing: Facing, at: V3): Prim[] {
	const c = [1, 0, -1, 0][facing], s = [0, 1, 0, -1][facing];
	/** A world offset turned back into the piece's frame. */
	const back = (x: number, y: number): [number, number] => [x * c + y * s, -x * s + y * c];
	/** A piece offset turned out into the world. */
	const out = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
	return piecePrims(kind).map((p) => {
		const [ox, oy] = out(p.origin[0], p.origin[1]);
		const origin: V3 = [at[0] + ox, at[1] + oy, at[2] + p.origin[2]];
		const xs = [p.min[0], p.max[0]], ys = [p.min[1], p.max[1]];
		const corners = xs.flatMap((x) => ys.map((y) => out(x, y)));
		const min: V3 = [at[0] + Math.min(...corners.map((q) => q[0])), at[1] + Math.min(...corners.map((q) => q[1])), at[2] + p.min[2]];
		const max: V3 = [at[0] + Math.max(...corners.map((q) => q[0])), at[1] + Math.max(...corners.map((q) => q[1])), at[2] + p.max[2]];
		const pattern = p.pattern;
		return {
			...p, origin, min, max,
			sdf: (x: number, y: number, z: number) => { const [lx, ly] = back(x - at[0], y - at[1]); return p.sdf(lx, ly, z - at[2]); },
			pattern: pattern && ((lx: number, ly: number, lz: number, nx: number, ny: number, nz: number) => {
				const [px, py] = back(lx, ly), [qx, qy] = back(nx, ny);
				return pattern(px, py, lz, qx, qy, nz);
			}),
		};
	});
}

/**
 * A piece drawn alone, turned. Its anchor (ax, ay) is the middle of its tile on the floor.
 *
 * @param kind Piece.
 * @param facing Quarter turns from facing south-east.
 * @param res Pixels per world unit (the drawer's thumbnails use more).
 * @returns Frame.
 */
export function renderPiece(kind: PieceKind, facing: Facing, res = RES): Frame {
	const prims = piecePrims(kind);
	const view = makeView(facing * 90, res);
	return render(prims, { ...fitBounds(prims, view, 3), view });
}

/**
 * A piece's floor footprint once turned and stood at a point.
 *
 * @param kind Piece.
 * @param facing Quarter turns.
 * @param at Where it stands.
 * @returns Footprint.
 */
export function pieceFoot(kind: PieceKind, facing: Facing, at: V3): Footprint {
	const f = footprintOf(piecePrims(kind));
	// A quarter turn takes +x to +y: (x, y) → (-y, x).
	const corners = [[f.x0, f.y0], [f.x1, f.y1]].map(([x, y]) => {
		for (let k = 0; k < facing; k++) [x, y] = [-y, x];
		return [x, y];
	});
	const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
	return { x0: at[0] + Math.min(...xs), x1: at[0] + Math.max(...xs), y0: at[1] + Math.min(...ys), y1: at[1] + Math.max(...ys), z0: f.z0 };
}

/**
 * A piece as a scene prop, stood in the middle of a tile.
 *
 * @param id Prop id.
 * @param kind Piece.
 * @param facing Quarter turns.
 * @param tile Tile, x and y.
 * @param base The scene's base layer (for its anchor and view).
 * @returns Prop.
 */
export function pieceProp(id: string, kind: PieceKind, facing: Facing, tile: [number, number], base: Frame): Prop {
	const at: V3 = [(tile[0] + 0.5) * TILE, (tile[1] + 0.5) * TILE, 0];
	const sprite = renderPiece(kind, facing, base.view.res);
	const [px, py] = project(base, at);
	return { id, sprite, x: Math.round(px) - sprite.ax, y: Math.round(py) - sprite.ay, foot: pieceFoot(kind, facing, at) };
}

/**
 * Paint a picture into a poster from rows of letters, each letter a colour.
 *
 * @param s Poster.
 * @param rows Picture rows; '.' or a space is left alone.
 * @param x Left.
 * @param y Top.
 * @param ink Colour for each letter.
 */
function paint(s: Sign, rows: readonly string[], x: number, y: number, ink: Record<string, string>): void {
	rows.forEach((r, j) => [...r].forEach((ch, i) => {
		const c = ink[ch];
		if (c && s.b[y + j]?.[x + i] !== undefined) s.b[y + j][x + i] = c;
	}));
}

/**
 * A blank poster with a border.
 *
 * @param w Width.
 * @param h Height.
 * @param fill Paper.
 * @param edge Border.
 * @returns Poster.
 */
function sheet(w: number, h: number, fill: string, edge: string): Sign {
	const b = bitmap(w, h, fill);
	for (let i = 0; i < w; i++) b[0][i] = b[h - 1][i] = edge;
	for (let j = 0; j < h; j++) b[j][0] = b[j][w - 1] = edge;
	return { b, texts: [] };
}

/** Colours the posters use beyond the palette's poster inks. */
const PAPER = { night: '#1d2740', sky: '#3d4f74', skin: '#e3ab8c', skinDark: '#ad7352', wheat: '#d4b259', stalk: '#9b7728', smoke: '#6a6a65', steel: '#7f8c99' };

/** Each poster's artwork. */
const POSTERS: Record<PosterKind, () => Sign> = {
	// "КОСМОС НАШ!" (space is ours): a rocket climbing a night sky.
	space: () => {
		const s = sheet(29, 38, PAPER.night, INK.posterRedDark);
		for (let k = 0; k < 14; k++) s.b[2 + Math.floor(hash(k, 1, 13) * 26)][2 + Math.floor(hash(k, 2, 13) * 25)] = INK.posterCream;
		centred(s, 'КОСМОС', 2, INK.posterCream);
		paint(s, [
			'...c...',
			'..ccc..',
			'..ccc..',
			'.ccccc.',
			'.ccbcc.',
			'.cbbbc.',
			'.ccbcc.',
			'.ccccc.',
			'.crrrc.',
			'.ccccc.',
			'rrcccrr',
			'r.ccc.r',
			'..yyy..',
			'..ryr..',
			'...r...',
		], 11, 9, { c: INK.posterCream, b: PAPER.sky, r: INK.posterRed, y: INK.posterGold });
		paint(s, ['.........eeeeeeeeeee.........', '.....eeeeeeeeeeeeeeeeeee.....', '..eeeeeeeeeeeeeeeeeeeeeeeee..'], 0, 26, { e: PAPER.sky });
		for (let j = 29; j < 37; j++) for (let i = 1; i < 28; i++) s.b[j][i] = INK.posterRed;
		centred(s, 'НАШ!', 31, INK.posterCream);
		return s;
	},
	// "УРОЖАЙ — СТРАНЕ!" (the harvest, for the country): a sheaf of wheat bound with red, a sickle across it.
	harvest: () => {
		const s = sheet(29, 38, INK.posterRed, INK.posterRedDark);
		centred(s, 'УРОЖАЙ', 2, INK.posterGold);
		paint(s, [
			'.w..w..w..w..',
			'www.www.www.w',
			'.w.www.www.w.',
			'www.www.www.w',
			'.ww.www.www..',
			'..sssssssss..',
			'...sssssss...',
			'....sssss....',
			'....kkkkk....',
			'....sssss....',
			'...sssssss...',
			'..sssssssss..',
			'.sssssssssss.',
			'.s.s.s.s.s.s.',
		], 12, 10, { w: INK.posterGold, s: PAPER.wheat, k: INK.posterRedDark });
		paint(s, [
			'...cccc..',
			'.cc....c.',
			'c........',
			'c........',
			'c........',
			'.c.......',
			'..cc.....',
			'....cc...',
			'......hh.',
			'.......hh',
		], 3, 13, { c: INK.posterCream, h: PAPER.stalk });
		for (let j = 28; j < 37; j++) for (let i = 1; i < 28; i++) s.b[j][i] = INK.posterBlack;
		centred(s, 'СТРАНЕ!', 30, INK.posterCream);
		return s;
	},
	// "НЕ БОЛТАЙ!" (do not chatter): the woman in the red headscarf, a finger to her lips.
	quiet: () => {
		const s = sheet(31, 38, INK.posterCream, INK.posterBlack);
		centred(s, 'НЕ', 2, INK.posterRed);
		paint(s, [
			'.....RRRRR.....',
			'...RRRRRRRRR...',
			'..RRRRRRRRRRR..',
			'.RRRSSSSSSSRRR.',
			'.RRSSSSSSSSSRR.',
			'.RRSSKSSSKSSRR.',
			'.RRSSSSSSSSSRR.',
			'.RRSSSSDSSSSRR.',
			'..RSSSSFSSSSR..',
			'..RSSSMFMSSSR..',
			'...RSSSFSSSR...',
			'...RRSSFSSRR...',
			'..RRRRSHHSRRR..',
			'.RRR..HHHH.RRR.',
			'RRRR..HHHH..RRR',
			'RRR....HH....RR',
		], 8, 9, { R: INK.posterRed, S: PAPER.skin, K: INK.posterBlack, D: PAPER.skinDark, F: PAPER.skinDark, M: INK.posterRedDark, H: PAPER.skin });
		for (let j = 27; j < 37; j++) for (let i = 1; i < 30; i++) s.b[j][i] = INK.posterBlack;
		centred(s, 'БОЛТАЙ!', 30, INK.posterCream);
		return s;
	},
	// "ЛЕНИН": his portrait, bald dome, moustache and goatee, dark suit and tie.
	lenin: () => {
		const s = sheet(29, 38, INK.posterRed, INK.posterRedDark);
		paint(s, [
			'.....cccccc.....',
			'...cccccccccc...',
			'..cccccccccccc..',
			'..cccccccccccc..',
			'..cccccccccccc..',
			'.dcckkcccckkccd.',
			'.dccKccccccKccd.',
			'..cccccddccccc..',
			'..ccccccdcccc...',
			'..cckkkkkkkkcc..',
			'...ckkkcckkkc...',
			'...cckkkkkkcc...',
			'....ckkkkkkc....',
			'.....kkkkkk.....',
			'...jjjkkkkjjj...',
			'.jjjjjwrrwjjjjj.',
			'jjjjjjwrrwjjjjjj',
			'jjjjjjjrrjjjjjjj',
		], 6, 5, { c: PAPER.skin, d: PAPER.skinDark, k: INK.posterBlack, K: INK.posterBlack, j: INK.posterBlack, w: INK.posterCream, r: INK.posterRedDark });
		for (let j = 25; j < 37; j++) for (let i = 1; i < 28; i++) s.b[j][i] = INK.posterBlack;
		for (let i = 1; i < 28; i++) s.b[25][i] = INK.posterGold;
		centred(s, 'ЛЕНИН', 29, INK.posterGold);
		return s;
	},
	// "ПЯТИЛЕТКА" (the five-year plan): a works with smoking chimneys, a red arrow rising.
	fiveYear: () => {
		const s = sheet(47, 26, INK.posterCream, INK.posterRed);
		for (let i = 0; i < 47; i++) s.b[1][i] = s.b[24][i] = INK.posterRed;
		centred(s, 'ПЯТИЛЕТКА', 3, INK.posterRed);
		paint(s, [
			'....mm.........mm.................',
			'...mmmm.......mmmm....mm..........',
			'....mm...mm....mm....mmmm.........',
			'.....k..mmmm....k.....mm..........',
			'.....k...mm.....k......k..........',
			'.....k....k.....k......k..........',
			'.....k....k.....k......k..........',
			'..kkkkkkkkkkkkkkkkkkkkkkkkkk......',
			'..k.k.kk.k.kkk.k.kk.k.kk.k.k......',
			'..kkkkkkkkkkkkkkkkkkkkkkkkkk......',
			'..kkk.kkk.kkk.kkk.kkk.kkk.kk......',
			'..kkkkkkkkkkkkkkkkkkkkkkkkkk......',
		], 4, 10, { m: PAPER.smoke, k: INK.posterBlack });
		paint(s, [
			'......rrr',
			'.......rr',
			'......r.r',
			'.....r...',
			'....r....',
			'..rr.....',
			'.r.......',
			'r........',
		], 33, 12, { r: INK.posterRed });
		return s;
	},
};

/** What the drawer calls each poster. */
export const POSTER_NAMES: Record<PosterKind, string> = {
	space: 'Space is ours!',
	harvest: 'The harvest',
	quiet: 'Do not chatter!',
	lenin: 'Lenin',
	fiveYear: 'The five-year plan',
};

/** Every string the posters letter, so a test can prove the font has them. */
export const POSTER_SIGNAGE = ['КОСМОС', 'НАШ!', 'УРОЖАЙ', 'СТРАНЕ!', 'НЕ', 'БОЛТАЙ!', 'ЛЕНИН', 'ПЯТИЛЕТКА'];

/**
 * A poster's artwork and lettering.
 *
 * @param kind Poster.
 * @returns Sign, to paint on a wall at 2×.
 */
export function posterSign(kind: PosterKind): Sign {
	return POSTERS[kind]();
}

/** Widest a poster's lettering may be, in poster pixels, for a check that nothing overruns. */
export const POSTER_TEXT_MAX = Math.max(...POSTER_SIGNAGE.map(textWidth));
