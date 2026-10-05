/**
 * The frame bank's memory rule: a capped least-recently-used map that never evicts what was
 * just used, and reports each eviction so the texture can be freed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLru } from '../src/cockpit/lru';
import { MAX_FRAMES } from '../src/cockpit/frames';

test('evicts the least recently used entry past the cap, and reports it', () => {
	const evicted: string[] = [];
	const lru = createLru<number>(3, (k) => evicted.push(k));
	lru.set('a', 1); lru.set('b', 2); lru.set('c', 3);
	assert.deepEqual(evicted, []);
	lru.set('d', 4);
	assert.deepEqual(evicted, ['a']);
	assert.equal(lru.size, 3);
	assert.deepEqual([...lru.keys()], ['b', 'c', 'd']);
});

test('get and touch make an entry the most recent, so it survives the next eviction', () => {
	const evicted: string[] = [];
	const lru = createLru<number>(3, (k) => evicted.push(k));
	lru.set('a', 1); lru.set('b', 2); lru.set('c', 3);
	assert.equal(lru.get('a'), 1);
	lru.touch('b');
	lru.set('d', 4);
	assert.deepEqual(evicted, ['c']);
	lru.touch('missing');
	assert.equal(lru.size, 3);
});

test('a frame touched every tick is never evicted, however many others arrive', () => {
	const evicted = new Set<string>();
	const lru = createLru<number>(50, (k) => evicted.add(k));
	lru.set('on-screen', 0);
	for (let i = 0; i < 1000; i++) {
		lru.set(`f${i}`, i);
		lru.touch('on-screen');
	}
	assert.ok(!evicted.has('on-screen'));
	assert.equal(lru.size, 50);
});

test('delete removes without reporting an eviction; replacing a key keeps one copy', () => {
	const evicted: string[] = [];
	const lru = createLru<number>(2, (k) => evicted.push(k));
	lru.set('a', 1);
	lru.set('a', 2);
	assert.equal(lru.size, 1);
	assert.equal(lru.get('a'), 2);
	assert.equal(lru.delete('a'), true);
	assert.deepEqual(evicted, []);
	assert.equal(lru.has('a'), false);
});

test('the frame cap holds a walk cycle and a current animation for at least 20 comrades', () => {
	// 8 directions × 4 walk frames + up to 6 frames of the current animation.
	assert.ok(MAX_FRAMES >= 20 * (8 * 4 + 6));
});
