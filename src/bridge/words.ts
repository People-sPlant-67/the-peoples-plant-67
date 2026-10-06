/**
 * Words and shapes the bridge (Node) and the plant's page (browser) both use. No imports, so
 * either side can take it: the start and wiring commands, what the page says when its key is
 * lost, and what the bridge hands the page about wiring.
 */

/** The command that runs the plant from GitHub. */
export const NPX = 'npx github:People-sPlant-67/the-peoples-plant-67';

/** The header every /api/ request carries the plant's key in. */
export const KEY_HEADER = 'x-plant-key';

/** Said when the page has no key, or one the bridge no longer takes. */
export const RELINK = 'This page has lost its key to the plant. Open the plant again from the link in the terminal where you started it.';

/** How to start and wire this plant: exact commands, with its folder and port when they are not the default. */
export interface Wiring {
	/** Starts this plant again. */
	start: string;
	claude: string;
	codex: string;
	/** Sentences about anything wrong with the wiring, such as a hook whose Node has gone. */
	warnings: string[];
}

/**
 * The commands for a plant in a folder on a port.
 *
 * @param dirArg The --dir part (with a leading space), or '' for the default folder.
 * @param portArg The --port part (with a leading space), or '' for the default port.
 * @returns Wiring without warnings.
 */
export function commandsFor(dirArg: string, portArg: string): Omit<Wiring, 'warnings'> {
	return { start: `${NPX}${portArg}${dirArg}`, claude: `${NPX} hooks claude${dirArg}`, codex: `${NPX} hooks codex${dirArg}` };
}
