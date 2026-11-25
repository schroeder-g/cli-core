import { describe, expect, test } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';

import { Box, renderToString, Text } from 'ink';
import type { ReactNode } from 'react';

import { Link } from '../atoms/Link.tsx';
import { hyperlink } from '../hyperlink.ts';
import { Columns } from '../molecules/Columns.tsx';
import { Labeled } from '../molecules/Labeled.tsx';
import { Row, rowWidth } from '../molecules/Row.tsx';

const URL = 'https://example.com/a/very/long/path?with=a&query=string';

const OPEN = `\u001b]8;;${URL}\u0007`;

const CLOSE = '\u001b]8;;\u0007';

const linesOf = (text: string): string[] =>
	stripVTControlCharacters(text).split('\n');

describe('hyperlink', () => {
	test('wraps the label in an OSC 8 link to the url', () => {
		expect(hyperlink('docs', URL)).toBe(`${OPEN}docs${CLOSE}`);
	});
});

describe('Link', () => {
	test('links its label, the escape left out of the layout', () => {
		const drawn = renderToString(
			<Box>
				<Link
					label='docs'
					url={URL}
				/>
				<Text>|</Text>
			</Box>,
			{ columns: 12 },
		);
		expect(drawn).toContain(`${OPEN}docs${CLOSE}`);
		expect(drawn.replace(OPEN, '').replace(CLOSE, '')).toBe('docs|');
	});
});

describe('Columns', () => {
	test('lays the names out across as many columns as the width holds', () => {
		const names = ['aa', 'bbbb', 'c', 'dd', 'eee'];
		expect(
			linesOf(
				renderToString(
					<Columns
						names={names}
						width={10}
					/>,
				),
			),
		).toEqual(['aa    bbbb', 'c     dd', 'eee']);
		expect(
			linesOf(
				renderToString(
					<Columns
						names={names}
						width={16}
					/>,
				),
			),
		).toEqual(['aa    bbbb  c', 'dd    eee']);
	});

	test('keeps one column when the width holds less than a name', () => {
		expect(
			linesOf(
				renderToString(
					<Columns
						names={['alpha', 'beta']}
						width={3}
					/>,
					{ columns: 20 },
				),
			),
		).toEqual(['alpha', 'beta']);
	});

	test('takes the gap between columns', () => {
		expect(
			linesOf(
				renderToString(
					<Columns
						names={['a', 'b', 'c']}
						width={7}
						gap={1}
					/>,
				),
			),
		).toEqual(['a b c']);
	});

	test('shows a dash for no names, or what `none` says', () => {
		expect(
			renderToString(
				<Columns
					names={[]}
					width={10}
				/>,
			),
		).toBe('—');
		expect(
			renderToString(
				<Columns
					names={[]}
					width={10}
					none='nothing'
				/>,
			),
		).toBe('nothing');
	});
});

describe('rowWidth', () => {
	const MARK = '|';

	// Ink trims a line's trailing spaces, so a mark drawn after the row
	// shows where it ends.
	const widthOf = (row: ReactNode): number =>
		stripVTControlCharacters(
			renderToString(
				<Box>
					{row}
					<Text>{MARK}</Text>
				</Box>,
			),
		).indexOf(MARK);

	test('is the width a row draws, with a kind or without', () => {
		expect(
			widthOf(
				<Row
					on
					name='api'
					nameWidth={8}
					kind='worker'
					kindWidth={11}
				/>,
			),
		).toBe(rowWidth({ nameWidth: 8, kindWidth: 11 }));
		expect(
			widthOf(
				<Row
					on={false}
					name='api'
					nameWidth={8}
				/>,
			),
		).toBe(rowWidth({ nameWidth: 8 }));
	});

	test('counts a prefix and the space after it', () => {
		expect(
			widthOf(
				<Row
					on
					prefix='[x]'
					name='api'
					nameWidth={5}
					kind='db'
					kindWidth={2}
				/>,
			),
		).toBe(rowWidth({ nameWidth: 5, kindWidth: 2, prefixWidth: 3 }));
	});
});

describe('Labeled', () => {
	test('stacks its values in a column beside the label', () => {
		expect(
			linesOf(
				renderToString(
					<Labeled
						label={<Text>tiers</Text>}
						width={8}
					>
						<Text>staging</Text>
						<Text>production</Text>
					</Labeled>,
				),
			),
		).toEqual(['tiers   staging', '        production']);
	});

	test('takes a text label dim', () => {
		expect(
			linesOf(
				renderToString(
					<Labeled
						dim
						label='port'
						width={6}
					>
						<Text>8080</Text>
					</Labeled>,
				),
			),
		).toEqual(['port  8080']);
	});
});
