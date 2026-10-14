#!/usr/bin/env node
/**
 * Make the launch kit's clips from the built demo, into launch-kit/ (gitignored).
 *
 *   npm run demo
 *   npm i --no-save puppeteer      (once; or set PUPPETEER to the folder of a puppeteer you have)
 *   node scripts/launch-clips.mjs [clip...] [--ratio 16x9|1x1]
 *
 * Each clip is recorded once per ratio (16:9 at 1920×1080, 1:1 at 1080×1080), not cropped, so the
 * page lays itself out for the shape. Each recording becomes an MP4 (H.264, 30 fps) and a GIF
 * (12 fps, one palette, no dithering, half size), plus a contact sheet (one frame a second) to
 * check by eye. Every file passes the leak scan before it is kept (see clean). A take fails if the page throws, shows a demo error string, or the demo's line to
 * Paperclip drops (the telephone rings) while recording: the plant on screen must be healthy.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DEMO, ROOT, ffmpeg, kit, loadPuppeteer, record, serveDemo, toGif, wait } from './clip-kit.mjs';

const OUT = join(ROOT, 'launch-kit');

/** X takes GIFs up to 15 MB. */
const MAX_GIF = 15 * 1024 * 1024;

/**
 * The two shapes. Pixel art stays crisp at a whole number of device pixels per world pixel:
 * 16:9 is 2 per CSS pixel (camera zoom 1 or 2), 1:1 is 1.5 (camera zoom 2 only, so 3).
 */
const RATIOS = {
	'16x9': { viewport: { width: 960, height: 540, deviceScaleFactor: 2 }, gif: '960:540', zoom: 2 },
	'1x1': { viewport: { width: 720, height: 720, deviceScaleFactor: 1.5 }, gif: '720:720', zoom: 2 },
};

/** Where things are, in world pixels. */
const AT = {
	desk: { x: 676, y: 239 },
	canteen: { x: 560, y: 560 },
	/** The platform and the hiring desk: the recruit rides in and walks from 230 to 430 across, 405 to 570 down. */
	hire: { x: 290, y: 430 },
	/** The middle of the parade's lap round the Canteen's tables (feet 408 to 849 across, 532 to 753 down, flags above). */
	parade: { x: 628, y: 620 },
};

