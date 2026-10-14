import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarioDestination } from '../src/landing/routes';

test('documented scenarios stay on the same host and preserve a site subfolder', () => {
	for (const scenario of ['tribunal', 'hire', 'away', 'purge', 'dossier', 'personnel', 'pravda']) {
		for (const base of ['https://example.test/', 'https://example.test/plant/', 'https://example.test/plant/index.html']) {
			const target = new URL('./demo/', base);
			target.searchParams.set('scenario', scenario);
			assert.equal(scenarioDestination(`${base}?scenario=${scenario}&host=https://evil.test/#secret`), target.href);
		}
	}
});

test('plain and unrecognised scenarios remain on the landing page', () => {
	for (const suffix of ['', '?scenario=', '?scenario=unknown', '?scenario=https://evil.test', '?scenario=../', '?scenario=TRIBUNAL']) {
		assert.equal(scenarioDestination(`https://example.test/${suffix}`), null);
	}
});
