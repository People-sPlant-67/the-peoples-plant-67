/**
 * Every sentence the plant prints in its terminal when something fails (the start and hooks
 * commands, and the bridge's own refusals) has an entry in docs/TROUBLESHOOTING.md. The
 * sentences are read from the source: each string or template with at least four words, and
 * every fixed piece of it must be on the page. A new one must either be added to the page, or
 * be named below as one that reports success or gives directions, so it needs no entry.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const SOURCES = ['src/bridge/cli.ts', 'src/bridge/cli-entry.ts', 'src/bridge/files.ts', 'src/bridge/install.ts', 'src/bridge/server.ts', 'src/bridge/words.ts'];

/** Lines that report success or give directions: no entry needed. Matched against the whole sentence. */
const NOT_FAILURES: RegExp[] = [
	/^The People's Plant #67: your agents/, // --help
	/^<!doctype html>/i, // pages, not sentences
	/^\s*★ The People's Plant #67 is/,
	/^\s*That link carries the plant's key/,
	/^\s*If the plant did not open in your browser/,
	/^\s*Agents: … on file\./,
	/^\s*… … wired\. Start a new session/,
	/^\s*To wire (Claude Code|Codex) too:/,
	/^\s*If Codex has not (appeared|run them yet)/,
	/^\s*No agents yet\. In a second terminal/,
	/^\s*Claude Code: {2}…$/,
	/^\s*Then type \/hooks in Codex/,
	/^\s*Updated the hook script in/,
	/^\s*The plant has stopped\. Its link no longer works\./,
	/^No plant (hooks found|notify line) in/,
	/^Removed (… plant hooks|the plant's notify line)/,
	/^Copied the hook script to/,
	/^The plant's (…|notify line in|hooks are already in)/,
	/^Backed up … to/,
	/^Added (… plant hooks|the plant's notify line)/,
	/^Codex (asks you to trust|now tells the plant)/,
	/^Start a new … session/,
	/^Each start gives a new link/,
];

/**
 * The sentences in one source file: each string or template literal with four words or more,
 * with … where a value goes in.
 *
 * @param file Path.
 * @returns Sentences, with their line numbers.
 */
function sentencesIn(file: string): { text: string; parts: string[]; line: number }[] {
	const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	const out: { text: string; parts: string[]; line: number }[] = [];
	const visit = (n: ts.Node): void => {
		let parts: string[] | null = null;
		if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts = [n.text];
		else if (ts.isTemplateExpression(n)) parts = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
		if (!parts) { ts.forEachChild(n, visit); return; }
		const text = parts.join('…');
		if ((text.match(/ /g) ?? []).length >= 3 && /[a-z]{2,} [a-z]{2,}/i.test(text)) out.push({ text, parts, line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
	};
	visit(src);
	return out;
}

/** Spaces made single, so a sentence matches the page however it is wrapped. */
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * The parts of a sentence the page must hold word for word: every fixed piece of 8 characters
 * or more (split at line breaks), so two sentences that open alike still need an entry each.
 *
 * @param parts The sentence's fixed pieces.
 * @returns The pieces.
 */
function keysOf(parts: string[]): string[] {
	return parts.flatMap((p) => p.split('\n')).map(squash).filter((p) => p.length >= 8);
}

const page = squash(readFileSync('docs/TROUBLESHOOTING.md', 'utf8').replace(/`|\*\*/g, ''));

test('troubleshooting: every failure sentence of the bridge has an entry', () => {
	const missing: string[] = [];
	const used = new Set<RegExp>();
	let checked = 0;
	for (const file of SOURCES) {
		for (const s of sentencesIn(file)) {
			const skip = NOT_FAILURES.find((r) => r.test(s.text));
			if (skip) { used.add(skip); continue; }
			checked++;
			for (const key of keysOf(s.parts)) if (!page.includes(key)) missing.push(`${file}:${s.line}  "${key}"`);
		}
	}
	assert.ok(checked >= 40, `only ${checked} sentences found: has the source moved?`);
	assert.deepEqual(missing, [], 'add these to docs/TROUBLESHOOTING.md, or to NOT_FAILURES if they report success');
	assert.deepEqual(NOT_FAILURES.filter((r) => !used.has(r)).map(String), [], 'these NOT_FAILURES match nothing now: remove them');
});

test('troubleshooting: the check finds a sentence the page lacks, even one that opens like another', () => {
	assert.ok(keysOf(['The plant has grown a third arm and will not start.']).some((k) => !page.includes(k)));
	// Opens as an entry on the page does, and ends somewhere new.
	assert.ok(keysOf(['The plant cannot make ', ', because the moon is in the way.']).some((k) => !page.includes(k)));
	assert.deepEqual(keysOf(['  Another plant', ' (process ', ') took it.\n  Open it.']), ['Another plant', '(process', ') took it.', 'Open it.'], 'pieces of 8 or more, split at line breaks');
});
