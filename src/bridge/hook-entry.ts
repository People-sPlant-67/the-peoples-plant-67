/**
 * Entry for dist-bridge/plant-hook.mjs, the script the harness hooks run. See hook.ts.
 * Whatever happens, the agent is never kept waiting on the plant: exit 0 within 4 seconds.
 * The context is written in full before exiting: on macOS a pipe write is asynchronous, and
 * exiting straight after it would cut the context off at 64 KB.
 */
import { main } from './hook';

setTimeout(() => process.exit(0), 4_000).unref();
void main(process.argv.slice(2)).then((out) => {
	if (!out) process.exit(0);
	process.stdout.write(out, () => process.exit(0));
});
