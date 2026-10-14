/** Keep documented scenario links local and discard unrelated query data. */
export function scenarioDestination(href: string): string | null {
	const url = new URL(href);
	const scenario = url.searchParams.get('scenario');
	if (!scenario || !['tribunal', 'hire', 'away', 'purge', 'dossier', 'personnel', 'pravda'].includes(scenario)) return null;
	const destination = new URL('./demo/', url);
	destination.searchParams.set('scenario', scenario);
	return destination.href;
}
