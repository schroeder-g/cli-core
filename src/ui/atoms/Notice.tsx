import { Text } from 'ink';
import type { ReactNode } from 'react';

/** A line the screen says once: a warning, or what a key just did. */
export function Notice({
	text,
	tone = 'warning',
}: {
	readonly text: string | undefined;
	readonly tone?: 'warning' | 'info';
}): ReactNode {
	if (text === undefined || text === '') return null;
	return (
		<Text color={tone === 'warning' ? 'yellow' : 'cyan'}>{text}</Text>
	);
}
