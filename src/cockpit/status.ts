/**
 * Words and colours for a comrade's state, shared by the roster, name card and minimap.
 * Pure, so the tests can check every status has a full sentence.
 */
import type { Activity } from '../live/placement';
import type { AgentState, AgentStatus } from '../live/types';
import type { Host } from './host';

/** Chip and dot colours per Paperclip status. Unknown statuses get their own colour so they stand out. */
const STATUS_COLOUR: Record<string, string> = {
	running: '#6fbf5a',
	idle: '#c9b27a',
	paused: '#6f9fd8',
	error: '#e0503f',
	pending_approval: '#e8d9a8',
	waiting: '#e6b92e',
	terminated: '#5a5650',
};
const UNKNOWN_COLOUR = '#b07fd0';

/** Minimap dot colours per activity. */
export const ACTIVITY_COLOUR: Record<Activity, string> = {
	working: '#6fbf5a',
	idle: '#e8d9a8',
	shivering: '#8fd0ff',
};

/**
 * Colour for a status.
 *
 * @param status Paperclip status.
 * @returns CSS colour.
 */
export function statusColour(status: AgentStatus): string {
	return STATUS_COLOUR[status] ?? UNKNOWN_COLOUR;
}

/**
 * The status as a sentence for the name card. An unrecognised status is quoted as it came,
 * so a new one Paperclip adds shows up instead of being disguised as a known one.
 *
 * @param status Paperclip status.
 * @param reason What a waiting comrade waits for, said in its place when given.
 * @param board The host has a board that clears errors (Paperclip). On the bridge, the next prompt does.
 * @returns Complete sentence.
 */
export function statusWords(status: AgentStatus, reason?: string | null, board = true): string {
	switch (status) {
		case 'running': return 'Working on a task right now.';
		case 'idle': return 'Idle, waiting for the next task.';
		case 'paused': return 'Paused, and sent to Siberia until someone resumes them.';
		case 'error': return board ? 'Stopped with an error, and sent to Siberia until a board member clears it.' : 'Stopped with an error, and sent to Siberia. It clears the next time you send them a prompt in their terminal.';
		case 'pending_approval': return 'Waiting at the Recruitment Office for the board to approve the hire.';
		case 'waiting': return `Waiting for you in the terminal. ${reason ? `${reason.trim().replace(/[.!?]?$/, '.')}` : 'The agent wants your OK before it goes on.'}`;
		case 'terminated': return 'Terminated, and airbrushed from the record.';
		default: return `Paperclip reports a status the plant does not know yet: "${status}".`;
	}
}

/**
 * A comrade's status as the name card and the roster say it, for the host the plant draws from.
 *
 * @param a The comrade.
 * @param host What the host can do.
 * @returns Complete sentence.
 */
export function comradeWords(a: Pick<AgentState, 'status' | 'pauseReason'>, host: Pick<Host, 'board'>): string {
	return statusWords(a.status, a.status === 'waiting' ? a.pauseReason : null, host.board);
}
