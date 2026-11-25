import { Text } from 'ink';
import type { ReactNode } from 'react';

import { SEPARATOR } from '../glyphs.ts';
import type { Hint } from '../hints.ts';

/** A screen's last line: each key and what it does, dim. */
export function Hints({
	hints,
}: {
	readonly hints: readonly Hint[];
}): ReactNode {
	return (
		<Text dimColor>
			{hints.map(([key, does]) => `${key} ${does}`).join(SEPARATOR)}
		</Text>
	);
}
