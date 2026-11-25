import { Box } from 'ink';
import type { ReactNode } from 'react';

/** The columns a pane's frame and padding take from its content. */
export const PANE_FRAME = 4;

/** A rounded, dim frame around `children`, one column of padding inside. */
export function Pane({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<Box
			flexDirection='column'
			borderStyle='round'
			borderDimColor
			paddingX={1}
		>
			{children}
		</Box>
	);
}
