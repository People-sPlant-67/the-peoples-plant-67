/**
 * The bridge's web server: the plant's files, and the Plant Protocol from protocol.ts, on
 * 127.0.0.1 only. No dependencies beyond Node.
 *
 * A message the owner sends becomes words in an agent's next prompt, so who may send one
 * matters even on this computer, where other users and programs can reach 127.0.0.1 too.
 *
 * - Every request must name this server as its Host: a page that points its own domain at
 *   127.0.0.1 gets nothing.
 * - Every /api/ request must carry the plant's key in a header. The key is made new each time
 *   the bridge starts and kept in the plant's folder, which only its owner can read. The link
 *   the npx command opens carries it after the #, which a browser never sends to any server;
 *   the page keeps it for this address alone and sends it with each request. A cookie would
 *   go to every server on 127.0.0.1, whatever its port, so there is none. A page elsewhere
 *   cannot add the header without asking first, and this server never says yes.
 * - Every write must come from the plant's own page (Origin) with a JSON body.
 * - The pages ship with a Content-Security-Policy that lets them talk to this server and
 *   nothing else.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { FORMAT, proofOf } from './files';
import { type Bridge, createBridge } from './protocol';
import { KEY_HEADER, type Wiring } from './words';

/**
 * Sent for any service worker script asked of this address. The plant uses none; one put there
 * by another program while the bridge was stopped would sit between the page and the bridge,
 * so whenever the browser checks it for an update, it gets this, which removes itself.
 */
const UNREGISTER = 'self.addEventListener("install", () => self.skipWaiting());\nself.addEventListener("activate", (e) => e.waitUntil(self.registration.unregister().then(() => self.clients.matchAll()).then((cs) => cs.forEach((c) => c.navigate(c.url)))));\n';

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
	/** The secret every /api/ request must carry, in the KEY_HEADER header (see newKey in files.ts). */
	key: string;
	/**
	 * The plant's own address name (see addressName in files.ts): <name>.localhost is answered
	 * too. Read at every request, so it can be set once the start holds the folder.
	 */
	name?: string;
	log?: (line: string) => void;
	/** How to wire each harness, for the plant's page. */
	wiring?: () => Wiring;
	/** For tests: the bridge to use instead of a new one. */
	bridge?: Bridge;
}

/**
 * Whether a Host header names this server.
 *
 * @param host Host header.
 * @param port The port listened on.
 * @param name The plant's own address name, if any.
 * @returns True for localhost, 127.0.0.1, [::1] or <name>.localhost on this port.
 */
export function hostAllowed(host: string | undefined, port: number, name?: string): boolean {
	return !!host && [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, ...(name ? [`${name}.localhost:${port}`] : [])].includes(host.toLowerCase());
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
	// Made at the first keyed request: a start that finds the folder already held closes again
	// without ever reading the folder's threads.
	let made = o.bridge;
	const bridge = (): Bridge => (made ??= createBridge({ dir: o.dir, log: o.log, wiring: o.wiring }));
	return async (req, res) => {
		try {
			const host = req.headers.host;
			if (!hostAllowed(host, o.port, o.name)) { json(res, 403, { error: 'This bridge only answers on localhost.' }); return; }
			const method = (req.method ?? 'GET').toUpperCase();
			const url = req.url ?? '/';
			const path = url.split('?')[0];
			if (req.headers['service-worker'] === 'script') {
				res.writeHead(200, { ...HEADERS, 'Content-Type': 'text/javascript; charset=utf-8', 'Service-Worker-Allowed': '/' });
				res.end(UNREGISTER);
				return;
			}
			if (!path.startsWith('/api/')) {
				if (method !== 'GET' && method !== 'HEAD') { json(res, 405, { error: 'Method not allowed' }); return; }
				file(res, o.web, path);
				return;
			}
			// Whether this is the plant a start is looking for: proven with the key, never by giving it.
			if (path === '/api/plant-bridge' && method === 'GET') {
				const challenge = new URLSearchParams(url.split('?')[1] ?? '').get('challenge');
				const here = { bridge: true, format: FORMAT };
				json(res, 200, challenge && /^[0-9a-f]{16,64}$/.test(challenge) ? { ...here, proof: proofOf(o.key, challenge) } : here);
				return;
			}
			const offered = req.headers[KEY_HEADER];
			if (!same(typeof offered === 'string' ? offered : null, o.key)) {
				json(res, 401, { error: 'This page does not have the plant\'s current key. Open the plant from the link in the terminal where it started.' });
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
			const a = bridge().handle(method, url, body);
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

/** A bridge listening on this computer's loopback addresses. */
export interface Listening {
	/** Stop listening on every address. */
	close(): Promise<void>;
}

/**
 * Listen on one address.
 *
 * @param handler The request handler.
 * @param port Port.
 * @param host Address.
 * @returns The listening server.
 */
function listenOn(handler: ReturnType<typeof createHandler>, port: number, host: string): Promise<Server> {
	const server = createServer(handler);
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => { server.off('error', reject); resolve(server); });
	});
}

/**
 * Start the server on 127.0.0.1 and [::1]. The plant's address, <name>.localhost, can lead a
 * browser to either, so both are held: a port free on one of them alone could be taken there by
 * another user, who would then be sent the plant's key. A computer without IPv6 has no [::1] to take.
 *
 * @param o Options.
 * @returns The listening bridge.
 * @throws The listen error (EADDRINUSE when either address is taken).
 */
export async function serve(o: ServeOptions): Promise<Listening> {
	const handler = createHandler(o);
	const servers = [await listenOn(handler, o.port, '127.0.0.1')];
	try {
		servers.push(await listenOn(handler, o.port, '::1'));
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== 'EADDRNOTAVAIL' && code !== 'EAFNOSUPPORT') {
			servers[0].close();
			throw err;
		}
	}
	return { close: () => Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r())))).then(() => {}) };
}
