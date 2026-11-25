import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { Status } from '../atoms/Status.tsx';
import type { Tone } from '../glyphs.ts';
import { Row } from './Row.tsx';

/**
 * A row of a list of things with a state: the row's name and kind, the
 * state's glyph and label padded to `stateWidth`, then its detail, dim
 * unless `bright`, cut at the edge.
 */
export function StatusRow({
	on,
	name,
	nameWidth,
	kind,
	kindWidth,
	tone,
	state,
	stateWidth,
	bright,
	children,
}: {
	readonly on: boolean;
	readonly name: string;
	readonly nameWidth: number;
	readonly kind: string;
	readonly kindWidth: number;
	readonly tone: Tone;
	readonly state: string;
	readonly stateWidth: number;
	readonly bright: boolean;
	readonly children: ReactNode;
}): ReactNode {
	return (
		<Row
			on={on}
			name={name}
			nameWidth={nameWidth}
			kind={kind}
			kindWidth={kindWidth}
		>
			<Box flexShrink={0}>
				<Status
					tone={tone}
					label={state}
					width={stateWidth}
				/>
				<Text>{'  '}</Text>
			</Box>
			<Text
				dimColor={!bright}
				wrap='truncate-end'
			>
				{children}
			</Text>
		</Row>
	);
}
