/**
 * Words and shapes the bridge (Node) and the plant's page (browser) both use. No imports, so
 * either side can take it: the start and wiring commands, what the page says when its key is
 * lost, and what the bridge hands the page about wiring.
 */

/** The command that runs the plant from GitHub. */
export const NPX = 'npx github:People-sPlant-67/the-peoples-plant-67';

/** The header every request from the plant's page carries a fresh nonce in (32 hex characters)... */
export const NONCE_HEADER = 'x-plant-nonce';
/** ...the header it signs the request in (see requestSignature in proof.ts; the key never travels)... */
export const AUTH_HEADER = 'x-plant-auth';
/** ...and the header the bridge signs its answer in (see answerSignature). */
export const PROOF_HEADER = 'x-plant-proof';

/** What the bridge says to a request not signed with its current key. The page shows the same words. */
export const OLD_KEY = 'This page does not have the plant\'s current key. Open the plant from the link in the terminal where it started.';

/**
 * Most characters of messages the hook hands an agent in one turn. Claude Code keeps a hook's
 * context to 10,000 characters (more goes to a file); the words around the messages take the rest.
 */
export const CONTEXT_MAX = 8_000;

/** Longest message the owner may send: with its heading, it always fits one turn whole. */
export const OWNER_TEXT_MAX = CONTEXT_MAX - 1_000;

/** Said when the bridge stops answering a tab. The start command follows on a line of its own. */
export const STOPPED = 'The plant has stopped. Start it again with:';
/** Said under the start command: the key changes at every start, so this tab never comes back by itself. */
export const NEW_TAB = 'Starting it gives you a new link. Use that, and close this tab.';
/** Said when a tab's key is from before the plant last started. The start command follows. */
export const RELINK = 'This tab is from before the plant last started. Use the newest link the plant printed, or start the plant again with:';

/** How to start and wire this plant: exact commands, with its folder and port when they are not the default. */
export interface Wiring {
	/** Starts this plant again. */
	start: string;
	claude: string;
	codex: string;
	/** Sentences about anything wrong with the wiring, such as a hook whose Node has gone. */
	warnings: string[];
	/** The harnesses whose hooks already point at this plant and work. */
	wired: ('claude' | 'codex')[];
}

/**
 * The commands for a plant in a folder on a port.
 *
 * @param dirArg The --dir part (with a leading space), or '' for the default folder.
 * @param portArg The --port part (with a leading space), or '' for the default port.
 * @returns The commands.
 */
export function commandsFor(dirArg: string, portArg: string): Omit<Wiring, 'warnings' | 'wired'> {
	return { start: `${NPX}${portArg}${dirArg}`, claude: `${NPX} hooks claude${dirArg}`, codex: `${NPX} hooks codex${dirArg}` };
}
