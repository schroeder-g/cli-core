import { Text } from 'ink';
import type { ReactNode } from 'react';

/** `[x]` or `[ ]`. */
export function Checkbox({
	checked,
}: {
	readonly checked: boolean;
}): ReactNode {
	return <Text>{checked ? '[x]' : '[ ]'}</Text>;
}
