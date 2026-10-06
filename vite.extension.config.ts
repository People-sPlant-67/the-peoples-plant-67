/**
 * Build for the extension's content script: src/cockpit/extension-entry.ts and everything it
 * imports (PixiJS included) as ONE classic script, dist-extension/cockpit.js. Content scripts
 * cannot use ES module imports at runtime, hence the IIFE format (which never splits code, so
 * Pixi's dynamically imported renderer is inlined too). The render worker is bundled into the
 * same file by `?worker&inline` (see extension-entry.ts). Run through `npm run ext`, which also
 * builds the options page and the background worker and writes the manifest.
 */
import { defineConfig } from 'vite';

export default defineConfig({
	publicDir: false,
	// Library mode leaves process.env.NODE_ENV for the consumer to set; a content script has no
	// consumer, so fix it here or any dependency that reads it would throw.
	define: { 'process.env.NODE_ENV': JSON.stringify('production') },
	worker: { format: 'iife' },
	build: {
		outDir: 'dist-extension',
		emptyOutDir: false,
		target: 'es2022',
		sourcemap: false,
		lib: {
			entry: 'src/cockpit/extension-entry.ts',
			formats: ['iife'],
			name: 'Plant67',
			fileName: () => 'cockpit.js',
		},
	},
});
