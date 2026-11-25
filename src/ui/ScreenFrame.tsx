import { useInput } from 'ink';
import type { ReactNode } from 'react';

import { HandOver } from './handover.ts';

/**
 * What every screen is drawn inside: Ctrl-C interrupts it, whatever the
 * view, and the views below read which screen handed the terminal over.
 */
export function ScreenFrame({
	from,
	onInterrupt,
	children,
}: {
	readonly from: string | undefined;
	readonly onInterrupt: () => void;
	readonly children: ReactNode;
}): ReactNode {
	useInput((input, key) => {
		if (isInterrupt(input, key)) onInterrupt();
	});
	return <HandOver value={from}>{children}</HandOver>;
}

/** Ctrl-C, which the frame takes and every view leaves alone. */
export const isInterrupt = (
	input: string,
	key: { readonly ctrl: boolean },
): boolean => key.ctrl && input === 'c';
