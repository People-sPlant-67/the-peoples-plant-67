/**
 * Entry for dist-bridge/cli.mjs (the npx bin). Exits with the command's code; a running
 * bridge (-1) keeps the process alive until Ctrl+C.
 */
import { main } from './cli';

main(process.argv.slice(2)).then((code) => { if (code >= 0) process.exit(code); }, (err) => {
	console.error(`The plant failed: ${(err as Error).message}`);
	process.exit(1);
});
