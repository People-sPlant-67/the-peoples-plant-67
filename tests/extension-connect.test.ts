/**
 * Turning a typed Paperclip address into an origin and the patterns Chrome needs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentMatches, isLocalName, permissionOrigins, plantUrl, tidyAddress } from '../src/extension/connect';

/**
 * The origin an address tidies to, or the error.
 *
 * @param {string} raw Typed text.
 * @returns {string} Origin or "error:<why>".
 */
const t = (raw: string): string => {
	const r = tidyAddress(raw);
	return r.ok ? r.origin : `error:${r.error}`;
};

test('bare names default to https, local names to http', () => {
	assert.equal(t('paperclip.example.com'), 'https://paperclip.example.com');
	assert.equal(t('  Paperclip.Example.COM  '), 'https://paperclip.example.com');
	assert.equal(t('localhost:3100'), 'http://localhost:3100');
	assert.equal(t('localhost'), 'http://localhost');
	assert.equal(t('127.0.0.1:3100'), 'http://127.0.0.1:3100');
	assert.equal(t('192.168.1.20:3100'), 'http://192.168.1.20:3100');
	assert.equal(t('paperclip.local:3100'), 'http://paperclip.local:3100');
	assert.equal(t('plant.test'), 'http://plant.test');
	assert.equal(t('app.localhost:5173'), 'http://app.localhost:5173');
	assert.equal(t('10.0.0.4:3100'), 'http://10.0.0.4:3100');
	assert.equal(t('203.0.113.7:3100'), 'https://203.0.113.7:3100', 'a public IP is not assumed safe for http');
});

test('a typed port 80 or 443 says the scheme', () => {
	assert.equal(t('paperclip.example.com:80'), 'http://paperclip.example.com');
	assert.equal(t('192.168.1.5:443'), 'https://192.168.1.5');
	assert.equal(t('https://paperclip.example.com:80'), 'https://paperclip.example.com:80');
});

test('single-word machine names need a port or a scheme', () => {
	assert.equal(t('paperclip:3100'), 'http://paperclip:3100');
	assert.equal(t('http://paperclip:3100'), 'http://paperclip:3100');
	assert.equal(t('https://paperclip'), 'https://paperclip');
	assert.equal(t('paperclip'), 'error:shape');
});

test('hosts come out the way Chrome sees them', () => {
	assert.equal(t('bücher.example'), 'https://xn--bcher-kva.example');
	assert.equal(t('0x7f.1:3100'), 'http://127.0.0.1:3100');
	assert.equal(t('010.0.0.1'), 'https://8.0.0.1');
	assert.equal(t('my_host.lan:3100'), 'http://my_host.lan:3100');
});

test('a typed scheme wins, and paths, queries, fragments and default ports are dropped', () => {
	assert.equal(t('http://paperclip.example.com'), 'http://paperclip.example.com');
	assert.equal(t('https://localhost:3100/'), 'https://localhost:3100');
	assert.equal(t('HTTPS://Paperclip.example.com/PLT/dashboard?x=1#top'), 'https://paperclip.example.com');
	assert.equal(t('paperclip.example.com/companies'), 'https://paperclip.example.com');
	assert.equal(t('https://paperclip.example.com:443'), 'https://paperclip.example.com');
	assert.equal(t('http://localhost:80/x'), 'http://localhost');
	assert.equal(t('https://paperclip.example.com:8443'), 'https://paperclip.example.com:8443');
	assert.equal(t('localhost:03100'), 'http://localhost:3100');
	assert.equal(t('paperclip.example.com.'), 'https://paperclip.example.com');
});

test('nothing but http and https', () => {
	assert.equal(t('ftp://paperclip.example.com'), 'error:scheme');
	assert.equal(t('javascript:alert(1)'), 'error:scheme');
	assert.equal(t('file:///etc/passwd'), 'error:scheme');
	assert.equal(t('chrome://extensions'), 'error:scheme');
	assert.equal(t('mailto:x'), 'error:scheme');
	assert.equal(t('user:pw@example.com'), 'error:scheme');
	assert.equal(t('https:paperclip.example.com'), 'error:shape');
});

test('things that are not addresses are refused', () => {
	assert.equal(t(''), 'error:empty');
	assert.equal(t('   '), 'error:empty');
	for (const bad of ['my paperclip', 'paperclip', 'https://', 'localhost:0', 'localhost:65536', 'localhost:abc', '999.1.1.1', '-bad.example.com',
		'bad-.example.com', 'a..b.com', 'user@example.com', 'https://user@example.com', '[::1]:3100', 'http://[::1]:3100',
		'*.example.com', 'paperclip.example.com:3100:1', 'a.123', '1.1.1.1.1', 'exa mple.com']) {
		assert.equal(t(bad), 'error:shape', bad);
	}
});

test('local names', () => {
	for (const n of ['localhost', 'paperclip', '127.0.0.1', '127.8.8.8', '10.0.0.4', '172.16.0.1', '172.31.255.1', '192.168.1.20', '169.254.1.1', 'x.local', 'x.test', 'x.internal', 'x.lan', 'x.home.arpa', 'x.localhost']) assert.ok(isLocalName(n), n);
	for (const n of ['example.com', 'localhost.example.com', 'local.example.com', 'my.ts.net', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '203.0.113.7']) assert.ok(!isLocalName(n), n);
});

test('the plant URL, the permission and the content-script patterns follow the origin', () => {
	assert.equal(plantUrl('http://localhost:3100'), 'http://localhost:3100/api/plant-67');
	assert.deepEqual(permissionOrigins('https://paperclip.example.com'), ['https://paperclip.example.com/*']);
	// The grant covers every port on the host; the script runs on the exact one.
	assert.deepEqual(permissionOrigins('http://localhost:3100'), ['http://localhost/*']);
	assert.deepEqual(permissionOrigins('https://paperclip.example.com:8443'), ['https://paperclip.example.com/*']);
	assert.deepEqual(contentMatches('http://localhost:3100'), ['http://localhost:3100/api/plant-67', 'http://localhost:3100/api/plant-67?*']);
});
