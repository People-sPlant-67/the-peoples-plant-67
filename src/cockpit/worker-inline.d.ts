/**
 * Vite's `?worker&inline` import: a constructor for a worker whose code is bundled into the
 * importing file and started from a Blob URL. Declared here rather than pulling in all of
 * vite/client's ambient types.
 */
declare module '*?worker&inline' {
	const WorkerConstructor: { new (options?: { name?: string }): Worker };
	export default WorkerConstructor;
}
