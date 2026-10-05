/**
 * Write docs/ONBOARDING.md from the order in src/live/onboarding.ts. Run after changing the
 * order: `npm run onboarding`. A test fails while the two differ.
 */
import { writeFileSync } from 'node:fs';
import { onboardingDoc } from '../src/live/onboarding';

writeFileSync(new URL('../docs/ONBOARDING.md', import.meta.url), onboardingDoc());
console.log('Wrote docs/ONBOARDING.md.');
