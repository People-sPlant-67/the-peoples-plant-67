/**
 * The bridge's web server: the plant's files, and the Plant Protocol from protocol.ts, on this
 * computer's own addresses (127.0.0.1 and [::1]) only. No dependencies beyond Node.
 *
 * A message the owner sends becomes words in an agent's next prompt, so who may send one
 * matters even on this computer, where other users and programs can reach 127.0.0.1 too.
 *
 * - Every request must name this start's own address as its Host (<name>.localhost, new at
 *   each start). A page that points its own domain at 127.0.0.1 gets nothing. A bare address
 *   (localhost, 127.0.0.1) answers only another start's probe; it, and an earlier start's
 *   address, get a page saying where the plant is, and nothing of the plant's.
 * - Every /api/ request must be signed with the plant's key (see requestSignature in proof.ts):
 *   over a nonce never used before, the time it was made, its method, path and body. The key
 *   itself never travels. It is made new each time the bridge starts and kept in the plant's
 *   folder (bridge.lock), which only its owner can read. The link the npx command opens carries
 *   it after the #, which a browser never sends to any server; the page keeps it in the tab.
 *   There is no cookie. Only GET /api/plant-bridge answers unsigned: that a bridge is here.
 * - Every answer to a verified request is signed too, status and body (PROOF_HEADER), so the
 *   page can tell this bridge from a program that took the port after it stopped. Such a
 *   program learns nothing it could sign with.
 * - Every write must come from the plant's own page (Origin) with a JSON body.
 * - The pages ship with a Content-Security-Policy that lets them talk to this server and
 *   nothing else.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { FORMAT } from './files';
import { readPrefs, isPrefsChange, mergePrefs } from './prefs';
import { answerMessage, proofOf, requestMessage } from './proof';
import { type Bridge, createBridge } from './protocol';
import { AUTH_HEADER, NONCE_HEADER, OLD_KEY, PROOF_HEADER, TIME_HEADER, TIME_SLACK_MS, type Wiring } from './words';

/**
 * Sent for any service worker script asked of this address. The plant uses none; one put there
 * by another program while the bridge was stopped would sit between the page and the bridge,
 * so whenever the browser checks it for an update, it gets this, which removes itself.
 */
const UNREGISTER = 'self.addEventListener("install", () => self.skipWaiting());\nself.addEventListener("activate", (e) => e.waitUntil(self.registration.unregister().then(() => self.clients.matchAll()).then((cs) => cs.forEach((c) => c.navigate(c.url)))));\n';

/** What /api/plant-bridge says: a bridge is here, and which file format it reads. */
const HERE = { bridge: true, format: FORMAT };

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
	/** This start's key, which every /api/ request must be signed with (see requestSignature in proof.ts). */
	key: string;
	/** This start's address name (see newAddressName in files.ts): the plant is served at <name>.localhost only. */
	name: string;
	log?: (line: string) => void;
	/** How to wire each harness, for the plant's page. */
	wiring?: () => Wiring;
	/** For tests: the bridge to use instead of a new one. */
	bridge?: Bridge;
	/** Whether the folder is still this start's (it may put back a lock deleted by hand), checked before every signed request. */
	held?: () => boolean;
	/** Called once the folder turns out to be another start's. */
	lost?: () => void;
}

/**
 * What a Host header names: this start's own address; a bare address of this computer on this
 * port (localhost, 127.0.0.1 or [::1]), which other programs may have used while the plant was
 * stopped; an address of an earlier start of a plant; or nothing this server answers.
 *
 * @param host Host header.
 * @param port The port listened on.
 * @param name This start's address name.
 * @returns 'own', 'bare', 'old' or null.
 */
