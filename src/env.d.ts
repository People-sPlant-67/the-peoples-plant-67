/**
 * The one piece of Vite's import.meta.env the plant reads: true under `npm run dev`, false in a
 * build. Declared here rather than pulling in all of vite/client's ambient types.
 */
interface ImportMeta {
	readonly env: { readonly DEV: boolean };
}
