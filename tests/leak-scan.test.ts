/**
 * The leak scan, run as a real process against throwaway folders and a made-up deny list. The
 * real deny list never reaches a test. Strings the scan's generic checks would catch (emails,
 * tokens, home paths) are built at run time, so this file passes the scan itself.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const SCRIPT = resolve('scripts/leak-scan.mjs');
/** A long word, a short word, a phrase and a pattern, none of them real. */
const DENY = ['zarkovia', 'qex', 'Brill Hollow', 're:widget-\\d{3}', '# a comment line'].join('\n');

type Files = Record<string, string | Buffer>;

/**
 * Write files into a fresh folder and scan it.
 *
 * @param {Files} files Path to contents.
 * @param {object} opts Scan options.
 * @param {string[]} [opts.args] Arguments; defaults to scanning the whole folder.
 * @param {string | null} [opts.deny] The deny list, or null for none.
 * @param {(dir: string) => void} [opts.setup] Runs after the files are written.
 * @returns {{ code: number | null, out: string }} Exit code and everything printed.
 */
function scan(files: Files, opts: { args?: string[]; deny?: string | null; setup?: (dir: string) => void } = {}): { code: number | null; out: string } {
	const dir = mkdtempSync(join(tmpdir(), 'leak-scan-'));
	try {
		for (const [name, body] of Object.entries(files)) {
			mkdirSync(join(dir, dirname(name)), { recursive: true });
			writeFileSync(join(dir, name), body);
		}
		opts.setup?.(dir);
		const env = { ...process.env, LEAK_DENY: opts.deny === undefined ? DENY : (opts.deny ?? '') };
		const r = spawnSync(process.execPath, [SCRIPT, ...(opts.args ?? ['--dir', '.'])], { cwd: dir, env, encoding: 'utf8' });
		return { code: r.status, out: r.stdout + r.stderr };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Run git in a folder, as a throwaway identity.
 *
 * @param {string} dir Repo folder.
 * @param {string[]} args Git arguments.
 */
function git(dir: string, args: string[]): void {
	const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
}

test('a clean folder passes', () => {
	const r = scan({ 'a.txt': 'Comrades of the plant, assemble.\n', 'b/c.md': '# Five-year plan\n' });
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /checked 2 files with 4 private entries/);
});

test('a long deny word is caught in every disguise', () => {
	const disguises = {
		plain: 'see zarkovia here',
		upper: 'ZARKOVIA',
		camel: 'const myZarkoviaHost = 1;',
		snake: 'zar_kovia_host',
		hyphen: 'zar-kovia',
		glued: 'thezarkoviaplant',
		plural: 'zarkovias',
		url: 'https://zarkovia.example.com/path',
		accent: 'Zärkövia',
		zeroWidth: 'zar\u200bko\u2060via',
		bom: 'zark\ufeffovia',
	};
	for (const [how, line] of Object.entries(disguises)) {
		const r = scan({ 'f.txt': `fine\n${line}\n` });
		assert.equal(r.code, 1, `${how}: ${r.out}`);
		assert.match(r.out, /f\.txt:2: a word from the private deny list/, how);
	}
});

test('a short deny word matches whole words only', () => {
	for (const line of ['qex', 'the QEX file', 'theQexThing', 'qexs', 'q\u200bex', 'qéx']) {
		assert.equal(scan({ 'f.txt': line }).code, 1, line);
	}
	// Inside a longer word it is someone else's word.
	for (const line of ['qexit', 'complexqexing', 'aqex']) {
		assert.equal(scan({ 'f.txt': line }).code, 0, line);
	}
});

test('a phrase is caught however it is joined', () => {
	for (const line of ['Brill Hollow', 'brillhollow', 'Brill-Hollow', 'BRILL_HOLLOW', 'brill.hollow.com']) {
		const r = scan({ 'f.txt': line });
		assert.equal(r.code, 1, line);
	}
});

test('a re: line is a pattern', () => {
	assert.equal(scan({ 'f.txt': 'part widget-123 here' }).code, 1);
	assert.match(scan({ 'f.txt': 'widget-123' }).out, /a pattern from the private deny list/);
	assert.equal(scan({ 'f.txt': 'widget-12' }).code, 0);
});

test('the generic checks catch emails, tokens and home paths', () => {
	const at = '@';
	const cases = {
		email: [`pat${at}mail.co.uk`, /an email address/],
		github: [`ghp_${'a'.repeat(30)}`, /shaped like an API token/],
		openai: [`sk-${'b'.repeat(24)}`, /shaped like an API token/],
		slack: [`xoxb-${'1'.repeat(12)}`, /shaped like an API token/],
		aws: [`AKIA${'C'.repeat(16)}`, /shaped like an API token/],
		mac: [`/Us${'ers'}/someone/x`, /a home-folder path/],
		linux: [`/ho${'me'}/someone/x`, /a home-folder path/],
		windows: [`C:\\Us${'ers'}\\someone\\x`, /a home-folder path/],
	} as const;
	for (const [how, [line, why]] of Object.entries(cases)) {
		const r = scan({ 'f.txt': line });
		assert.equal(r.code, 1, how);
		assert.match(r.out, why, how);
	}
});

test('emails at reserved and noreply domains are allowed', () => {
	const at = '@';
	for (const line of [`a${at}example.com`, `a${at}example.org`, `chief${at}peoples-plant.invalid`, `1+x${at}users.noreply.github.com`, `noreply${at}anthropic.com`]) {
		assert.equal(scan({ 'f.txt': line }).code, 0, line);
	}
});

test('the lockfile skips the generic checks but not the deny list', () => {
	const at = '@';
	assert.equal(scan({ 'package-lock.json': `"x": "pat${at}mail.co"` }).code, 0);
	assert.equal(scan({ 'package-lock.json': '"resolved": "https://zarkovia.example/x.tgz"' }).code, 1);
});

test('files that must never be committed fail by name alone', () => {
	for (const name of ['config.local.json', 'sub/config.local.json', 'docs/private/notes.md', '.env', '.env.production', 'key.pem', '.leak-deny']) {
		const r = scan({ [name]: 'harmless' });
		assert.equal(r.code, 1, name);
		assert.match(r.out, /must never be committed/, name);
	}
	assert.equal(scan({ '.env.example': 'A=1' }).code, 0);
});

test('a deny word in a file name is caught', () => {
	const r = scan({ 'art/zarkovia-logo.txt': 'harmless' });
	assert.equal(r.code, 1);
	assert.match(r.out, /the file name has a word from the private deny list/);
});

test('printable text inside a binary file is checked', () => {
	const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), Buffer.from('tEXtAuthor zarkovia'), Buffer.from([0, 1, 2])]);
	assert.equal(scan({ 'pic.png': png }).code, 1);
	assert.equal(scan({ 'pic.png': Buffer.from([0x89, 0x50, 0, 1, 2, 3]) }).code, 0);
});