export function hostKind(host: string | undefined, port: number, name: string): 'own' | 'bare' | 'old' | null {
	const h = host?.toLowerCase() ?? '';
	if (h === `${name}.localhost:${port}`) return 'own';
	if ([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(h)) return 'bare';
	if (h.endsWith(`.localhost:${port}`) && /^p67-[0-9a-f]{16}\.localhost:/.test(h)) return 'old';
	return null;
}

/** What a page at a bare address, or at an earlier start's, says. Nothing else is served there. */
const ELSEWHERE: Record<'bare' | 'old', string> = {
	bare: 'The plant does not open at this address. Open it from the link in the terminal where it started.',
	old: 'This is an old address of the plant. The plant\'s address changes each time it starts. Open the plant from the newest link in the terminal where it started, and close this tab.',
};

/**
 * A small page saying where the plant is, for a browser at the wrong address. No scripts, no secrets.
 *
 * @param res Response.
 * @param words What it says.
 */
function elsewhere(res: ServerResponse, words: string): void {
	res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
	res.end(`<!doctype html><meta charset="utf-8"><title>The People's Plant #67</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16181d;font:16px/1.5 system-ui,sans-serif"><main style="max-width:34rem;margin:1rem;padding:1.25rem 1.5rem;background:#efe3c4;color:#2a2420;border:3px solid #b02a22"><h1>★ The People's Plant #67</h1><p>${words}</p></main>`);
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
 * @param prove Signs the answer, for a request that was verified.
 */
function json(res: ServerResponse, status: number, body: unknown, prove?: (status: number, text: string) => string): void {
	const text = JSON.stringify(body);
	res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...(prove ? { [PROOF_HEADER]: prove(status, text) } : {}) });
	res.end(text);
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
	// Made at the first signed request: a start that finds the folder already held closes again
	// without ever reading the folder's threads.
	let made = o.bridge;
	const bridge = (): Bridge => (made ??= createBridge({ dir: o.dir, log: o.log, wiring: o.wiring }));
	/** Nonces already used, with when they were made: none is accepted twice while its time is good. */
	const seen = new Map<string, number>();
	const sign = (message: string): string => createHmac('sha256', o.key).update(message).digest('hex');
	const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
	return async (req, res) => {
		/** Set once the request is verified: from then on every answer is signed, body and all. */
		let prove: ((status: number, text: string) => string) | undefined;
		const send = (status: number, body: unknown): void => json(res, status, body, prove);
		try {
			const host = req.headers.host;
			const kind = hostKind(host, o.port, o.name);
			const method = (req.method ?? 'GET').toUpperCase();
			const url = req.url ?? '/';
			const path = url.split('?')[0];
			if (!kind) { json(res, 403, { error: 'This bridge only answers at the plant\'s own address.' }); return; }
			if (kind !== 'own') {
				// Another start's probe asks a bare address; a browser there, or at an old address, is
				// told where the plant is. Nothing of the plant's own is served at either.
				if (kind === 'bare' && path === '/api/plant-bridge' && method === 'GET') {
					const challenge = new URLSearchParams(url.split('?')[1] ?? '').get('challenge');
					json(res, 200, challenge && /^[0-9a-f]{16,64}$/.test(challenge) ? { ...HERE, proof: proofOf(o.key, challenge) } : HERE);
				} else if (!path.startsWith('/api/') && method === 'GET') elsewhere(res, ELSEWHERE[kind]);
				else json(res, 403, { error: ELSEWHERE[kind] });
				return;
			}
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
			// Asked without a signature, /api/plant-bridge says only that a bridge is here.
			if (path === '/api/plant-bridge' && method === 'GET' && !req.headers[AUTH_HEADER]) { json(res, 200, HERE); return; }
			if (method !== 'GET' && method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return; }
			// Signed with this start's key, over this very request, made just now, and never seen
			// before. Its form is checked before any body is read.
			const now = Date.now();
			const signed = signedHeaders(req, now);
			if (!signed) { json(res, 401, { error: OLD_KEY }); return; }
			const { nonce: n, time, auth: signature } = signed;
			let text = '';
			if (method === 'POST') {
				if (!originAllowed(req.headers.origin, host)) { json(res, 403, { error: 'Only the plant itself may send to the bridge.' }); return; }
				if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) { json(res, 415, { error: 'The bridge takes JSON only.' }); return; }
				const read = await readBody(req);
				if (read === null) { json(res, 413, { error: 'That is too big for the bridge.' }); return; }
				text = read;
			}
			if (seen.has(n) || !same(signature, sign(requestMessage(n, time, method, url, hash(text))))) { json(res, 401, { error: OLD_KEY }); return; }
			seen.set(n, time);
			for (const [old, t] of seen) { if (now - t <= 2 * TIME_SLACK_MS) break; seen.delete(old); }
			prove = (status, answer) => sign(answerMessage(n, status, hash(answer)));
			if (path === '/api/plant-bridge' && method === 'GET') { send(200, HERE); return; }
			// A plant paused (Ctrl+Z) while another start took its folder must not answer from its old
			// copy of the threads once it wakes: it stops instead.
			if (o.held && !o.held()) {
				send(503, { error: 'Another start of the plant took this folder, so this one is stopping. Open the plant from the link in that start\'s terminal.' });
				o.lost?.();
				return;
			}
			let body: unknown;
			try { body = text ? JSON.parse(text) : undefined; } catch { send(400, { error: 'The body is not JSON.' }); return; }
			// The bridge's own routes, for its page; everything else is the Plant Protocol.
			if (path === '/api/plant-bridge/wiring' && method === 'GET') { if (o.wiring) send(200, o.wiring()); else send(404, { error: 'Route not found' }); return; }
			if (path === '/api/plant-bridge/prefs') {
				if (method === 'GET') { send(200, readPrefs(o.dir)); return; }
				if (!isPrefsChange(body)) { send(422, { error: 'The plant keeps choices as names and words only.' }); return; }
				let all: Record<string, string> | null;
				try { all = mergePrefs(o.dir, body); } catch (err) { o.log?.(`Could not save prefs.json: ${(err as Error).message}`); send(500, { error: 'The plant could not keep your choices on this computer.' }); return; }
				if (!all) { send(422, { error: 'The plant keeps a few choices only, and these are too many.' }); return; }
				send(200, all);
				return;
			}
			if (method === 'POST' && body === undefined) body = {};
			const a = bridge().handle(method, url, body);
			send(a.status, a.body);
		} catch (err) {
			o.log?.(`The bridge failed on a request: ${(err as Error).message}`);
			if (!res.headersSent) send(500, { error: 'The bridge failed on that request.' });
			else res.end();
		}
	};
}

/**
 * The signature headers of a request, when they are well formed and its time is good.
 *
 * @param req Request.
 * @param now The bridge's clock.
 * @returns Nonce, time and signature, or null.
 */
function signedHeaders(req: IncomingMessage, now: number): { nonce: string; time: number; auth: string } | null {
	const nonce = req.headers[NONCE_HEADER], time = Number(req.headers[TIME_HEADER]), auth = req.headers[AUTH_HEADER];
	if (typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce)) return null;
	if (!Number.isSafeInteger(time) || Math.abs(now - time) > TIME_SLACK_MS) return null;
	if (typeof auth !== 'string' || !/^[0-9a-f]{64}$/.test(auth)) return null;
	return { nonce, time, auth };
}

/**
 * Compare a secret in constant time.
 *
 * @param a Offered.
 * @param b Expected.
 * @returns True when they are equal.
 */
function same(a: string, b: string): boolean {
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
