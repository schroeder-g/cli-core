import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { POINTER } from '../glyphs.ts';

/**
 * One row of a list: the pointer when selected, an optional prefix such
 * as a checkbox, the name padded to its column, a dim kind padded to
 * its column, then whatever follows. Selected rows read bold and cyan.
 */
export function Row({
	on,
	prefix,
	name,
	nameWidth,
	kind,
	kindWidth = 0,
	children,
}: {
	readonly on: boolean;
	readonly prefix?: ReactNode;
	readonly name: string;
	readonly nameWidth: number;
	readonly kind?: string;
	readonly kindWidth?: number;
	readonly children?: ReactNode;
}) {
	return (
		<Box>
			<Box flexShrink={0}>
				<Text
					bold={on}
					color={on ? 'cyan' : undefined}
				>
					{on ? POINTER : ' '} {prefix}
					{prefix === undefined ? '' : ' '}
					{name.padEnd(nameWidth)}
					{kind === undefined ? (
						''
					) : (
						<Text dimColor={!on}>{`  ${kind.padEnd(kindWidth)}`}</Text>
					)}
					{'  '}
				</Text>
			</Box>
			{children}
		</Box>
	);
}
