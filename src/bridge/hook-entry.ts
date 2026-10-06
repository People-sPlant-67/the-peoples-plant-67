/**
 * Entry for dist-bridge/plant-hook.mjs, the script the harness hooks run. See hook.ts.
 * Whatever happens, the agent is never kept waiting on the plant: exit 0 within 4 seconds.
 */
import { main } from './hook';

setTimeout(() => process.exit(0), 4_000).unref();
void main(process.argv.slice(2)).then(() => process.exit(0));
