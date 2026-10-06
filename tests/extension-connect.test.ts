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
		'bad-.example.com', 'a..b.com', 'user@example.com', 'https://user@example.com', '[::1]:3100',
		'paper_clip.example.com', '*.example.com', 'paperclip.example.com:3100:1']) {
		assert.equal(t(bad), 'error:shape', bad);
	}
});

test('local names', () => {
	for (const n of ['localhost', '10.0.0.4', 'x.local', 'x.test', 'x.internal', 'x.lan', 'x.home.arpa', 'x.localhost']) assert.ok(isLocalName(n), n);
	for (const n of ['example.com', 'localhost.example.com', 'local.example.com', 'my.ts.net']) assert.ok(!isLocalName(n), n);
});

test('the plant URL, the permission and the content-script patterns follow the origin', () => {
	assert.equal(plantUrl('http://localhost:3100'), 'http://localhost:3100/api/plant-67');
	assert.deepEqual(permissionOrigins('https://paperclip.example.com'), ['https://paperclip.example.com/*']);
	assert.deepEqual(contentMatches('http://localhost:3100'), ['http://localhost:3100/api/plant-67', 'http://localhost:3100/api/plant-67?*']);
});
