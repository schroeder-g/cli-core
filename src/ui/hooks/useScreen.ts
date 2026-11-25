import { useInput } from 'ink';
import type { Key } from 'ink';
import { useState } from 'react';

import { isInterrupt } from '../ScreenFrame.tsx';
import type { Help } from './useHelp.ts';

export interface ScreenKeys {
	/** q or Escape. */
	readonly onQuit: () => void;
	/** Every other key, after the cursor has taken ↑↓ and j k. */
	readonly onKey?: (input: string, key: Key) => void;
	/** The screen's ? list, which answers its keys first. */
	readonly help?: Help;
}

export interface Screen {
	/** The row the cursor is on. */
	readonly index: number;
	/** Puts the cursor on a row, as a click does. */
	readonly select: (at: number) => void;
}

/**
 * What every list screen does with the keyboard: q or Escape quits, ↑↓
 * or j k move a cursor over `length` rows, and the rest reaches
 * `onKey`. The cursor stays within the rows as they come and go,
 * starting at `initial`.
 */
export function useScreen(
	length: number,
	{ onQuit, onKey, help }: ScreenKeys,
	initial = 0,
): Screen {
	const [index, setIndex] = useState(initial);
	useInput((input, key) => {
		if (isInterrupt(input, key) || help?.answer(input, key)) return;
		if (key.escape || input === 'q') onQuit();
		else if (key.upArrow || input === 'k')
			setIndex(at => Math.max(0, at - 1));
		else if (key.downArrow || input === 'j')
			setIndex(at => Math.min(Math.max(0, length - 1), at + 1));
		else onKey?.(input, key);
	});
	return {
		index: Math.min(index, Math.max(0, length - 1)),
		select: at =>
			setIndex(Math.min(Math.max(0, at), Math.max(0, length - 1))),
	};
}
