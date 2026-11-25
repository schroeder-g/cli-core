import type { Key } from 'ink';
import { useState } from 'react';

export interface Help {
	/** Whether the list of every key shows in place of the hints. */
	readonly open: boolean;
	/**
	 * Takes a key the help answers: ? opens or closes it, and q or Escape
	 * close it before they reach the screen. True when it took the key.
	 */
	readonly answer: (input: string, key: Key) => boolean;
}

/** The ? list of every key a screen offers. */
export function useHelp(): Help {
	const [open, setOpen] = useState(false);
	return {
		open,
		answer: (input, key) => {
			if (input === '?') {
				setOpen(shown => !shown);
				return true;
			}
			if (open && (key.escape || input === 'q')) {
				setOpen(false);
				return true;
			}
			return false;
		},
	};
}
