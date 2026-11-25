import { Text, Transform } from 'ink';

import { hyperlink } from '../hyperlink.ts';

/**
 * A link the terminal opens from its label, as a page does, bold and
 * cyan the way a link reads. The hyperlink is always written: a
 * terminal without OSC 8 shows the label alone, and detection would
 * wrongly deny tmux, which forwards the link itself. It wraps the
 * rendered line through Transform, the hatch Ink keeps for escapes
 * its layout must not measure.
 */
export function Link({
	label,
	url,
}: {
	readonly label: string;
	readonly url: string;
}) {
	return (
		<Transform transform={line => hyperlink(line, url)}>
			<Text
				bold
				color='cyan'
			>
				{label}
			</Text>
		</Transform>
	);
}
