/**
 * The bridge's web server: the plant's files, and the Plant Protocol from protocol.ts, on
 * 127.0.0.1 only. No dependencies beyond Node.
 *
 * A message the owner sends becomes words in an agent's next prompt, so who may send one
 * matters even on this computer, where other users and programs can reach 127.0.0.1 too.
 *
 * - Every request must name this server as its Host: a page that points its own domain at
 *   127.0.0.1 gets nothing.
 * - Every /api/ request must carry the plant's key. The key lives in the plant's folder, which
 *   only its owner can read; the link the npx command opens carries it once, and the server
 *   swaps it for a cookie only this site's own pages send (HttpOnly, SameSite=Strict).
 * - Every write must come from the plant's own page (Origin) with a JSON body.
 * - The pages ship with a Content-Security-Policy that lets them talk to this server and
 *   nothing else.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { type Bridge, type Wiring, createBridge } from './protocol';

/** Largest request body taken. */
export const BODY_MAX = 128 * 1024;

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
	'.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

/** Sent with every answer. The plant draws with workers started from blob: URLs. */
const HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'X-Frame-Options': 'DENY',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
	'Cache-Control': 'no-store',
};

export interface ServeOptions {
	/** The bridge's folder. */
	dir: string;
	/** The built plant (dist-bridge/web). */
	web: string;
	port: number;
	/** The secret every /api/ request must carry (see keyOf in cli.ts). */
	key: string;
	log?: (line: string) => void;
	/** How to wire each harness, for the plant's page. */
	wiring?: () => Wiring;
	/** For tests: the bridge to use instead of a new one. */
	bridge?: Bridge;
}

/** Shown at the plant's address without its key. */
const LOCKED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The People's Plant #67</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16181d;font:16px/1.5 system-ui,sans-serif">
<main style="max-width:30rem;margin:1rem;padding:1.25rem 1.5rem;background:#efe3c4;color:#2a2420;border:3px solid #b02a22">
<h1 style="margin:0 0 .5rem;font-size:1.2rem">★ The People's Plant #67</h1>
<p>The plant opens from the link in the terminal where you started it. That link carries its key, so nobody else on this computer can reach your agents.</p>
<p>Lost the link? Run the npx command again. It opens the plant for you.</p>
</main></body></html>`;

/**
 * Whether a Host header names this server.
 *
 * @param host Host header.
 * @param port The port listened on.
 * @returns True for localhost, 127.0.0.1 or [::1] on this port.
 */
export function hostAllowed(host: string | undefined, port: number): boolean {
	return !!host && [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
}

/**
 * Whether a write comes from the plant's own page.
 *
 * @param origin Origin header.
 * @param host Host header (already allowed).
 * @returns True when the origin is http://<host>.
 */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
	return !!origin && !!host && origin.toLowerCase() === `http://${host.toLowerCase()}`;
}

/**
 * Send a JSON answer.
 *
 * @param res Response.
 * @param status Status.
 * @param body Body.
 */
function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(body));
}

/**
 * Read a request body, up to BODY_MAX.
 *
 * @param req Request.
 * @returns Text, or null when it is too big.
 */
function readBody(req: IncomingMessage): Promise<string | null> {
	return new Promise((resolve) => {
		let size = 0;
		const parts: Buffer[] = [];
		let over = false;
		req.on('data', (c: Buffer) => {
			if (over) return;
			size += c.length;
			// Too big: stop keeping it, let the rest drain, and answer 413 once it has.
			if (size > BODY_MAX) { over = true; parts.length = 0; return; }
			parts.push(c);
		});
		req.on('end', () => resolve(over ? null : Buffer.concat(parts).toString('utf8')));
		req.on('error', () => resolve(null));
	});
}

/**
 * Serve a file from the built plant, or 404. Paths that climb out of it are refused.
 *
 * @param res Response.
 * @param web The plant's folder.
 * @param path URL path.
 */
