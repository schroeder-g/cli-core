import { Text } from 'ink';
import type { ReactNode } from 'react';

/** A screen's first line: what it is, bold, and what it is over, dim. */
export function Title({
	name,
	sub,
}: {
	readonly name: string;
	readonly sub?: string;
}): ReactNode {
	return (
		<Text>
			<Text bold>{name}</Text>
			{sub === undefined ? null : <Text dimColor>{`  ${sub}`}</Text>}
		</Text>
	);
}