test('the deny list also comes from the .leak-deny file, comments ignored', () => {
	const setup = (dir: string): void => {
		writeFileSync(join(dir, '.leak-deny'), '# comment\nbrightwater\n');
	};
	const clean = scan({ 'src/f.txt': 'fine\n' }, { deny: null, args: ['--dir', 'src'], setup });
	assert.equal(clean.code, 0, clean.out);
	assert.match(clean.out, /with 1 private entries/, 'the comment line is not an entry');
	const caught = scan({ 'src/f.txt': 'brightwater\n' }, { deny: null, args: ['--dir', 'src'], setup });
	assert.equal(caught.code, 1, caught.out);
});

test('a finding names the file and line, never the word it matched', () => {
	const r = scan({ 'f.txt': 'zarkovia and Brill Hollow and widget-123 and qex' }, { args: ['--dir', '.'] });
	assert.equal(r.code, 1);
	assert.match(r.out, /found 1 problem\(s\)/);
	for (const secret of ['zarkovia', 'brill', 'hollow', 'widget', 'qex']) assert.ok(!r.out.toLowerCase().includes(secret), `the output must not echo "${secret}"`);
});

test('with no deny list it warns, and --require-deny makes that a failure', () => {
	const warn = scan({ 'f.txt': 'fine' }, { deny: null });
	assert.equal(warn.code, 0);
	assert.match(warn.out, /No private deny list was found/);
	const strict = scan({ 'f.txt': 'fine' }, { deny: null, args: ['--dir', '.', '--require-deny'] });
	assert.equal(strict.code, 1);
});

