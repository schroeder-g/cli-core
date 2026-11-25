import { describe, expect, test } from 'bun:test';

import { Text } from 'ink';

import {
	dependencyGraph,
	pullingDependents,
	pullingNeeds,
} from '../../core/graph.ts';
import {
	again,
	capture,
	drive,
	open,
	shown,
} from '../../testing/index.ts';
import type { Step } from '../../testing/index.ts';
import type {
	ChecklistItem,
	ChecklistViewProps,
} from '../ChecklistView.tsx';
import { presentView } from '../screen.ts';

const SPACE = ' ';

const ENTER = '\r';

const TITLE = 'deps';

/** A left press on the screen's row `y`, as the terminal reports it. */
const click = (y: number): string =>
	`\u001b[<0;4;${y}M\u001b[<0;4;${y}m`;

interface Item extends ChecklistItem {
	readonly kind: string;
}

const ITEMS: readonly Item[] = [
	{ name: 'store', kind: 'data' },
	{ name: 'api', kind: 'service' },
	{ name: 'site', kind: 'web' },
	{ name: 'docs', kind: 'web' },
];

const graph = dependencyGraph([
	{ name: 'store', needs: [] },
	{ name: 'api', needs: ['store'] },
	{ name: 'site', needs: ['api'] },
	{ name: 'docs', needs: ['api'] },
]);

type Props = ChecklistViewProps<Item>;

/**
 * Opens the view over `ITEMS` and drives it; the result is the names
 * Enter confirmed, or undefined once q quit.
 */
const run = async (
	steps: readonly Step[],
	props: Partial<Props> = {},
) => {
	const { result, screen } = await drive(
		open((stdin, stdout) =>
			presentView<ReadonlySet<string> | undefined, Props>(
				{ stdin, stdout, stderr: capture() },
				'needs a terminal',
				() => import('../ChecklistView.tsx'),
				'ChecklistView',
				exit => ({
					title: TITLE,
					items: ITEMS,
					initial: () => new Set(),
					onQuit: () => exit.done(undefined),
					onConfirm: checked => {
						exit.done(checked);
						return undefined;
					},
					...props,
				}),
				{ presentation: { mouse: true } },
			),
		),
		steps,
	);
	return { result, last: screen.slice(screen.lastIndexOf(TITLE)) };
};

const lines = (frame: string): string[] =>
	frame.split('\n').map(line => line.trimEnd());

describe('ChecklistView', () => {
	test('lists the items under the title, their kinds in a column, the hints last', async () => {
		const { result, last } = await run(
			[shown('▸ [ ] store', SPACE), again('▸ [x] store', 'q')],
			{
				sub: '4 nodes',
				keys: [['r', 'reloads']],
				confirms: 'runs',
				detail: (item, on) =>
					item.name === 'api' ? <Text>{on ? 'on' : 'up'}</Text> : null,
			},
		);
		expect(result).toBeUndefined();
		expect(lines(last)).toEqual([
			'deps  4 nodes',
			'',
			'▸ [x] store  data',
			'  [ ] api    service  up',
			'  [ ] site   web',
			'  [ ] docs   web',
			'',
			'↑↓ j k move · space toggles · a all · r reloads · enter runs · q quits',
			'',
		]);
	});

	test('a status line and a notice sit above the hints, the notice nearest them', async () => {
		const { last } = await run(
			[shown('▸ [ ] store', ENTER), again('nothing yet', 'q')],
			{
				status: <Text>mode: dry</Text>,
				onConfirm: () => 'nothing yet',
			},
		);
		expect(lines(last).slice(-4)).toEqual([
			'mode: dry',
			'nothing yet',
			'↑↓ j k move · space toggles · a all · enter confirms · q quits',
			'',
		]);
	});

	test('pulling needs: checking an item checks what it needs, and unchecking one a checked item needs is refused', async () => {
		const { result, last } = await run(
			[
				shown('▸ [ ] store', 'j'),
				again('▸ [ ] api', 'j'),
				again('▸ [ ] site', SPACE),
				again('▸ [x] site', 'j'),
				again('▸ [ ] docs', SPACE),
				again('▸ [x] docs', 'k'),
				again('▸ [x] site', 'k'),
				again('▸ [x] api', SPACE),
				again('uncheck them first', ENTER),
			],
			pullingNeeds(graph),
		);
		expect(last).toContain('site, docs need api; uncheck them first');
		expect([...(result ?? [])].sort()).toEqual([
			'api',
			'docs',
			'site',
			'store',
		]);
	});

	test('pulling dependents: checking an item checks what needs it, and unchecking one while what it needs is checked is refused', async () => {
		const { result, last } = await run(
			[
				shown('▸ [ ] store', 'j'),
				again('▸ [ ] api', SPACE),
				again('▸ [x] api', 'j'),
				again('▸ [x] site', SPACE),
				again('uncheck api first', 'k'),
				again('▸ [x] api', SPACE),
				again('▸ [ ] api', ENTER),
			],
			pullingDependents(graph),
		);
		expect(last).toContain('▸ [ ] api');
		expect([...(result ?? [])].sort()).toEqual(['docs', 'site']);
	});

	test('a notice clears on the next key, a move included', async () => {
		const { last } = await run(
			[
				shown('▸ [ ] store', ENTER),
				again('nothing yet', 'j'),
				again('▸ [ ] api', 'q'),
			],
			{ onConfirm: () => 'nothing yet' },
		);
		expect(last).not.toContain('nothing yet');
	});

	test('a click on a row points at it and toggles it', async () => {
		const { result } = await run([
			shown('▸ [ ] store', click(5)),
			again('▸ [x] site', ENTER),
		]);
		expect([...(result ?? [])]).toEqual(['site']);
	});

	test('with no items, says so in their place', async () => {
		const { last } = await run([shown('nothing listed', 'q')], {
			items: [],
			empty: 'nothing listed',
		});
		expect(lines(last).slice(0, 4)).toEqual([
			'deps',
			'',
			'nothing listed',
			'',
		]);
	});
});
