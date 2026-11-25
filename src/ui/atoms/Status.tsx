import { Text } from 'ink';

import { LOOKS } from '../glyphs.ts';
import type { Tone } from '../glyphs.ts';

/** A state's glyph and its name, coloured by tone, padded to `width`. */
export function Status({
	tone,
	label,
	width = 0,
}: {
	readonly tone: Tone;
	readonly label: string;
	readonly width?: number;
}) {
	const { glyph, color } = LOOKS[tone];
	return <Text color={color}>{`${glyph} ${label.padEnd(width)}`}</Text>;
}
