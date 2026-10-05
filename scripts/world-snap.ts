/**
 * Render the whole plant world once and write it to PNG at 1×, plus 2× crops of each zone
 * for close review. Usage: npx tsx scripts/world-snap.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { project } from '../src/art/render';
import { buildWorld } from '../src/world/zones';
import { encodePng } from './png';

const out = process.argv[2] ?? 'spike-output';
mkdirSync(`${out}/world-zones`, { recursive: true });

const t0 = Date.now();
const world = buildWorld();
const ms = Date.now() - t0;
const { frame, base } = world.scene;
writeFileSync(`${out}/world.png`, encodePng(frame, 1, [16, 17, 20]));

// A 2× crop around each zone: its floor diamond plus room above for the back wall.
for (const z of Object.values(world.zones)) {
	const { x0, y0, x1, y1 } = z.tiles;
	const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => project(base, [x * world.tile, y * world.tile, 0]));
	const left = Math.min(...pts.map((p) => p[0])), right = Math.max(...pts.map((p) => p[0]));
	const top = Math.min(...pts.map((p) => p[1])) - 170, bottom = Math.max(...pts.map((p) => p[1])) + 10;
	const crop: [number, number, number, number] = [Math.floor(left), Math.floor(top), Math.ceil(right - left), Math.ceil(bottom - top)];
	writeFileSync(`${out}/world-zones/${z.id}.png`, encodePng(frame, 2, [16, 17, 20], crop));
}
const walk = world.grid.walkable.reduce((a, b) => a + b, 0);
console.log(`World ${frame.w}×${frame.h} (${(frame.w * frame.h / 1e6).toFixed(2)}M px), ${world.scene.props.length} props, ${walk} walkable tiles, built in ${ms}ms. Wrote ${out}/world.png.`);
