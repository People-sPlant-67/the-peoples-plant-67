/**
 * Assemble the unpacked Chrome extension in dist-extension/. One build works for any Paperclip:
 * the address is chosen on the options page after install, so nothing here names a host.
 *
 * - cockpit.js: the content script (vite.extension.config.ts), registered at run time on
 *   <origin>/api/plant-67 by the options page.
 * - options.html, options.css, options.js: Form 67-C, where the address is typed.
 * - background.js: the worker that keeps the registration in step and runs the toolbar star.
 * - icon-*.png: drawn from src/extension/icon.ts.
 * - manifest.json: from extension/manifest.template.json, versioned from package.json.
 *
 * Usage: npm run ext
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { build } from 'vite';
import { ICON_SIZES, starPixels } from '../src/extension/icon';
import { encodePngRgba } from './png';

const OUT = 'dist-extension';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: string };
// Chrome accepts one to four dot-separated numbers; package.json uses three.
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	console.error(`package.json "version" must be three numbers such as 0.1.0 for Chrome to accept it (it is ${JSON.stringify(version)}).`);
	process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
await build({ configFile: 'vite.extension.config.ts', logLevel: 'warn' });

/**
 * Bundle one extension page script as a single classic script.
 *
 * @param {string} entry Source file.
 * @param {string} name Output file name.
 */
async function bundle(entry: string, name: string): Promise<void> {
	await build({
		configFile: false,
		publicDir: false,
		logLevel: 'warn',
		define: { 'process.env.NODE_ENV': JSON.stringify('production') },
		build: { outDir: OUT, emptyOutDir: false, target: 'es2022', sourcemap: false, lib: { entry, formats: ['iife'], name: 'Plant67Ext', fileName: () => name } },
	});
}
await bundle('src/extension/options-entry.ts', 'options.js');
await bundle('src/extension/background.ts', 'background.js');

for (const name of ['cockpit.js', 'options.js', 'background.js']) {
	const file = `${OUT}/${name}`;
	if (!existsSync(file)) {
		console.error(`The build finished without writing ${file}, so the extension would be broken. Check the Vite output above.`);
		process.exit(1);
	}
	// All three load as classic scripts: a stray ES import would fail to parse in Chrome.
	if (/^\s*import[\s{*]|^\s*export\s/m.test(readFileSync(file, 'utf8'))) {
		console.error(`${file} still contains ES module syntax, so Chrome could not run it.`);
		process.exit(1);
	}
}
for (const name of ['options.html', 'options.css']) copyFileSync(`extension/${name}`, `${OUT}/${name}`);
for (const size of ICON_SIZES) writeFileSync(`${OUT}/icon-${size}.png`, encodePngRgba(size, size, starPixels(size)));
writeFileSync(`${OUT}/manifest.json`, readFileSync('extension/manifest.template.json', 'utf8').replaceAll('__VERSION__', version));

const kb = Math.round(statSync(`${OUT}/cockpit.js`).size / 1024);
console.log(`Built ${OUT}/ v${version} (cockpit.js is ${kb} KB). Load it in Chrome: chrome://extensions, Developer mode, Load unpacked, then type your Paperclip address on the page that opens.`);