/** Words the demo says when something has gone wrong: its mock's errors, and the plant's line trouble. */
const BAD = [
	...new Set([...readFileSync(join(ROOT, 'src', 'live', 'mock.ts'), 'utf8').matchAll(/(?:error|message): '([^']+)'/g)].map((m) => m[1])),
	'Not found in the mock',
	'will try again',
	'cannot be reached',
	'came back at',
	'failed to render',
];

/** Extra helpers for the launch clips. */
const more = (page) => ({
	/** Keep the camera on a comrade's feet (a little above them) every frame, until unfollow. Whole pixels, so the art never shimmers. */
	async follow(id, lift = 24) {
		await page.evaluate((who, up) => {
			cancelAnimationFrame(window.__follow ?? 0);
			const step = () => {
				const c = window.plant67.crewReport().find((x) => x.id === who);
				if (c) window.plant67.look(Math.round(c.x), Math.round(c.y - up));
				window.__follow = requestAnimationFrame(step);
			};
			step();
		}, id, lift);
	},
	async unfollow() { await page.evaluate(() => cancelAnimationFrame(window.__follow ?? 0)); },
	/** Frame a world point at the ratio's zoom. */
	async frame(p, zoom) { await page.evaluate((x, y, z) => window.plant67.frame(x, y, z), p.x, p.y, zoom); },
	/** A comrade at work or idle on the floor, away from the office and Siberia. */
	async pick(exclude = []) {
		const c = await page.evaluate((no) => window.plant67.crewReport().find((x) => (x.activity === 'working' || x.activity === 'idle') && !x.walking && !['directorate', 'siberia', 'roam'].includes(x.zone) && !no.includes(x.name)), exclude);
		if (!c) throw new Error('No comrade free on the floor.');
		return c;
	},
	/** Wait for a test on the page to come true. */
	async when(fn, ms = 45_000, ...args) {
		await page.waitForFunction(fn, { timeout: ms, polling: 100 }, ...args);
	},
	/** The comrade's report row. */
	async who(id) { return page.evaluate((x) => window.plant67.crewReport().find((c) => c.id === x), id); },
	/**
	 * Cut a long walk short: keep the first few seconds of it, jump to the last few steps.
	 *
	 * @param rec The recording.
	 * @param id The walker.
	 * @param keep Seconds of walking to keep before the cut.
	 * @param steps Tiles still to go when the clip picks up again.
	 */
	async cutWalk(rec, id, keep = 3, steps = 4) {
		await wait(keep * 1000);
		const c = await this.who(id);
		if (!c?.walking || c.left <= steps + 2) return;
		rec.pause();
		await this.when((x, n) => (window.plant67.crewReport().find((c) => c.id === x)?.left ?? 0) <= n, 90_000, id, steps);
		rec.resume();
	},
});

/** Every clip's demo runs this seed: the Company Lead stays free and Siberia stays quiet for the first 39 checks. */
const SEED = 21;

/**
 * The clips. Each has the demo's query, what to do before recording (unseen) and while recording.
 * `r` is the ratio's settings; `rec` is the recording (for a jump cut).
 */
const CLIPS = {
	'01-trial': {
		query: 'scenario=tribunal&wizard=off&interval=2500',
		async before() { await wait(4_000); },
		async during(page, k, m, r) {
			await wait(800);
			await k.press('.p67-poster-tribunal');
			await k.until('.p67-board', 'Read the Director');
			await wait(1_200);
			await m.frame({ x: 545, y: 300 }, r.zoom);
			await wait(900);
			await k.press('button.p67-link', "Director's report");
			await wait(2_200);
			await k.hold('button.p67-stamp.p67-red', 1_300);
			await k.until('.p67-photo-cap', 'airbrushed from the record');
			await wait(3_500);
		},
	},
	'02-wardrobe': {
		query: 'wizard=off&interval=2500',
		async before(page, k, m) {
			await wait(5_000);
			const c = await m.pick();
			page.__who = c;
			await page.evaluate((id) => window.plant67.select(id), c.id);
			await m.follow(c.id);
			await wait(600);
			await k.press('.p67-card button', 'Wardrobe');
			await wait(1_500);
		},
		async during(page, k, m, r, rec) {
			const id = page.__who.id;
			await wait(1_000);
			await k.press('button', 'Surprise');
			await wait(1_400);
			await k.press('button', 'Surprise');
			await wait(1_600);
			await k.press('button.p67-wardrobe-keep', 'Keep');
			await wait(700);
			await page.evaluate(() => window.plant67.select(null));
			await m.cutWalk(rec, id, 2.5, 4);
			await m.when((x) => !window.plant67.changingState().ids.includes(x), 60_000, id);
			await wait(2_500);
			await m.unfollow();
		},
	},
	'03-mayday': {
		query: 'wizard=off&interval=2500',
		// The lap is wider than the usual view: show more of the floor, at 2 device pixels a world pixel in both shapes.
		square: { width: 1080, height: 1080, deviceScaleFactor: 1 },
		zoom: { '16x9': 1, '1x1': 2 },
		async before(page, k, m, r) { await wait(5_000); await m.frame(AT.canteen, r.zoom); await wait(600); },
		async during(page, k, m, r, rec) {
			await wait(1_500);
			for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) {
				await page.keyboard.press(key);
				await wait(160);
			}
			await m.when(() => window.plant67.eggsState().parade.stage !== 'off', 5_000);
			// The parade glides the camera to the Canteen; take it back to the whole lap.
			await wait(600);
			await m.frame(AT.parade, r.zoom);
			// Keep them falling in, then jump to the march.
			await wait(3_000);
			if (await page.evaluate(() => window.plant67.eggsState().parade.stage !== 'march')) {
				rec.pause();
				await m.when(() => window.plant67.eggsState().parade.stage === 'march', 60_000);
				await wait(400);
				rec.resume();
			}
			await m.when(() => window.plant67.eggsState().parade.stage === 'off', 60_000);
			await wait(1_200);
		},
	},
	'04-siberia': {
		query: 'wizard=off&interval=2500',
		async before(page, k, m) {
			await wait(5_000);
			const c = await m.pick();
			page.__who = c;
			await page.evaluate((id) => window.plant67.select(id), c.id);
			await m.follow(c.id);
			await wait(600);
			await k.press('.p67-card button', 'Personnel');
			await wait(1_200);
		},
		async during(page, k, m, r, rec) {
			const id = page.__who.id;
			await wait(1_000);
			await k.hold('button.p67-stamp', 1_800, 'ПАУЗА');
			await wait(900);
			await page.evaluate(() => window.plant67.select(null));
			await m.when((x) => window.plant67.crewReport().some((c) => c.id === x && c.walking), 10_000, id);
			await m.cutWalk(rec, id, 3, 5);
			await m.when((x) => window.plant67.crewReport().some((c) => c.id === x && c.zone === 'siberia' && c.activity === 'shivering' && !c.walking), 60_000, id);
			await wait(3_500);
			await m.unfollow();
		},
	},
	'05-pravda': {
		query: 'scenario=pravda&wizard=off&interval=2500',
		async before(page, k, m, r) {
			// The paper prints on opening (a first visit): put it down, then pick it up on camera.
			await wait(6_000);
			await page.keyboard.press('Escape');
			await wait(800);
			await m.frame(AT.desk, r.zoom);
			await wait(800);
		},
		async during(page) {
			await wait(1_500);
			await page.evaluate(() => window.plant67.openFixture('pravda'));
			await wait(7_500);
		},
	},
	'06-chat': {
		query: 'wizard=off&interval=60000',
		async before() { await wait(4_000); },
		async during(page, k, m) {
			await wait(600);
			await k.press('.p67-roster-head');
			await wait(900);
			const comrade = await m.pick();
			await k.press('.p67-chip', comrade.name);
			await k.until('.p67-card', comrade.name);
			await wait(1_800);
			await k.type('textarea.p67-input', 'Check the new boiler before the morning shift.');
			await wait(400);
			await k.press('button.p67-send');
			await k.until('.p67-card', 'Understood');
			await wait(3_500);
		},
	},
	'07-hire': {
		query: 'scenario=hire&wizard=off&interval=1000',
		// A still camera: the platform and the hiring desk share one view, and a still view keeps the GIF small.
		async before(page, k, m, r) {
			await m.frame(AT.hire, r.zoom);
			await m.when(() => window.plant67.crewReport().some((c) => c.name === 'Fresh Recruit'), 30_000);
			page.__who = await page.evaluate(() => window.plant67.crewReport().find((x) => x.name === 'Fresh Recruit'));
		},
		async during(page, k, m) {
			const id = page.__who.id;
			await m.when((x) => window.plant67.crewReport().some((c) => c.id === x && c.walking), 30_000, id);
			await m.when((x) => window.plant67.crewReport().some((c) => c.id === x && !c.walking), 30_000, id);
			await wait(1_500);
			await page.evaluate((x) => window.plant67.click(x), id);
			await k.until('.p67-board', 'ОДОБРЕНО', 10_000);
			await wait(1_800);
			await k.hold('button.p67-stamp.p67-green', 1_300);
			await wait(4_000);
		},
	},
	'08-plan': {
		query: 'wizard=off&interval=2500',
		async before(page, k, m, r) { await wait(5_000); await m.frame(AT.desk, r.zoom); await wait(600); },
		async during(page, k, m, r, rec) {
			await wait(1_200);
			await page.evaluate(() => window.plant67.egg('plan'));
			await m.when(() => window.plant67.eggsState().plan.banner, 5_000);
			// The Company Lead may come from across the plant: cut to them reaching the desk.
			const lead = await page.evaluate(() => window.plant67.eggsState().plan.medal?.lead);
			if (lead) await m.cutWalk(rec, lead, 2.5, 4);
			await m.when(() => { const s = window.plant67.eggsState().plan; return !s.banner && !s.medal && s.bursts === 0; }, 60_000);
			await wait(1_000);
		},
	},
};

