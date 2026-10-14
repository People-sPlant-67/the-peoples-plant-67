#!/usr/bin/env node
/**
 * Leak scan: fails (exit 1) if anything that could identify the people behind this project, or
 * anyone's live instance, is about to be published.
 *
 * Two kinds of check:
 * - Generic checks every clone runs: email addresses, token-shaped strings, home-folder paths,
 *   and files that must never be committed.
 * - A private deny list of words and phrases. It is never committed (a list of hashes would not
 *   do either: short names fall to a dictionary in a second). It comes from the gitignored file
 *   `.leak-deny` in the repo root, and in CI from the LEAK_DENY secret. One entry per line; a
 *   line starting `re:` is a regular expression; `#` starts a comment.
 *
 * Matching is deliberately greedy. Text is normalised (accents and zero-width characters
 * removed, lower-cased). A deny word of five letters or more, or any phrase, matches anywhere in
 * the line once everything but letters and digits is removed, so camelCase, snake_case,
 * hyphenated, URL and glued forms are all caught. Shorter words match as whole words, with
 * camelCase split first.
 *
 * Usage:
 *   node scripts/leak-scan.mjs                 the files git would commit
 *   node scripts/leak-scan.mjs --history       every commit's patch on every branch
 *   node scripts/leak-scan.mjs --dir dist-demo a folder, e.g. build output before a deploy
 *   add --require-deny to fail when no deny list was found (CI on the main repo, releases)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null;

/**
 * Normalise text for matching: decompose accents and drop them, drop zero-width and other
 * format characters, lower-case.
 *
 * @param {string} s Text.
 * @returns {string} Normalised text.
 */
const norm = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, '').toLowerCase();

/**
 * Letters and digits only, for substring matching.
 *
 * @param {string} s Normalised text.
 * @returns {string} Squashed text.
 */
const squash = (s) => s.replace(/[^a-z0-9]/g, '');

/**
 * Read the deny list from the environment and the local file.
 *
 * @returns {{ long: string[], short: Set<string>, res: RegExp[], count: number }} Entries.
 */
function loadDeny() {
	const lines = [process.env.LEAK_DENY ?? '', existsSync('.leak-deny') ? readFileSync('.leak-deny', 'utf8') : '']
		.join('\n').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
	const long = [], short = new Set(), res = [];
	for (const l of lines) {
		if (l.startsWith('re:')) { res.push(new RegExp(l.slice(3), 'i')); continue; }
		const flat = squash(norm(l));
		if (!flat) continue;
		if (/\s/.test(l) || flat.length >= 5) long.push(flat);
		else short.add(flat);
	}
	return { long, short, res, count: lines.length };
}

const deny = loadDeny();
if (!deny.count) {
	const msg = 'No private deny list was found (.leak-deny or LEAK_DENY), so only the generic checks ran.';
	if (flag('--require-deny')) { console.error(msg); process.exit(1); }
	console.warn(msg);
}

/** Plain patterns that are a problem in any project. */
const PATTERNS = [
	// Allowed: reserved domains, noreply addresses, and noreply@github.com, the committer on every edit made in GitHub's web editor.
	{ re: /\b(?!noreply@github\.com(?![\w-]|\.\w))[A-Za-z0-9._%+-]+@(?!example\.(com|org)\b|anthropic\.com\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.(?!invalid\b)[A-Za-z]{2,}\b/, why: 'an email address' },
	{ re: /\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})/, why: 'something shaped like an API token' },
	{ re: /(\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\)/, why: 'a home-folder path' },
];

/** Files that must never be committed. config.local.json once held a private Paperclip host. */
const FORBIDDEN_FILES = [/(^|\/)config\.local\.json$/, /(^|\/)docs\/private\//, /(^|\/)\.env(?!\.example$)(\..*)?$/, /\.pem$/, /(^|\/)\.leak-deny$/];

/** Files the generic patterns skip: the lockfile is all registry URLs and hashes. */
const SKIP_PATTERNS = new Set(['package-lock.json']);

/**
 * Why a line fails, if it does.
 *
 * @param {string} line Raw line.
 * @param {boolean} generic Whether to run the generic patterns too.
 * @returns {string | null} Why it fails, or null.
 */
function check(line, generic) {
	const n = norm(line);
	const flat = squash(n);
	if (deny.long.some((w) => flat.includes(w))) return 'a word from the private deny list';
	if (deny.short.size) {
		// Split camelCase before lower-casing loses it, then compare whole words (and plurals).
		const words = line.normalize('NFKD').replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) ?? [];
		if (words.some((w) => deny.short.has(w) || (w.endsWith('s') && deny.short.has(w.slice(0, -1))))) return 'a word from the private deny list';
	}
	if (deny.res.some((re) => re.test(n))) return 'a pattern from the private deny list';
	if (generic) for (const p of PATTERNS) if (p.re.test(line)) return p.why;
	return null;
}

