/**
 * The posters under a fake DOM: what each says, one per kind in a fixed order, what was
 * already waiting pinned quietly while the plant settles, a new kind unrolled with a rustle, each
 * click going to the next case, and a poster leaving when nothing of its kind waits.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';

const win = new Window();
Object.assign(globalThis, { document: win.document });
const { SETTLE_MS, UNROLL_MS, createPosters, postersFor } = await import('../src/cockpit/posters');
type Waiting = Parameters<typeof postersFor>[0];

const none: Waiting = { tribunals: 0, unfinished: false, hires: 0, dossiers: 0, stray: 0, questions: 0, askedBy: null };

test('each poster says what waits, in a sentence, in order, and nothing waiting means no poster', () => {
	assert.deepEqual(postersFor(none), []);
	const all = postersFor({ tribunals: 2, unfinished: false, hires: 1, dossiers: 3, stray: 0, questions: 1, askedBy: 'Anna' });
	assert.deepEqual(all.map((p) => [p.kind, p.title, p.count]), [['tribunal', 'ТРИБУНАЛ', 2], ['hire', 'КАДРЫ', 1], ['dossier', 'ДОСЬЕ', 3], ['question', 'ВОПРОС', 1]]);
	assert.deepEqual(all.map((p) => p.text), [
		'2 tribunals await your verdict.',
		'A new comrade waits at the desk to be hired.',
		'3 dossiers await your stamp.',
		'Anna has a question for you.',
	]);
	assert.equal(postersFor({ ...none, tribunals: 1, unfinished: true })[0].text, 'A guilty verdict needs finishing.');
	assert.equal(postersFor({ ...none, questions: 3, askedBy: null })[0].text, '3 questions await your answer.');
	assert.equal(postersFor({ ...none, questions: 2, askedBy: 'Boris' })[0].text, 'Boris has 2 questions for you.');
	const both = postersFor({ ...none, dossiers: 1, stray: 2 })[0];
	assert.equal(both.text, 'A dossier awaits your stamp. 2 more have nobody to carry them; decide them in Paperclip.');
	assert.equal(both.count, 3);
	const stray = postersFor({ ...none, stray: 1 })[0];
	assert.equal(stray.text, 'An approval has nobody on the roster to carry it; decide it in Paperclip.');
	assert.equal(stray.goes, false, 'nowhere in the plant to go for it');
});

test('what waits at opening is pinned quietly; a new kind later unrolls with a rustle, then joins the stack', () => {
	let rustles = 0;
	const went: [string, number][] = [];
	const p = createPosters({ go: (k, n) => went.push([k, n]), rustle: () => rustles++ });
	p.update(postersFor({ ...none, dossiers: 2 }));
	p.tick(SETTLE_MS - 1);
	p.update(postersFor({ ...none, dossiers: 2, tribunals: 1 }));
	assert.equal(rustles, 0, 'still settling: the tribunal was already waiting');
	assert.equal(p.unrolled, null);
	assert.deepEqual(Array.from(p.el.querySelectorAll('.p67-poster-stack .p67-poster'), (b) => b.className.split(' ')[1]), ['p67-poster-tribunal', 'p67-poster-dossier'], 'in order, whatever came first');
	p.tick(2);
	p.update(postersFor({ ...none, dossiers: 2, tribunals: 1, hires: 1 }));
	assert.equal(rustles, 1);
	assert.equal(p.unrolled, 'hire');
	const herald = p.el.querySelector('.p67-herald') as unknown as HTMLButtonElement;
	assert.equal(herald.hidden, false);
	assert.match(herald.textContent ?? '', /ВНИМАНИЕ.*A new comrade waits at the desk/);
	assert.match(p.el.querySelector('.p67-sr')?.textContent ?? '', /A new comrade waits/, 'said aloud too');
	p.update(postersFor({ ...none, dossiers: 2, tribunals: 1, hires: 1 }));
	assert.equal(rustles, 1, 'the same again is not news');
	p.tick(UNROLL_MS);
	assert.equal(p.unrolled, null, 'it joins the stack');
	assert.equal(herald.hidden, true);
	// The unrolled poster goes to its case when clicked.
	p.update(postersFor({ ...none, dossiers: 2, tribunals: 1, hires: 1, questions: 1, askedBy: 'Anna' }));
	herald.click();
	assert.deepEqual(went, [['question', 0]]);
	assert.equal(p.unrolled, null);
	// A kind whose first count was only just read is not news either.
	p.update(postersFor({ ...none, dossiers: 2, tribunals: 1, hires: 1, questions: 1, askedBy: 'Anna' }), ['question']);
	assert.equal(rustles, 2, 'only the one unrolled above');
});

test('each click goes to the next case, round again; a poster leaves when its kind is done; focus is kept', () => {
	const went: number[] = [];
	const p = createPosters({ go: (_k, n) => went.push(n), rustle: () => {} });
	p.update(postersFor({ ...none, dossiers: 3, questions: 1, askedBy: 'Anna' }));
	const d = p.poster('dossier')!;
	(win.document.body as unknown as HTMLElement).append(p.el as never);
	d.focus();
	for (let k = 0; k < 4; k++) d.click();
	assert.deepEqual(went, [0, 1, 2, 0]);
	p.update(postersFor({ ...none, dossiers: 2, questions: 1, askedBy: 'Anna' }));
	assert.equal(win.document.activeElement, d, 'a count changing does not take the focus away');
	assert.equal(d.querySelector('em')?.textContent, '2');
	assert.equal(d.getAttribute('aria-label'), '2 dossiers await your stamp. Go there.');
	d.click();
	assert.equal(went.at(-1), 1, 'the next case after a shrink, counting from where it was');
	p.update(postersFor({ ...none, questions: 1, askedBy: 'Anna' }));
	assert.equal(p.poster('dossier'), null, 'gone');
	assert.equal(d.isConnected, false);
	p.update(postersFor({ ...none, stray: 1 }));
	const s = p.poster('dossier')!;
	const n = went.length;
	s.click();
	assert.equal(went.length, n, 'nowhere to go for an approval nobody carries');
	assert.equal(s.getAttribute('aria-label'), 'An approval has nobody on the roster to carry it; decide it in Paperclip.');
	p.el.remove();
});
