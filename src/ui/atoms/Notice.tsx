import { Text } from 'ink';

/** A line the screen says once: a warning, or what a key just did. */
export function Notice({
	text,
	tone = 'warning',
}: {
	readonly text: string | undefined;
	readonly tone?: 'warning' | 'info';
}) {
	if (text === undefined || text === '') return null;
	return (
		<Text color={tone === 'warning' ? 'yellow' : 'cyan'}>{text}</Text>
	);
}
