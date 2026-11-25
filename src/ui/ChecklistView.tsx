import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { widthOf } from '../core/text.ts';
import { Checkbox } from './atoms/Checkbox.tsx';
import { Hints } from './atoms/Hints.tsx';
import { Notice } from './atoms/Notice.tsx';
import { Title } from './atoms/Title.tsx';
import { CHECKLIST } from './hints.ts';
import type { Hint } from './hints.ts';
import type { ChecklistRules } from './hooks/useChecklist.ts';
import { useChecklistScreen } from './hooks/useChecklistScreen.ts';
import type { ChecklistScreenKeys } from './hooks/useChecklistScreen.ts';
import { useLeave } from './hooks/useLeave.ts';
import { Row } from './molecules/Row.tsx';

/** The screen row the first item is on: under the title and a blank. */
const FIRST_ROW = 3;

/** One row of a checklist: its name, and a kind shown in a column. */
export interface ChecklistItem {
	readonly name: string;
	readonly kind?: string;
}

export interface ChecklistViewProps<I extends ChecklistItem>
	extends
		Omit<ChecklistScreenKeys, 'firstRow'>,
		Omit<ChecklistRules, 'onHeld'> {
	readonly title: string;
	/** What the title is over, dim beside it. */
	readonly sub?: string;
	readonly items: readonly I[];
	/** The names checked at first. */
	readonly initial: () => ReadonlySet<string>;
	/** What Enter does, as its hint names it; `confirms` by default. */
	readonly confirms?: string;
	/** The screen's own keys, hinted between the checklist's and Enter. */
	readonly keys?: readonly Hint[];
	/** What a row shows after its kind; `on` while the cursor is on it. */
	readonly detail?: (item: I, on: boolean) => ReactNode;
	/** A line above the notice and the hints, such as a mode. */
	readonly status?: ReactNode;
	/** What shows in place of the rows when there are none. */
	readonly empty?: string;
}

/**
 * A checklist screen: the title, a row per item with its box, then a
 * status line, the notice and the hints. The keys are
 * `useChecklistScreen`'s, and q goes back to the screen that handed
 * the terminal over.
 */
export function ChecklistView<I extends ChecklistItem>({
	title,
	sub,
	items,
	initial,
	confirms = 'confirms',
	keys = [],
	detail,
	status,
	empty,
	...screen
}: ChecklistViewProps<I>) {
	const leave = useLeave();
	const { index, has, notice } = useChecklistScreen(
		items.map(item => item.name),
		initial,
		{ ...screen, firstRow: FIRST_ROW },
	);
	const nameWidth = widthOf(items, item => item.name);
	const kindWidth = widthOf(items, item => item.kind ?? '');
	return (
		<Box flexDirection='column'>
			<Title
				name={title}
				sub={sub}
			/>
			<Box
				flexDirection='column'
				marginTop={1}
			>
				{items.length === 0 && empty !== undefined ? (
					<Text dimColor>{empty}</Text>
				) : (
					items.map((item, at) => (
						<Row
							key={item.name}
							on={at === index}
							prefix={<Checkbox checked={has(item.name)} />}
							name={item.name}
							nameWidth={nameWidth}
							kind={item.kind}
							kindWidth={kindWidth}
						>
							{detail?.(item, at === index)}
						</Row>
					))
				)}
			</Box>
			<Box
				flexDirection='column'
				marginTop={1}
			>
				{status}
				<Notice text={notice} />
				<Hints
					hints={[...CHECKLIST, ...keys, ['enter', confirms], leave]}
				/>
			</Box>
		</Box>
	);
}
