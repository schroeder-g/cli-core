import { chunk } from 'es-toolkit/array';
import { Text } from 'ink';

import { widthOf } from '../../core/text.ts';

/**
 * Names in as many columns as `width` holds, read across, `gap` columns
 * apart; `none` when there are none.
 */
export function Columns({
	names,
	width,
	gap = 2,
	none = '—',
}: {
	readonly names: readonly string[];
	readonly width: number;
	readonly gap?: number;
	readonly none?: string;
}) {
	if (names.length === 0) return <Text>{none}</Text>;
	const cell = widthOf(names, name => name) + gap;
	const across = Math.max(1, Math.floor((width + gap) / cell));
	return (
		<>
			{chunk(names, across).map(row => (
				<Text key={row.join()}>
					{row
						.map((name, at) =>
							at === row.length - 1 ? name : name.padEnd(cell),
						)
						.join('')}
				</Text>
			))}
		</>
	);
}
