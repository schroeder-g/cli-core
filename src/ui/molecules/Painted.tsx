import { Text } from 'ink';

import type { Segment } from '../paint.ts';

/** One line of painted text, each segment in its style. */
export function Painted({
	segments,
	wrap = 'truncate-end',
}: {
	readonly segments: readonly Segment[];
	readonly wrap?: 'wrap' | 'truncate-end';
}) {
	return (
		<Text wrap={wrap}>
			{segments.map(({ text, style }, at) => (
				<Text
					key={at}
					{...style}
				>
					{text}
				</Text>
			))}
		</Text>
	);
}
