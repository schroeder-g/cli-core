import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { POINTER } from '../glyphs.ts';

/** The pointer or its blank, and the space after it. */
const POINTER_WIDTH = 2;

/** The gap before the kind, and the one after the row's text. */
const GAP = 2;

/**
 * The columns a row's text takes: the pointer, a prefix `prefixWidth`
 * wide and its space, the name padded to `nameWidth`, a kind padded to
 * `kindWidth` when the row has one, and the gaps between. A row with
 * `children` takes theirs beside it.
 */
export const rowWidth = ({
	nameWidth,
	kindWidth,
	prefixWidth,
}: {
	readonly nameWidth: number;
	readonly kindWidth?: number;
	readonly prefixWidth?: number;
}): number =>
	POINTER_WIDTH
	+ (prefixWidth === undefined ? 0 : prefixWidth + 1)
	+ nameWidth
	+ (kindWidth === undefined ? 0 : GAP + kindWidth)
	+ GAP;

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
