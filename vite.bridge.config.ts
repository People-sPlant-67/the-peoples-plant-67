/**
 * Build the plant's pages for the npx bridge: bridge.html (src/cockpit/bridge-entry.ts) as
 * static files in dist-bridge/web/, which src/bridge/server.ts serves. Run through
 * `npm run bridge` (scripts/build-bridge.ts), which also builds the CLI and the hook script.
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
	publicDir: false,
	build: {
		outDir: 'dist-bridge/web',
		emptyOutDir: true,
		target: 'es2022',
		rollupOptions: { input: { index: resolve(import.meta.dirname, 'bridge.html') } },
	},
});
