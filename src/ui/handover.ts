import { createContext } from 'react';

/**
 * The screen that handed the terminal over, which q goes back to; none
 * for a screen a command opened first.
 */
export const HandOver = createContext<string | undefined>(undefined);
