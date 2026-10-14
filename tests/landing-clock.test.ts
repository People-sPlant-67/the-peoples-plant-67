import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStorage, tourClock } from '../src/landing/clock';

test('tour time excludes pauses and resumes queued work exactly once', async () => {
	let now = 100;
	const clock = tourClock(() => now);
	now = 200;
	assert.equal(clock.now(), 100);
	clock.pause(true);
	clock.pause(true);
	now = 5_000;
	assert.equal(clock.now(), 100);
	let woke = 0;
	const waiting = clock.active().then(() => woke++);
	await Promise.resolve();
	assert.equal(woke, 0);
	clock.pause(false);
	await waiting;
	assert.equal(woke, 1);
	now = 5_100;
	assert.equal(clock.now(), 200);
});

test('each embedded tour gets fresh storage without touching another run', () => {
	const first = memoryStorage(), second = memoryStorage();
	first.setItem('plant67.setup.v1', 'fictional');
	assert.equal(second.getItem('plant67.setup.v1'), null);
	assert.equal(first.length, 1);
	assert.equal(first.key(0), 'plant67.setup.v1');
	first.removeItem('plant67.setup.v1');
	assert.equal(first.length, 0);
	second.setItem('x', 'y');
	second.clear();
	assert.equal(second.length, 0);
});
