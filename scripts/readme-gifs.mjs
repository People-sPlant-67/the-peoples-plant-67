#!/usr/bin/env node
/**
 * Make the README's GIFs from the built demo, into docs/media/.
 *
 *   npm run demo
 *   npm i --no-save puppeteer      (once; or set PUPPETEER to the folder of a puppeteer you have)
 *   node scripts/readme-gifs.mjs [hero] [founding] [directive] [tribunal]
 *
 * Needs ffmpeg on the PATH. Each clip drives the demo as a visitor would, records the page, and
 * turns the recording into a GIF with one palette per clip and no dithering, so the pixel art
 * stays crisp. With no names, it makes all four.
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEMO, ROOT, kit, loadPuppeteer, record, serveDemo, toGif, wait } from './clip-kit.mjs';

const OUT = join(ROOT, 'docs', 'media');
const W = 960, H = 540;

/** A GIF the README can carry: bigger than this is a sign the clip runs too long. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * The clips. Each has the demo's query, what to do before recording (unseen), and what to do
 * while recording.
 */
const CLIPS = {
	hero: {
		query: 'wizard=off&interval=1500',
		async before(page, k) {
			await k.zoomOut(3);
			// Let the comrades spread out to their stations.
			await wait(12_000);
			await page.evaluate(() => window.plant67.look(900, 420));
			await wait(800);
		},
		async during() { await wait(9_000); },
	},
	founding: {
		query: '',
		async before() { await wait(1_500); },
		async during(page, k) {
			await wait(800);
			await k.type('.p67-wiz input', 'Comrade Engineer');
			await wait(700);
			await k.press('.p67-wiz-foot button', 'Next');
			await k.until('.p67-wiz-h', 'Choose your dictator');
			await wait(1_000);
			for (const name of ['The Bald Visionary', 'The Iron Lady of the Steppe', 'The Babushka Supreme', 'The Moustache']) {
				await k.press('.p67-wiz-arch', name);
				await wait(1_300);
			}
			await wait(800);
		},
	},
	directive: {
		size: { width: 960, height: 720 },
		// Keep the starting roster stable while the directive and its reply play out.
		query: 'wizard=off&interval=60000',
		async before() { await wait(4_000); },
		async during(page, k) {
			await wait(600);
			await k.press('.p67-roster-head');
			await wait(900);
			const comrade = await page.evaluate(() => window.plant67.crewReport().find((c) =>
				(c.activity === 'working' || c.activity === 'idle') && c.zone !== 'directorate'));
			if (!comrade) throw new Error('No idle or working comrade is available.');
			await k.press('.p67-chip', comrade.name);
			await k.until('.p67-card', comrade.name);
			await page.waitForFunction(() => {
				const card = document.querySelector('.p67-card')?.getBoundingClientRect();
				return card && card.top >= 0 && card.bottom <= innerHeight;
			});
			await wait(1_800);
			await k.type('textarea.p67-input', 'Check the new boiler before the morning shift.');
			await wait(400);
			await k.press('button.p67-send');
			// The demo's comrade writes for a few seconds, then answers.
			await k.until('.p67-card', 'Understood');
			await wait(3_500);
		},
	},
	tribunal: {
		query: 'scenario=tribunal&wizard=off&interval=1500',
		async before(page, k) {
			await wait(4_000);
		},
		async during(page, k) {
			await wait(600);
			await k.press('.p67-poster-tribunal');
			await k.until('.p67-board', 'Read the Director');
			await wait(1_200);
			// The court sits in the Palace of Culture: keep it in view beside the verdict window.
			await page.evaluate(() => window.plant67.look(545, 300));
			await wait(900);
			await k.press('button.p67-link', "Director's report");
			await wait(2_000);
			await k.hold('button.p67-stamp.p67-red', 1_300);
			// The accused walks to the dock, the verdict is read, and the photo is airbrushed.
			await k.until('.p67-photo-cap', 'airbrushed from the record');
			await wait(3_500);
		},
	},
};

const asked = process.argv.slice(2);
for (const a of asked) if (!Object.hasOwn(CLIPS, a)) throw new Error(`No clip called ${a}. Clips: ${Object.keys(CLIPS).join(', ')}`);
try { statSync(join(DEMO, 'index.html')); } catch { throw new Error('Build the demo first: npm run demo'); }
const puppeteer = loadPuppeteer();
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'plant-gifs-'));
let srv, browser, pending;
try {
	const served = await serveDemo();
	srv = served.srv;
	const port = served.port;
	browser = await puppeteer.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
	for (const name of asked.length ? asked : Object.keys(CLIPS)) {
		const clip = CLIPS[name];
		let failed = false;
		// A fresh profile per clip, so the founding form opens and nothing is remembered.
		const context = await browser.createBrowserContext();
		const page = await context.newPage();
		await page.setViewport(clip.size ?? { width: W, height: H });
		// Times on screen (a chat message's) say nothing about where the GIFs were made.
		await page.emulateTimezone('UTC');
		page.on('pageerror', (e) => { failed = true; console.error(`${name}: ${e.message}`); });
		await page.goto(`http://127.0.0.1:${port}/index.html${clip.query ? `?${clip.query}` : ''}`);
		await page.waitForFunction(() => window.plant67?.stats().firstComradeMs != null, { timeout: 60_000 });
		const k = kit(page);
		await clip.before(page, k);
		const frames = join(work, name);
		mkdirSync(frames);
		const rec = await record(page, frames);
		await clip.during(page, k);
		const { list } = await rec.stop();
		await context.close();
		// Keep the candidate on the destination filesystem so rename is atomic.
		pending = mkdtempSync(join(OUT, '.plant-gif-'));
		const gif = join(pending, `${name}.gif`);
		toGif(list, gif);
		const bytes = statSync(gif).size;
		console.log(`${name}.gif  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
		if (!bytes || bytes > MAX_BYTES) throw new Error(`${name}.gif must be nonempty and under ${MAX_BYTES / 1024 / 1024} MB. Shorten the clip.`);
		if (failed) throw new Error(`${name}: the page reported an error. The existing GIF was kept.`);
		renameSync(gif, join(OUT, `${name}.gif`));
		rmSync(pending, { recursive: true, force: true });
		pending = undefined;
	}
} finally {
	try { await browser?.close(); } finally {
		srv?.close();
		if (pending) rmSync(pending, { recursive: true, force: true });
		rmSync(work, { recursive: true, force: true });
	}
}
