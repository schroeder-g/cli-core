import { useContext } from 'react';

import { HandOver } from '../handover.ts';
import { back, QUIT } from '../hints.ts';
import type { Hint } from '../hints.ts';

/**
 * What q does on this screen: goes back to the screen that handed the
 * terminal over, else `own`.
 */
export function useLeave(own: Hint = QUIT): Hint {
	const from = useContext(HandOver);
	return from === undefined ? own : back(from);
}
