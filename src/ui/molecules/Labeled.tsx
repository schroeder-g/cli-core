import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

/**
 * A label in a column `width` wide, what it labels beside it, one to a
 * line. A `dim` label must be text.
 */
export function Labeled({
	label,
	width,
	dim = false,
	children,
}: {
	readonly label: ReactNode;
	readonly width: number;
	readonly dim?: boolean;
	readonly children: ReactNode;
}) {
	return (
		<Box>
			<Box
				width={width}
				flexShrink={0}
			>
				{dim ? <Text dimColor>{label}</Text> : label}
			</Box>
			<Box
				flexDirection='column'
				flexGrow={1}
			>
				{children}
			</Box>
		</Box>
	);
}