test('a missing --dir folder fails rather than passing empty', () => {
	const r = scan({}, { args: ['--dir', 'nope'] });
	assert.equal(r.code, 1);
	assert.match(r.out, /does not exist/);
});

test('the default scan reads what git would commit, ignored files left out', () => {
	const r = scan({ '.gitignore': 'secret.txt\n', 'secret.txt': 'zarkovia', 'ok.txt': 'fine' }, { args: [], setup: (dir) => git(dir, ['init', '-q']) });
	assert.equal(r.code, 0, r.out);
	const r2 = scan({ 'new.txt': 'zarkovia' }, { args: [], setup: (dir) => git(dir, ['init', '-q']) });
	assert.equal(r2.code, 1, 'an untracked, unignored file would be committed, so it is scanned');
});

test('--history passes a clean history', () => {
	const r = scan({ 'f.txt': 'fine\n' }, {
		args: ['--history'],
		setup: (dir) => {
			git(dir, ['init', '-q']);
			git(dir, ['add', '.']);
			git(dir, ['commit', '-qm', 'first']);
		},
	});
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /checked 1 commits/);
});

test('--history finds a word that was added and later removed', () => {
	const r = scan({ 'f.txt': 'zarkovia\n' }, {
		args: ['--history'],
		setup: (dir) => {
			git(dir, ['init', '-q']);
			git(dir, ['add', '.']);
			git(dir, ['commit', '-qm', 'first']);
			writeFileSync(join(dir, 'f.txt'), 'fine\n');
			git(dir, ['commit', '-qam', 'cleaned']);
		},
	});
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /history:\d+: a word from the private deny list/);
});

test('--history reads the committer and the tags, not just the author', () => {
	const committer = scan({ 'f.txt': 'fine\n' }, {
		args: ['--history'],
		setup: (dir) => {
			git(dir, ['init', '-q']);
			git(dir, ['add', '.']);
			const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'first'], {
				cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_NAME: 'Zarkovia Smith' },
			});
			assert.equal(r.status, 0, r.stderr);
		},
	});
	assert.equal(committer.code, 1, 'committer name');
	const tagger = scan({ 'f.txt': 'fine\n' }, {
		args: ['--history'],
		setup: (dir) => {
			git(dir, ['init', '-q']);
			git(dir, ['add', '.']);
			git(dir, ['commit', '-qm', 'first']);
			git(dir, ['-c', 'tag.gpgsign=false', 'tag', '-a', 'v1.0.0', '-m', 'release from Brill Hollow']);
		},
	});
	assert.equal(tagger.code, 1, 'tag message');
	assert.match(tagger.out, /tags:\d+:/);
});

test('--history reads commit messages and other branches', () => {
	const r = scan({ 'f.txt': 'fine\n' }, {
		args: ['--history'],
		setup: (dir) => {
			git(dir, ['init', '-q']);
			git(dir, ['add', '.']);
			git(dir, ['commit', '-qm', 'fix for Brill Hollow']);
		},
	});
	assert.equal(r.code, 1, 'commit message');
	const r2 = scan({ 'f.txt': 'fine\n' }, {
		args: ['--history'],
		setup: (dir) => {
			git(dir, ['init', '-q']);
			git(dir, ['add', '.']);
			git(dir, ['commit', '-qm', 'first']);
			git(dir, ['checkout', '-qb', 'side']);
			writeFileSync(join(dir, 'g.txt'), 'qex\n');
			git(dir, ['add', '.']);
			git(dir, ['commit', '-qm', 'side work']);
			git(dir, ['checkout', '-q', '-']);
		},
	});
	assert.equal(r2.code, 1, 'other branch');
});
