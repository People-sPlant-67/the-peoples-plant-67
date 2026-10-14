import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Build the landing page and its isolated tour. Demo stays independently buildable for the other hosts. */
export default defineConfig({
	base: './', publicDir: false,
	build: { outDir: 'dist-site', emptyOutDir: true, target: 'es2022',
		rollupOptions: { input: { index: resolve(import.meta.dirname, 'hero.html'), tour: resolve(import.meta.dirname, 'tour.html') } },
	},
});
