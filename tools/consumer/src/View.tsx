import { Title } from '@four7/cli-core/ui';
import { Text, useInput } from 'ink';

export function View({ onDone }: { readonly onDone: () => void }) {
	useInput(() => onDone());
	return (
		<>
			<Title
				name='nt'
				sub='notes'
			/>
			<Text>press any key</Text>
		</>
	);
}
