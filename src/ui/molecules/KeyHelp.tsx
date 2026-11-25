import { Text } from 'ink';
import type { ReactNode } from 'react';

import { widthOf } from '../../core/text.ts';
import { Pane } from '../atoms/Pane.tsx';
import type { Hint } from '../hints.ts';
import { Labeled } from './Labeled.tsx';

/** Every key of a screen and what it does, one to a line, in a pane. */
export function KeyHelp({
	keys,
}: {
	readonly keys: readonly Hint[];
}): ReactNode {
	const width = widthOf(keys, ([key]) => key);
	return (
		<Pane>
			<Text dimColor>keys · ? or q closes</Text>
			{keys.map(([key, does]) => (
				<Labeled
					key={key}
					label={<Text bold>{key}</Text>}
					width={width + 2}
				>
					<Text>{does}</Text>
				</Labeled>
			))}
		</Pane>
	);
}
