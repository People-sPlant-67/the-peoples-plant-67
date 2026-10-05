/**
 * Assemble the unpacked Chrome extension in dist-extension/: bundle the cockpit content script
 * with vite.extension.config.ts and write the manifest with the
 * Paperclip host from config.local.json. The host lives only in that gitignored file, so the
 * repo never names the instance. Usage: npm run ext
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { build } from 'vite';

const CONFIG = 'config.local.json';
const OUT = 'dist-extension';

if (!existsSync(CONFIG)) {
	console.error(`${CONFIG} is missing. Copy config.local.example.json to ${CONFIG} and set "host" to your Paperclip hostname.`);
	process.exit(1);
}
const { host } = JSON.parse(readFileSync(CONFIG, 'utf8')) as { host?: string };
// A bare hostname only: anything else would end up inside the extension's match patterns.
if (!host || !/^[a-z0-9.-]+$/i.test(host)) {
	console.error(`"host" in ${CONFIG} must be a bare hostname such as paperclip.example.com, with no scheme or path.`);
	process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
await build({ configFile: 'vite.extension.config.ts', logLevel: 'warn' });
const bundle = `${OUT}/cockpit.js`;
if (!existsSync(bundle)) {
	console.error(`The build finished without writing ${bundle}, so the extension would load nothing. Check the Vite output above.`);
	process.exit(1);
}
// A content script is a classic script: a stray ES import would fail to parse in Chrome.
if (/^\s*import[\s{*]|^\s*export\s/m.test(readFileSync(bundle, 'utf8'))) {
	console.error(`${bundle} still contains ES module syntax, so Chrome could not run it as a content script.`);
	process.exit(1);
}
writeFileSync(`${OUT}/manifest.json`, readFileSync('extension/manifest.template.json', 'utf8').replaceAll('__HOST__', host));
const kb = Math.round(statSync(bundle).size / 1024);
console.log(`Built ${OUT}/ for ${host} (cockpit.js is ${kb} KB). Load it in Chrome: chrome://extensions, Developer mode, Load unpacked. The cockpit is at https://${host}/api/plant-67`);
