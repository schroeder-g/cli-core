import { Text } from 'ink';

/** A screen's first line: what it is, bold, and what it is over, dim. */
export function Title({
	name,
	sub,
}: {
	readonly name: string;
	readonly sub?: string;
}) {
	return (
		<Text>
			<Text bold>{name}</Text>
			{sub === undefined ? null : <Text dimColor>{`  ${sub}`}</Text>}
		</Text>
	);
}
