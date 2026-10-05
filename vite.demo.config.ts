/**
 * Build the demo: cockpit.html running against the built-in mock Paperclip, as static files in
 * dist-demo/ that any web host can serve. Relative paths, so it works from a sub-folder (the
 * landing page serves it from /demo/). Run through `npm run demo`.
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
	publicDir: false,
	build: {
		outDir: 'dist-demo',
		emptyOutDir: true,
		target: 'es2022',
		rollupOptions: { input: { index: resolve(import.meta.dirname, 'cockpit.html') } },
	},
});
