/**
 * What the clip scripts share: serve the built demo, load puppeteer, drive the page, and record it
 * as timed frames. Used by readme-gifs.mjs and launch-clips.mjs.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve, sep } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const DEMO = join(ROOT, 'dist-demo');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serve the built demo on a free port of 127.0.0.1.
 *
 * @returns The server and its port.
 */
export async function serveDemo() {
	const srv = createServer((req, res) => {
		let p;
		try { p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); }
		catch { res.writeHead(400).end('Invalid URL.'); return; }
		const file = normalize(join(DEMO, p === '/' ? 'index.html' : p));
		if (!file.startsWith(DEMO + sep)) { res.writeHead(404).end(); return; }
		try {
			const body = readFileSync(file);
			res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
		} catch { res.writeHead(404).end(); }
	});
	await new Promise((resolve, reject) => {
		srv.once('error', reject);
		srv.listen(0, '127.0.0.1', resolve);
	});
	return { srv, port: /** @type {import('node:net').AddressInfo} */ (srv.address()).port };
}

/**
 * Load puppeteer from PUPPETEER, or from this folder's node_modules.
 *
 * @returns puppeteer.
 */
export function loadPuppeteer() {
	const req = createRequire(join(ROOT, 'package.json'));
	try { return req(process.env.PUPPETEER || 'puppeteer'); } catch {
		throw new Error('Puppeteer is missing. Run: npm i --no-save puppeteer');
	}
}

/** Helpers each clip gets. */
export const kit = (page) => ({
	/** Zoom the camera out by whole steps, about the middle of the view. */
	async zoomOut(steps) {
		await page.mouse.move(page.viewport().width / 2, page.viewport().height / 2);
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
	/** Press and hold the first shown element matching the selector (and holding the words), as the stamps ask. */
	async hold(sel, ms, words = '') {
		const handle = await page.evaluateHandle((s, w) => [...document.querySelectorAll(s)].find((e) => e.offsetParent && e.textContent?.includes(w)), sel, words);
		const box = await handle.asElement()?.boundingBox();
		if (!box) throw new Error(`Nothing to hold: ${sel} ${words}`);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await wait(ms);
		await page.mouse.up();
	},
});

/**
 * Record the page as frames, each kept with the moment it was painted, so the clip plays at the
 * speed the page did however fast the frames came.
 *
 * @param page Page.
 * @param dir Folder for the frames.
 * @param opts format ('jpeg' or 'png') and everyNthFrame; frames are taken at the device pixel ratio.
 * @returns pause() and resume() for a jump cut; stop() ends the recording and writes the frame list for ffmpeg.
 */
export async function record(page, dir, { format = 'jpeg', everyNthFrame = 4 } = {}) {
	const cdp = await page.createCDPSession();
	/** @type {{ file: string; at: number; end?: number }[]} */
	const frames = [];
	let frameError;
	/** While cut, frames are dropped: the clip jumps from the pause to the resume. */
	let cut = false;
	const ext = format === 'png' ? 'png' : 'jpg';
	cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
		const file = join(dir, `${String(frames.length).padStart(5, '0')}.${ext}`);
		try {
			if (!frameError && !cut) {
				writeFileSync(file, Buffer.from(data, 'base64'));
				frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 });
			}
		} catch (error) { frameError = error; }
		finally { cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); }
	});
	const vp = page.viewport();
	const scale = vp.deviceScaleFactor ?? 1;
	await cdp.send('Page.startScreencast', { format, quality: 92, maxWidth: Math.round(vp.width * scale), maxHeight: Math.round(vp.height * scale), everyNthFrame });
	return {
		/** Stop keeping frames, ending the last one now: a jump cut, until resume. */
		pause() {
			cut = true;
			const last = frames.at(-1);
			if (last) last.end = Date.now() / 1000;
		},
		resume() { cut = false; },
		async stop() {
			const end = Date.now() / 1000;
			await cdp.send('Page.stopScreencast');
			await cdp.detach();
			if (frameError) throw new Error('Could not save the recorded frames.', { cause: frameError });
			if (!frames.length) throw new Error('No frames were recorded.');
			const list = join(dir, 'frames.txt');
			const lines = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (f.end ?? frames[i + 1]?.at ?? end) - f.at).toFixed(4)}`);
			// The concat format reads the last file's duration only when it is named again.
			writeFileSync(list, `${lines.join('\n')}\nfile '${frames.at(-1).file}'\n`);
			const seconds = frames.reduce((t, f, i) => t + ((f.end ?? frames[i + 1]?.at ?? end) - f.at), 0);
			return { list, count: frames.length, seconds };
		},
	};
}

/**
 * Run ffmpeg, quietly, and fail loudly.
 *
 * @param args Arguments after the program name.
 */
export function ffmpeg(args) {
	const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
	if (r.error || r.status !== 0) throw new Error('ffmpeg failed. Is it installed?', { cause: r.error });
}

/**
 * Turn recorded frames into a GIF: 12 frames a second, one palette, no dithering, so the pixel
 * art stays crisp.
 *
 * @param list The frame list.
 * @param gif Where the GIF goes.
 * @param scale Optional ffmpeg scale, e.g. '960:540'.
 * @param colours Palette size.
 */
export function toGif(list, gif, scale, colours = 160) {
	const size = scale ? `scale=${scale}:flags=area,` : '';
	const filter = `fps=12,${size}split[a][b];[a]palettegen=max_colors=${colours}:stats_mode=full[p];[b][p]paletteuse=dither=none`;
	ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', filter, '-loop', '0', gif]);
}
