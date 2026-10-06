/**
 * The extension's background worker: the listeners in worker.ts, on the real Chrome.
 */
import { workerChrome } from './chrome';
import { wireWorker } from './worker';

wireWorker(workerChrome());
