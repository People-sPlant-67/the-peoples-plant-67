/**
 * The workflows lean on each other by name, and a rename on one side fails silently: Pages would
 * simply never run again. These tests keep pages.yml in step with ci.yml, and keep every action
 * pinned to a commit, with download-artifact on a version that keeps zip entries inside the folder
 * it unpacks to (v4 did not, which let a poisoned artifact replace the scanner).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const DIR = '.github/workflows';
const read = (name: string) => readFileSync(`${DIR}/${name}`, 'utf8');

test('Pages runs after the workflow ci.yml names, and downloads the artifact it uploads', () => {
	const ci = read('ci.yml');
	const pages = read('pages.yml');
	const ciName = /^name: (.+)$/m.exec(ci)?.[1];
	assert.ok(ciName, 'ci.yml has no name.');
	assert.match(pages, new RegExp(`^ {4}workflows: \\[${ciName}\\]$`, 'm'), `pages.yml should run after "${ciName}".`);
	const downloaded = /download-artifact@.*\n(?: {8}.*\n)*? {10}name: (\S+)/.exec(pages)?.[1];
	assert.ok(downloaded, 'pages.yml downloads no named artifact.');
	const uploaded = /upload-artifact@.*\n {8}with:\n {10}name: (\S+)\n {10}path: \|\n((?: {12}.*\n)+)/.exec(ci);
	assert.ok(uploaded, 'ci.yml uploads no named artifact.');
	assert.equal(uploaded[1], downloaded, 'pages.yml downloads an artifact ci.yml does not upload.');
	assert.match(uploaded[2], /^ {12}dist-site$/m, 'The artifact pages.yml deploys does not carry dist-site.');
});

test('every action is pinned to a commit, and download-artifact to v8 or later', () => {
	for (const name of readdirSync(DIR).filter((f) => f.endsWith('.yml'))) {
		for (const [, action, ref, version] of read(name).matchAll(/uses: ([\w./-]+)@(\S+)(?: # (\S+))?/g)) {
			assert.match(ref, /^[0-9a-f]{40}$/, `${name}: ${action} is not pinned to a commit.`);
			assert.ok(version, `${name}: ${action} has no version beside its commit.`);
			if (action === 'actions/download-artifact') assert.ok(Number(/^v(\d+)/.exec(version)?.[1]) >= 8, `${name}: download-artifact ${version} is older than v8.`);
		}
	}
});
