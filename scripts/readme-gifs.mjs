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
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DEMO = join(ROOT, 'dist-demo');
const OUT = join(ROOT, 'docs', 'media');
const W = 960, H = 540;

/** A GIF the README can carry: bigger than this is a sign the clip runs too long. */
const MAX_BYTES = 4 * 1024 * 1024;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serve the built demo on a free port of 127.0.0.1.
 *
 * @returns The server and its port.
 */
async function serveDemo() {
	const srv = createServer((req, res) => {
		const p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
		const file = normalize(join(DEMO, p === '/' ? 'index.html' : p));
		if (!file.startsWith(DEMO + sep)) { res.writeHead(404).end(); return; }
		try {
			const body = readFileSync(file);
			res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
		} catch { res.writeHead(404).end(); }
	});
	await new Promise((r) => srv.listen(0, '127.0.0.1', r));
	return { srv, port: /** @type {import('node:net').AddressInfo} */ (srv.address()).port };
}

/**
 * Load puppeteer from PUPPETEER, or from this folder's node_modules.
 *
 * @returns puppeteer.
 */
function loadPuppeteer() {
	const req = createRequire(join(ROOT, 'package.json'));
	try { return req(process.env.PUPPETEER || 'puppeteer'); } catch {
		console.error('Puppeteer is missing. Run: npm i --no-save puppeteer');
		process.exit(1);
	}
}

/** Helpers each clip gets. */
const kit = (page) => ({
	/** Zoom the camera out by whole steps, about the middle of the view. */
	async zoomOut(steps) {
		await page.mouse.move(W / 2, H / 2);
		for (let i = 0; i < steps; i++) { await page.mouse.wheel({ deltaY: 400 }); await wait(300); }
	},
	/**
	 * Click the first element whose text holds the words, at once (puppeteer's own click waits
	 * seconds for a page this busy to settle).
	 */
	async press(sel, words = '') {
		const done = await page.evaluate((s, w) => {
			const x = [...document.querySelectorAll(s)].find((e) => e.textContent?.includes(w));
			x?.click();
			return !!x;
		}, sel, words);
		if (!done) throw new Error(`Nothing to click: ${sel} ${words}`);
	},
	/**
	 * Put the cursor in a field and type a word at a time: key by key is far slower than a person
	 * while the page is being recorded.
	 */
	async type(sel, text) {
		await page.evaluate((s) => document.querySelector(s)?.focus(), sel);
		for (const w of text.match(/\S+\s*/g) ?? []) { await page.keyboard.sendCharacter(w); await wait(120); }
	},
	/** Wait until the page shows the words (in an element matching the selector). */
	async until(sel, words, ms = 30_000) {
		await page.waitForFunction((s, w) => [...document.querySelectorAll(s)].some((x) => x.offsetParent && x.textContent?.includes(w)), { timeout: ms, polling: 100 }, sel, words);
	},
	/** Press and hold an element, as the stamps ask. */
	async hold(sel, ms) {
		const box = await (await page.$(sel))?.boundingBox();
		if (!box) throw new Error(`Nothing to hold: ${sel}`);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await wait(ms);
		await page.mouse.up();
	},
});

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
		query: 'wizard=off&interval=1500',
		async before() { await wait(4_000); },
		async during(page, k) {
			await wait(600);
			await k.press('.p67-roster-head');
			await wait(900);
			await k.press('.p67-chip', 'Night Shift Welder');
			await wait(1_800);
			await k.type('textarea.p67-input', 'Weld the new boiler before the morning shift.');
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

/**
 * Record the page as frames, each kept with the moment it was painted, so the GIF plays at the
 * speed the page did however fast the frames came.
 *
 * @param page Page.
 * @param dir Folder for the frames.
 * @returns stop(): ends the recording and writes the frame list for ffmpeg.
 */
async function record(page, dir) {
	const cdp = await page.createCDPSession();
	/** @type {{ file: string; at: number }[]} */
	const frames = [];
	cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
		const file = join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
		writeFileSync(file, Buffer.from(data, 'base64'));
		frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 });
		cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
	});
	await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 4 });
	return {
		async stop() {
			const end = Date.now() / 1000;
			await cdp.send('Page.stopScreencast');
			await cdp.detach();
			if (!frames.length) throw new Error('No frames were recorded.');
			const list = join(dir, 'frames.txt');
			const lines = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.at ?? end) - f.at).toFixed(4)}`);
			// The concat format reads the last file's duration only when it is named again.
			writeFileSync(list, `${lines.join('\n')}\nfile '${frames.at(-1).file}'\n`);
			return list;
		},
	};
}

/**
 * Turn the recorded frames into a GIF: 12 frames a second, one palette, no dithering.
 *
 * @param list The frame list.
 * @param gif Where the GIF goes.
 */
function toGif(list, gif) {
	const filter = 'fps=12,split[a][b];[a]palettegen=max_colors=160:stats_mode=full[p];[b][p]paletteuse=dither=none';
	const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', filter, '-loop', '0', gif], { stdio: 'inherit' });
	if (r.error || r.status !== 0) { console.error('ffmpeg failed. Is it installed?'); process.exit(1); }
}

const asked = process.argv.slice(2);
for (const a of asked) if (!(a in CLIPS)) { console.error(`No clip called ${a}. Clips: ${Object.keys(CLIPS).join(', ')}`); process.exit(2); }
try { statSync(join(DEMO, 'index.html')); } catch { console.error('Build the demo first: npm run demo'); process.exit(1); }
const puppeteer = loadPuppeteer();
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'plant-gifs-'));
const { srv, port } = await serveDemo();
const browser = await puppeteer.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
	for (const name of asked.length ? asked : Object.keys(CLIPS)) {
		const clip = CLIPS[name];
		// A fresh profile per clip, so the founding form opens and nothing is remembered.
		const context = await browser.createBrowserContext();
		const page = await context.newPage();
		await page.setViewport({ width: W, height: H });
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
		const list = await rec.stop();
		await context.close();
		const gif = join(OUT, `${name}.gif`);
		toGif(list, gif);
		const bytes = statSync(gif).size;
		console.log(`${name}.gif  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
		if (bytes > MAX_BYTES) { failed = true; console.error(`${name}.gif is over ${MAX_BYTES / 1024 / 1024} MB. Shorten the clip.`); }
	}
} finally {
	await browser.close();
	srv.close();
	rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
