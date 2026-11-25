import { createContext } from 'react';
import type { Context } from 'react';

/**
 * The screen that handed the terminal over, which q goes back to; none
 * for a screen a command opened first.
 */
export const HandOver: Context<string | undefined> = createContext<
	string | undefined
>(undefined);
