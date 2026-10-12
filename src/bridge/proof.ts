/**
 * The proof that something holds the plant's key: an HMAC-SHA256 of a challenge, so the key
 * itself never leaves. The bridge (Node) proves; another start and the plant's page (browser)
 * check. Written out in plain JavaScript, with no imports, so both sides run the same code: a
 * browser offers crypto.subtle only where it counts the page's address as secure, which not
 * every browser does for <name>.localhost.
 */

/** SHA-256's round constants. */
const K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256.
 *
 * @param data Bytes.
 * @returns Digest, 32 bytes.
 */
function sha256(data: Uint8Array): Uint8Array {
	const bits = data.length * 8;
	const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
	padded.set(data);
	padded[data.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
	view.setUint32(padded.length - 4, bits >>> 0);
	const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
	const w = new Uint32Array(64);
	const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
	for (let at = 0; at < padded.length; at += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4);
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}
		let [a, b, c, d, e, f, g, hh] = h;
		for (let i = 0; i < 64; i++) {
			const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
			const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
			hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
		}
		h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
	}
	const out = new Uint8Array(32);
	const outView = new DataView(out.buffer);
	for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
	return out;
}

/**
 * Bytes as hex.
 *
 * @param bytes Bytes.
 * @returns Hex.
 */
function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * HMAC-SHA256 of a message.
 *
 * @param key Key.
 * @param message Message.
 * @returns 64 hex characters.
 */
export function sign(key: string, message: string): string {
	const enc = new TextEncoder();
	let k: Uint8Array = enc.encode(key);
	if (k.length > 64) k = sha256(k);
	const pad = (byte: number): Uint8Array => { const p = new Uint8Array(64); for (let i = 0; i < 64; i++) p[i] = (k[i] ?? 0) ^ byte; return p; };
	const join = (a: Uint8Array, b: Uint8Array): Uint8Array => { const j = new Uint8Array(a.length + b.length); j.set(a); j.set(b, a.length); return j; };
	return hex(sha256(join(pad(0x5c), sha256(join(pad(0x36), enc.encode(message))))));
}

/**
 * SHA-256 of a text, as hex.
 *
 * @param text Text (UTF-8).
 * @returns 64 hex characters.
 */
export function sha256Hex(text: string): string {
	return hex(sha256(new TextEncoder().encode(text)));
}

/**
 * The proof another start asks a running bridge for: HMAC(key, "plant-67:" + challenge). The
 * challenge is hex only, so this can never stand in for a request's or an answer's signature.
 *
 * @param key Key.
 * @param challenge Challenge.
 * @returns Proof, 64 hex characters.
 */
export function proofOf(key: string, challenge: string): string {
	return sign(key, `plant-67:${challenge}`);
}

/**
 * What a request's signature covers: the nonce (never accepted twice), the time it was made
 * (refused when far off, so a request seen once is soon worthless), the method, the path, and
 * the body's hash.
 *
 * @param nonce 32 hex characters, new for every request.
 * @param time Milliseconds since 1970, when it was made.
 * @param method Method.
 * @param path Path and query, as the server sees them.
 * @param bodyHash SHA-256 of the body, hex.
 * @returns The message signed.
 */
export function requestMessage(nonce: string, time: number, method: string, path: string, bodyHash: string): string {
	return `plant-67-req:${nonce}:${time}:${method}:${path}:${bodyHash}`;
}

/**
 * What an answer's signature covers: the request's nonce, the status and the body's hash.
 *
 * @param nonce The request's nonce.
 * @param status The answer's status.
 * @param bodyHash SHA-256 of the answer's body, hex.
 * @returns The message signed.
 */
export function answerMessage(nonce: string, status: number, bodyHash: string): string {
	return `plant-67-res:${nonce}:${status}:${bodyHash}`;
}

/**
 * The signature the plant's page puts on a request, so the key itself never leaves the tab:
 * whatever answers on the port learns nothing it could sign with.
 *
 * @param key Key.
 * @param nonce 32 hex characters, new for every request.
 * @param time Milliseconds since 1970.
 * @param method Method.
 * @param path Path and query, as the server sees them.
 * @param body Body text ('' for none).
 * @returns Signature, 64 hex characters.
 */
export function requestSignature(key: string, nonce: string, time: number, method: string, path: string, body: string): string {
	return sign(key, requestMessage(nonce, time, method, path, sha256Hex(body)));
}

/**
 * The signature the bridge puts on its answer to a request it verified: proof that the answer
 * came from the bridge holding the key, with this status and this body.
 *
 * @param key Key.
 * @param nonce The request's nonce.
 * @param status The answer's status.
 * @param body The answer's body text.
 * @returns Signature, 64 hex characters.
 */
export function answerSignature(key: string, nonce: string, status: number, body: string): string {
	return sign(key, answerMessage(nonce, status, sha256Hex(body)));
}
