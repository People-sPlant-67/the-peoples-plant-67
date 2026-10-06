/**
 * Build the npx bridge into dist-bridge/:
 *
 * - web/: the plant's pages (vite.bridge.config.ts), with bridge.html as index.html.
 * - cli.mjs: the npx bin (src/bridge/cli-entry.ts), Node only, no dependencies.
 * - plant-hook.mjs: the script the harness hooks run (src/bridge/hook-entry.ts), Node only.
 *
 * Usage: npm run bridge. `prepare` runs it, so `npx github:...` builds the bridge on first run.
 */
import { chmodSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { build } from 'vite';

const OUT = 'dist-bridge';
rmSync(OUT, { recursive: true, force: true });
await build({ configFile: 'vite.bridge.config.ts', logLevel: 'warn' });
renameSync(`${OUT}/web/bridge.html`, `${OUT}/web/index.html`);

/**
 * Bundle one Node script into a single ES module with nothing outside Node's own modules.
 *
 * @param entry Source file.
 * @param name Output file name.
 */
async function node(entry: string, name: string): Promise<void> {
	await build({
		configFile: false,
		publicDir: false,
		logLevel: 'warn',
		build: {
			outDir: OUT,
			emptyOutDir: false,
			target: 'node20',
			minify: false,
			ssr: entry,
			rollupOptions: {
				external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
				output: { format: 'es', entryFileNames: name, banner: '#!/usr/bin/env node' },
			},
		},
		ssr: { noExternal: true },
	});
}
await node('src/bridge/cli-entry.ts', 'cli.mjs');
await node('src/bridge/hook-entry.ts', 'plant-hook.mjs');

for (const f of ['web/index.html', 'cli.mjs', 'plant-hook.mjs']) {
	if (!existsSync(`${OUT}/${f}`)) { console.error(`The build finished without writing ${OUT}/${f}.`); process.exit(1); }
}
for (const f of ['cli.mjs', 'plant-hook.mjs']) {
	const text = readFileSync(`${OUT}/${f}`, 'utf8');
	// Nothing but Node's own modules: npx installs no dependencies for the bridge.
	const imports = [...text.matchAll(/^import\s.*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]).filter((m) => !m.startsWith('node:') && !builtinModules.includes(m));
	if (imports.length) { console.error(`${OUT}/${f} imports ${imports.join(', ')}, which npx would not install.`); process.exit(1); }
	chmodSync(`${OUT}/${f}`, 0o755);
}
console.log(`Built ${OUT}/. Try it: node ${OUT}/cli.mjs`);