/**
 * Check a whole text, line by line. A finding names where and which line, never the words.
 *
 * @param {string} name Where it came from, as the report may print it.
 * @param {string} text Its contents.
 * @param {string[]} problems Collector.
 * @param {boolean} [generic] Whether to run the generic patterns too.
 */
function scanText(name, text, problems, generic = !SKIP_PATTERNS.has(name)) {
	text.split('\n').forEach((line, k) => {
		const why = check(line, generic);
		if (why) problems.push(`${name}:${k + 1}: ${why}.`);
	});
}

/**
 * Every file under a folder. A folder or link that cannot be read is reported by number, never
 * by name, since a name can hold a deny word and CI logs are public.
 *
 * @param {string} dir Folder.
 * @param {string[]} problems Collector.
 * @returns {string[]} Paths.
 */
function walk(dir, problems) {
	let names;
	try { names = readdirSync(dir); } catch (e) { problems.push(`a folder could not be read, so it was not checked (${e.code ?? 'unknown error'}).`); return []; }
	return names.flatMap((f) => {
		const p = join(dir, f);
		let isDir;
		try { isDir = statSync(p).isDirectory(); } catch (e) { problems.push(`an entry could not be read, so it was not checked (${e.code ?? 'unknown error'}).`); return []; }
		return isDir ? walk(p, problems) : [p];
	});
}

const problems = [];
let checked = 0;
if (flag('--history')) {
	// Every patch and every commit message, on every branch: something added and later removed
	// is still published with the history.
	// Author and committer both publish a name and an email; so does whoever made each tag.
	// --text shows binary files' contents too, so a picture added and later removed is still read.
	const log = execFileSync('git', ['log', '--all', '-p', '--text', '--format=commit %H%n%an <%ae>%n%cn <%ce>%n%B'], { encoding: 'utf8', maxBuffer: 1 << 30 });
	scanText('history', log, problems);
	const tags = execFileSync('git', ['for-each-ref', 'refs/tags', '--format=%(refname:short) %(taggername) %(taggeremail)%0a%(contents)'], { encoding: 'utf8', maxBuffer: 1 << 26 });
	scanText('tags', tags, problems);
	// Branch and other ref names are published with a push too.
	scanText('refs', execFileSync('git', ['for-each-ref', '--format=%(refname)'], { encoding: 'utf8' }), problems);
	checked = Number(execFileSync('git', ['rev-list', '--all', '--count'], { encoding: 'utf8' }).trim());
} else {
	if (dirArg && !existsSync(dirArg)) { console.error(`${check(dirArg, false) ? 'The folder to scan' : dirArg} does not exist, so there is nothing to scan.`); process.exit(1); }
	const files = dirArg
		? walk(dirArg, problems).map((p) => relative('.', p))
		: execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter((f) => f && existsSync(f)); // A tracked file deleted in the work tree is not going to be committed.
	for (const f of files) {
		checked++;
		// The name is published too. A name that fails is never printed: CI logs are public.
		const named = check(f, false);
		const label = named ? `file ${checked} (its name is withheld)` : f;
		if (named) problems.push(`${label}: the file name has ${named}.`);
		if (FORBIDDEN_FILES.some((re) => re.test(f))) { problems.push(`${label}: this file must never be committed.`); continue; }
		let buf;
		try { buf = readFileSync(f); } catch (e) { problems.push(`${label}: it could not be read, so it was not checked (${e.code ?? 'unknown error'}).`); continue; }
		// Binary files: check the printable runs inside them (image metadata, embedded strings).
		const text = buf.includes(0) ? (buf.toString('latin1').match(/[\x20-\x7e]{4,}/g) ?? []).join('\n') : buf.toString('utf8');
		scanText(label, text, problems, !SKIP_PATTERNS.has(f));
	}
}
if (problems.length) {
	console.error(`The leak scan found ${problems.length} problem(s):\n${problems.join('\n')}`);
	process.exit(1);
}
console.log(`The leak scan checked ${checked} ${flag('--history') ? 'commits' : 'files'} with ${deny.count} private entries and found nothing.`);