/**
 * Make a file, then run the leak scan on it alone. Compressed bytes can spell a short private word
 * or an address-shaped string by chance: make it again with a slightly different setting until the
 * scan passes. The scanner is never loosened.
 *
 * @param file The file to make.
 * @param make Makes it; takes the attempt number (0 first).
 */
function clean(file, make) {
	for (let n = 0; n < 6; n++) {
		make(n);
		const alone = mkdtempSync(join(OUT, '.scan-'));
		try {
			renameSync(file, join(alone, basename(file)));
			const scan = spawnSync(process.execPath, [join(ROOT, 'scripts', 'leak-scan.mjs'), '--dir', alone, '--require-deny'], { cwd: ROOT, encoding: 'utf8' });
			renameSync(join(alone, basename(file)), file);
			if (scan.status === 0) return;
			if (!/problem\(s\)/.test(scan.stdout + scan.stderr)) throw new Error(`The leak scan could not run.\n${scan.stdout}${scan.stderr}`);
			console.log(`${basename(file)}: chance hit in the leak scan, making it again (${n + 1}).`);
		} finally { rmSync(alone, { recursive: true, force: true }); }
	}
	throw new Error(`${basename(file)} still fails the leak scan after 6 tries. Look at it by hand.`);
}

/** Watch the page while recording, for anything a healthy plant never shows. */
async function guard(page) {
	await page.evaluate((bad) => {
		window.__bad = [];
		window.__guard = setInterval(() => {
			const text = document.body.innerText;
			for (const w of bad) if (text.includes(w)) window.__bad.push(w);
			const s = window.plant67.sceneryState();
			if (s.ringing) window.__bad.push('the telephone rang (the line dropped)');
		}, 250);
	}, BAD);
	return async () => page.evaluate(() => { clearInterval(window.__guard); return [...new Set(window.__bad)]; });
}