function file(res: ServerResponse, web: string, path: string): void {
	if (path === '/' || path === '/index.html') path = '/index.html';
	let rel: string;
	try { rel = decodeURIComponent(path); } catch { json(res, 400, { error: 'Bad path' }); return; }
	if (rel === '/' || rel === '') rel = '/index.html';
	const full = normalize(join(web, rel));
	if (!full.startsWith(normalize(web) + sep) || rel.includes('\0')) { json(res, 404, { error: 'Not found' }); return; }
	try {
		if (!statSync(full).isFile()) throw new Error('not a file');
		const body = readFileSync(full);
		res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream' });
		res.end(body);
	} catch {
		json(res, 404, { error: 'Not found' });
	}
}

/**
 * The request handler, for the server and the tests.
 *
 * @param o Options.
 * @returns Handler.
 */
export function createHandler(o: ServeOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
	const bridge = o.bridge ?? createBridge({ dir: o.dir, log: o.log, wiring: o.wiring });
	const cookie = `plant67_${o.port}`;
	return async (req, res) => {
		try {
			const host = req.headers.host;
			if (!hostAllowed(host, o.port)) { json(res, 403, { error: 'This bridge only answers on localhost.' }); return; }
			const method = (req.method ?? 'GET').toUpperCase();
			const url = req.url ?? '/';
			const [path, query = ''] = url.split('?');
			// The link from the terminal: its key becomes this site's cookie, and the key leaves the address bar.
			const offered = new URLSearchParams(query).get('key');
			if (offered !== null && (method === 'GET' || method === 'HEAD')) {
				if (!same(offered, o.key)) { page(res, 403, LOCKED); return; }
				res.writeHead(303, { ...HEADERS, Location: '/', 'Set-Cookie': `${cookie}=${o.key}; HttpOnly; SameSite=Strict; Path=/` });
				res.end();
				return;
			}
			const keyed = same(cookieOf(req.headers.cookie, cookie), o.key);
			if (!path.startsWith('/api/')) {
				if (method !== 'GET' && method !== 'HEAD') { json(res, 405, { error: 'Method not allowed' }); return; }
				if (!keyed && (path === '/' || path === '/index.html')) { page(res, 200, LOCKED); return; }
				file(res, o.web, path);
				return;
			}
			// Only whether a bridge is here, for a second npx command: never the plant's data.
			if (!keyed && !(path === '/api/plant-bridge' && method === 'GET')) {
				json(res, 401, { error: 'This page has lost its key to the plant. Open the plant again from the link in the terminal where you started it.' });
				return;
			}
			let body: unknown;
			if (method !== 'GET' && method !== 'HEAD') {
				if (method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return; }
				if (!originAllowed(req.headers.origin, host)) { json(res, 403, { error: 'Only the plant itself may send to the bridge.' }); return; }
				if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) { json(res, 415, { error: 'The bridge takes JSON only.' }); return; }
				const text = await readBody(req);
				if (text === null) { json(res, 413, { error: 'That is too big for the bridge.' }); return; }
				try { body = text ? JSON.parse(text) : {}; } catch { json(res, 400, { error: 'The body is not JSON.' }); return; }
			}
			const a = bridge.handle(method, url, body);
			json(res, a.status, a.body);
		} catch (err) {
			o.log?.(`The bridge failed on a request: ${(err as Error).message}`);
			if (!res.headersSent) json(res, 500, { error: 'The bridge failed on that request.' });
			else res.end();
		}
	};
}

/**
 * Compare a secret in constant time.
 *
 * @param a Offered.
 * @param b Expected.
 * @returns True when they are equal.
 */
function same(a: string | null, b: string): boolean {
	if (a === null || !b) return false;
	const x = Buffer.from(a), y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * One cookie's value from a Cookie header.
 *
 * @param header Cookie header.
 * @param name Cookie name.
 * @returns Value, or null.
 */
function cookieOf(header: string | undefined, name: string): string | null {
	for (const part of (header ?? '').split(';')) {
		const i = part.indexOf('=');
		if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
	}
	return null;
}

/**
 * Send a small HTML page.
 *
 * @param res Response.
 * @param status Status.
 * @param html Page.
 */
function page(res: ServerResponse, status: number, html: string): void {
	res.writeHead(status, { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
	res.end(html);
}

/**
 * Start the server on 127.0.0.1.
 *
 * @param o Options.
 * @returns The listening server.
 */
export function serve(o: ServeOptions): Promise<Server> {
	const server = createServer(createHandler(o));
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(o.port, '127.0.0.1', () => { server.off('error', reject); resolve(server); });
	});
}
