import { Box } from 'ink';
import type { ReactNode } from 'react';

/** A label in a column `width` wide, what it labels beside it. */
export function Labeled({
	label,
	width,
	children,
}: {
	readonly label: ReactNode;
	readonly width: number;
	readonly children: ReactNode;
}) {
	return (
		<Box>
			<Box
				width={width}
				flexShrink={0}
			>
				{label}
			</Box>
			{children}
		</Box>
	);
}