const args = process.argv.slice(2);
const ri = args.indexOf('--ratio');
const ratios = ri >= 0 ? [args.splice(ri, 2)[1]] : Object.keys(RATIOS);
for (const r of ratios) if (!Object.hasOwn(RATIOS, r)) throw new Error(`No ratio called ${r}. Ratios: ${Object.keys(RATIOS).join(', ')}`);
for (const a of args) if (!Object.hasOwn(CLIPS, a)) throw new Error(`No clip called ${a}. Clips: ${Object.keys(CLIPS).join(', ')}`);
try { statSync(join(DEMO, 'index.html')); } catch { throw new Error('Build the demo first: npm run demo'); }
const puppeteer = loadPuppeteer();
mkdirSync(join(OUT, 'sheets'), { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'plant-clips-'));
let srv, browser, failures = 0;
try {
	const served = await serveDemo();
	srv = served.srv;
	browser = await puppeteer.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
	for (const name of args.length ? args : Object.keys(CLIPS)) {
		for (const ratio of ratios) {
			const clip = CLIPS[name], base = `${name}-${ratio}`;
			let r = RATIOS[ratio];
			const errors = [];
			const context = await browser.createBrowserContext();
			try {
				const page = await context.newPage();
				await page.setViewport(ratio === '1x1' && clip.square ? clip.square : r.viewport);
				await page.emulateTimezone('UTC');
				page.on('pageerror', (e) => errors.push(e.message));
				await page.goto(`http://127.0.0.1:${served.port}/index.html?${clip.query}&seed=${SEED}`);
				await page.waitForFunction(() => window.plant67?.stats().firstComradeMs != null, { timeout: 60_000 });
				const k = kit(page), m = more(page);
				if (clip.zoom) r = { ...r, zoom: clip.zoom[ratio] };
				await clip.before(page, k, m, r);
				const frames = join(work, base);
				mkdirSync(frames);
				const seen = await guard(page);
				const rec = await record(page, frames, { format: 'png', everyNthFrame: 2 });
				await clip.during(page, k, m, r, rec);
				const { list, count, seconds } = await rec.stop();
				errors.push(...await seen());
				if (errors.length) throw new Error(errors.join('; '));
				const tmp = mkdtempSync(join(OUT, '.clip-'));
				try {
					const mp4File = join(tmp, `${base}.mp4`), gifFile = join(tmp, `${base}.gif`), sheetFile = join(tmp, `${base}.jpg`);
					clean(mp4File, (n) => ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(16 + n), '-tune', 'animation', '-movflags', '+faststart', '-an', mp4File]));
					clean(gifFile, (n) => toGif(list, gifFile, r.gif, 160 - 2 * n));
					clean(sheetFile, (n) => ffmpeg(['-i', mp4File, '-vf', `fps=1,scale=480:-1,tile=6x${Math.ceil(seconds / 6)}`, '-frames:v', '1', '-q:v', String(3 + n), sheetFile]));
					const gif = statSync(gifFile).size;
					if (gif > MAX_GIF) throw new Error(`GIF is ${(gif / 1048576).toFixed(1)} MB, over X's 15 MB. Shorten the clip.`);
					renameSync(mp4File, join(OUT, `${base}.mp4`));
					renameSync(gifFile, join(OUT, `${base}.gif`));
					renameSync(sheetFile, join(OUT, 'sheets', `${base}.jpg`));
					const mp4 = statSync(join(OUT, `${base}.mp4`)).size;
					console.log(`${base}  ${seconds.toFixed(1)} s  ${(count / seconds).toFixed(0)} fps  mp4 ${(mp4 / 1048576).toFixed(1)} MB  gif ${(gif / 1048576).toFixed(1)} MB`);
				} finally { rmSync(tmp, { recursive: true, force: true }); }
			} catch (error) {
				failures++;
				console.error(`${base}: FAILED. ${error.message}`);
			} finally { await context.close(); }
		}
	}
} finally {
	try { await browser?.close(); } finally {
		srv?.close();
		rmSync(work, { recursive: true, force: true });
	}
}
if (failures) process.exitCode = 1;
