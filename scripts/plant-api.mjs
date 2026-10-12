#!/usr/bin/env node
/**
 * Ask a running plant's bridge something from a terminal, as the plant's page does: the request
 * signed with the key in the plant's folder, the answer's signature checked. For testing an
 * adapter, and for CI.
 *
 *   node scripts/plant-api.mjs <plant folder> GET /api/companies
 *   node scripts/plant-api.mjs <plant folder> POST /api/companies/<id>/issues '{"title":"Go"}'
 *
 * Prints the answer's body. Exits 1 when the bridge refuses, or when the answer is not signed by
 * the bridge holding the key.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';

const [dir, method = 'GET', path = '/api/companies', body = ''] = process.argv.slice(2);
if (!dir) { console.error('Say which plant folder: node scripts/plant-api.mjs <plant folder> GET /api/companies'); process.exit(2); }
let lock;
try { lock = JSON.parse(readFileSync(join(dir, 'bridge.lock'), 'utf8')); } catch { console.error(`No plant is running for ${dir}.`); process.exit(1); }
const sign = (message) => createHmac('sha256', lock.key).update(message).digest('hex');
const nonce = randomBytes(16).toString('hex');
const host = `${lock.name}.localhost:${lock.port}`;
const headers = {
	host,
	'x-plant-nonce': nonce,
	'x-plant-auth': sign(`plant-67-req:${nonce}:${method}:${path}:${createHash('sha256').update(body).digest('hex')}`),
	...(method === 'GET' ? {} : { origin: `http://${host}`, 'content-type': 'application/json' }),
};
const req = request({ host: '127.0.0.1', port: lock.port, method, path, headers }, (res) => {
	let text = '';
	res.on('data', (c) => { text += c; });
	res.on('end', () => {
		if (res.headers['x-plant-proof'] !== sign(`plant-67-res:${nonce}:${res.statusCode}`)) { console.error('The answer was not signed by this plant.'); process.exit(1); }
		process.stdout.write(text);
		process.exit(res.statusCode && res.statusCode < 400 ? 0 : 1);
	});
});
req.on('error', (err) => { console.error(`The plant did not answer: ${err.message}`); process.exit(1); });
req.end(body || undefined);
