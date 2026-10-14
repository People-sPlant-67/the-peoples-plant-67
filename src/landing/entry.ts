import { scenarioDestination } from './routes';

const destination = scenarioDestination(location.href);
if (destination) location.replace(destination);
else void import('./hero');
