import { Text } from 'ink';

/** `[x]` or `[ ]`. */
export function Checkbox({ checked }: { readonly checked: boolean }) {
	return <Text>{checked ? '[x]' : '[ ]'}</Text>;
}
