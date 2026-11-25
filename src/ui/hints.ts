/** A key and what it does. */
export type Hint = readonly [key: string, does: string];

/** The move keys, as every list screen names them. */
export const MOVE: Hint = ['↑↓ j k', 'move'];

export const QUIT: Hint = ['q', 'quits'];

/** The keys every checklist screen names first. */
export const CHECKLIST: readonly Hint[] = [
	MOVE,
	['space', 'toggles'],
	['a', 'all'],
];

/** The leaving key of a screen another screen opened: q goes back. */
export const back = (to: string): Hint => ['q', `back to ${to}`];
