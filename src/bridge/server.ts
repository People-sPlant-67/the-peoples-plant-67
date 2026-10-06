/**
 * The bridge's web server: the plant's files, and the Plant Protocol from protocol.ts, on
 * 127.0.0.1 only. No dependencies beyond Node.
 *
 * A message the owner sends becomes words in an agent's next prompt, so who may send one
 * matters even on this computer. Every request must name this server as its Host (a page that
 * points its own domain at 127.0.0.1 gets nothing), and every write must come from the plant's
 * own page (Origin) with a JSON body. The pages ship with a Content-Security-Policy that lets
 * them talk to this server and nothing else.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { type Bridge, createBridge } from './protocol';

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
	log?: (line: string) => void;
	/** For tests: the bridge to use instead of a new one. */
	bridge?: Bridge;
}

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
	const bridge = o.bridge ?? createBridge({ dir: o.dir, log: o.log });
	return async (req, res) => {
		try {
			const host = req.headers.host;
			if (!hostAllowed(host, o.port)) { json(res, 403, { error: 'This bridge only answers on localhost.' }); return; }
			const method = (req.method ?? 'GET').toUpperCase();
			const url = req.url ?? '/';
			if (!url.startsWith('/api/')) {
				if (method !== 'GET' && method !== 'HEAD') { json(res, 405, { error: 'Method not allowed' }); return; }
				file(res, o.web, url.split('?')[0]);
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
