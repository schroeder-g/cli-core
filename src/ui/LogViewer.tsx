import { Box, Text, useBoxMetrics, useInput, useWindowSize } from 'ink';
import type { DOMElement, Key } from 'ink';
import { memo, useMemo, useRef, useState } from 'react';

import { widthOf } from '../core/text.ts';
import type { LogFollower, LogLine } from '../process/follower.ts';
import { Hints } from './atoms/Hints.tsx';
import { Notice } from './atoms/Notice.tsx';
import { Title } from './atoms/Title.tsx';
import { SEPARATOR } from './glyphs.ts';
import type { Hint } from './hints.ts';
import { useHelp } from './hooks/useHelp.ts';
import { useLeave } from './hooks/useLeave.ts';
import { useMouse } from './hooks/useMouse.ts';
import { useStore } from './hooks/useStore.ts';
import { LOG_RULES } from './log-rules.ts';
import { KeyHelp } from './molecules/KeyHelp.tsx';
import { Labeled } from './molecules/Labeled.tsx';
import { Painted } from './molecules/Painted.tsx';
import { isInterrupt } from './ScreenFrame.tsx';
import { highlight, paint } from './paint.ts';
import type { Rule } from './paint.ts';

/** The rows assumed when the terminal does not say. */
const DEFAULT_ROWS = 24;

/** The colours the sources take, in order; a seventh starts over. */
const NAME_COLORS: readonly string[] = [
	'cyan',
	'green',
	'magenta',
	'yellow',
	'blue',
	'red',
];

const PROMPT_CURSOR = '▏';

/** The screen row the name strip is on: under the title and a blank. */
const STRIP_ROW = 3;

/** What Enter does to the pattern being typed: apply it. */
const APPLY = Symbol('apply');

export interface LogViewerProps {
	readonly logs: LogFollower;
	/** The title's bold part: what the screen is. */
	readonly title: string;
	/** The title's dim part: what it is over. */
	readonly sub?: string;
	readonly onBack: () => void;
	/** A key that goes back besides q and Escape: the one that opened it. */
	readonly backKey?: string;
	/** What the keys call a source; `log` by default. */
	readonly noun?: string;
	/** How each line is painted; `LOG_RULES` by default. */
	readonly rules?: readonly Rule[];
}

const colorOf = (names: readonly string[], name: string): string =>
	NAME_COLORS[names.indexOf(name) % NAME_COLORS.length] ?? 'white';

/** The chip of each name as the strip lays it out: `n name`. */
const chipOf = (name: string, at: number): string =>
	`${at + 1} ${name}`;

/** The name whose chip holds column `x` of the strip, 1-based. */
function nameAt(
	names: readonly string[],
	x: number,
): string | undefined {
	let from = 1;
	for (const [at, name] of names.entries()) {
		const to = from + chipOf(name, at).length;
		if (x >= from && x < to) return name;
		from = to + SEPARATOR.length;
	}
	return undefined;
}

/** The keys the foot names: what is used most, and how to see the rest. */
const hints = (noun: string, leave: Hint): Hint[] => [
	['↑↓ j k', 'scroll'],
	['1-9', `toggles that ${noun}`],
	['/', 'pattern'],
	['?', 'all keys'],
	leave,
];

/** Every key of the viewer, as `?` lists them. */
const allKeys = (noun: string, leave: Hint): Hint[] => [
	['↑↓ j k', 'scroll a line'],
	['PgUp PgDn', 'scroll a page'],
	['g G', 'go to the oldest line, or follow the newest'],
	['1-9', `hides or shows that ${noun}'s lines`],
	['a', `shows every ${noun}`],
	['/', 'takes a pattern, a case-insensitive regex; enter applies it'],
	['c', 'clears the pattern'],
	['wheel', 'scrolls'],
	['click', `on a chip, hides or shows that ${noun}`],
	leave,
];

/**
 * The pattern after `input`: the text as it now reads, `APPLY` on
 * Enter, or nothing on Escape.
 */
function typed(
	prompt: string,
	input: string,
	key: Key,
): string | typeof APPLY | undefined {
	if (key.return) return APPLY;
	if (key.escape) return undefined;
	if (key.backspace || key.delete) return prompt.slice(0, -1);
	if (!key.ctrl && !key.meta && input !== '') return prompt + input;
	return prompt;
}

/**
 * The names as a filter strip: its number, each in its colour, dim when
 * hidden.
 */
function Names({
	names,
	hidden,
}: {
	readonly names: readonly string[];
	readonly hidden: ReadonlySet<string>;
}) {
	return (
		<Text>
			{names.map((name, at) => (
				<Text key={name}>
					{at > 0 ? <Text dimColor>{SEPARATOR}</Text> : null}
					<Text
						color={hidden.has(name) ? undefined : colorOf(names, name)}
						dimColor={hidden.has(name)}
						strikethrough={hidden.has(name)}
					>
						{chipOf(name, at)}
					</Text>
				</Text>
			))}
		</Text>
	);
}

/** One log line: its name in the name's colour, then the text painted. */
const Line = memo(function Line({
	line,
	names,
	nameWidth,
	regex,
	rules,
}: {
	readonly line: LogLine;
	readonly names: readonly string[];
	readonly nameWidth: number;
	readonly regex: RegExp | undefined;
	readonly rules: readonly Rule[];
}) {
	const painted = useMemo(
		() => paint(line.text, rules),
		[line.text, rules],
	);
	const segments = useMemo(
		() => highlight(painted, regex),
		[painted, regex],
	);
	return (
		<Box flexShrink={0}>
			<Labeled
				label={
					<Text color={colorOf(names, line.name)}>{line.name}</Text>
				}
				width={nameWidth + 2}
			>
				<Painted segments={segments} />
			</Labeled>
		</Box>
	);
});

/**
 * A follower's logs as one stream, newest at the bottom, following the
 * tail until scrolled. Arrows or j and k scroll, PgUp and PgDn by a
 * page, G follows again; a digit toggles that source's lines, a shows
 * every source; / takes a pattern (a regex, case-insensitive) that
 * Enter applies and Escape abandons, c clears it; q or Escape goes
 * back; Ctrl-C interrupts. On a screen presented with the mouse, the
 * wheel scrolls, and a click on a chip toggles its source.
 */
export function LogViewer({
	logs,
	title,
	sub,
	onBack,
	backKey,
	noun = 'log',
	rules = LOG_RULES,
}: LogViewerProps) {
	const leave = useLeave();
	const snapshot = useStore(logs);
	const { names, hidden, pattern, regex, problem, visible } = snapshot;
	const { rows } = useWindowSize();
	/** The newest line shown while scrolled back; none while following. */
	const [anchor, setAnchor] = useState<number | undefined>(undefined);
	const [prompt, setPrompt] = useState<string | undefined>(undefined);
	const help = useHelp();
	const stream = useRef<DOMElement>(null);
	const { height: measured, hasMeasured } = useBoxMetrics(stream);
	// The rows the rest of the frame leaves are known only once drawn. A
	// frame drawn before the measure catches up overflows the stream's box,
	// which ends flush with its newest line.
	const height = Math.max(
		1,
		hasMeasured ? measured : rows || DEFAULT_ROWS,
	);
	const fewest = Math.min(height, visible.length);
	const end =
		anchor === undefined
			? visible.length
			: Math.max(
					fewest,
					visible.findLastIndex(line => line.seq <= anchor) + 1,
				);

	const scrollTo = (next: number): void => {
		const at = Math.min(visible.length, Math.max(fewest, next));
		setAnchor(at === visible.length ? undefined : visible[at - 1]?.seq);
	};

	const scroll = (by: number): void => scrollTo(end - by);

	useInput((input, key) => {
		if (isInterrupt(input, key)) return;
		if (prompt !== undefined) {
			const next = typed(prompt, input, key);
			if (next === APPLY) logs.setPattern(prompt);
			setPrompt(typeof next === 'string' ? next : undefined);
			return;
		}
		if (help.answer(input, key)) return;
		if (key.escape || input === 'q' || input === backKey) onBack();
		else if (key.upArrow || input === 'k') scroll(1);
		else if (key.downArrow || input === 'j') scroll(-1);
		else if (key.pageUp) scroll(height);
		else if (key.pageDown) scroll(-height);
		else if (input === 'G') setAnchor(undefined);
		else if (input === 'g') scrollTo(fewest);
		else if (input === 'a') logs.showAll();
		else if (input === 'c') logs.setPattern('');
		else if (input === '/') setPrompt(pattern);
		else if (/^[1-9]$/.test(input)) {
			const name = names[Number(input) - 1];
			if (name !== undefined) logs.toggle(name);
		}
	});
	useMouse({
		onClick: ({ x, y }) => {
			if (y !== STRIP_ROW) return;
			const name = nameAt(names, x);
			if (name !== undefined) logs.toggle(name);
		},
		onWheel: direction => scroll(-direction),
	});
	const start = Math.max(0, end - height);
	const shown = visible.slice(start, end);
	const nameWidth = widthOf(names, name => name);
	return (
		<Box
			flexDirection='column'
			height={rows || DEFAULT_ROWS}
			overflow='hidden'
		>
			<Box flexShrink={0}>
				<Title
					name={title}
					sub={sub}
				/>
			</Box>
			<Box
				marginTop={1}
				flexShrink={0}
			>
				<Names
					names={names}
					hidden={hidden}
				/>
				<Text dimColor>{SEPARATOR}</Text>
				{prompt === undefined ? (
					<Text>
						<Text dimColor>/ </Text>
						{pattern === '' ? (
							<Text dimColor>no pattern</Text>
						) : (
							<Text color='yellow'>{pattern}</Text>
						)}
					</Text>
				) : (
					<Text>
						<Text dimColor>/ </Text>
						<Text inverse>{`${prompt}${PROMPT_CURSOR}`}</Text>
						<Text
							dimColor
						>{`${SEPARATOR}enter applies${SEPARATOR}esc abandons`}</Text>
					</Text>
				)}
			</Box>
			<Box
				ref={stream}
				flexDirection='column'
				justifyContent='flex-end'
				marginTop={1}
				flexGrow={1}
				flexShrink={1}
				flexBasis={0}
				overflow='hidden'
			>
				{shown.length === 0 ? (
					<Text dimColor>
						{visible.length === 0 && snapshot.lines.length > 0
							? 'nothing matches'
							: 'nothing yet'}
					</Text>
				) : (
					shown.map(line => (
						<Line
							key={line.seq}
							line={line}
							names={names}
							nameWidth={nameWidth}
							regex={regex}
							rules={rules}
						/>
					))
				)}
				<Box flexGrow={1} />
			</Box>
			<Box
				marginTop={1}
				flexShrink={0}
			>
				<Text dimColor>
					{visible.length === 0
						? 'showing 0 of 0'
						: `showing ${start + 1}-${end} of ${visible.length}`}
					{anchor === undefined ? `${SEPARATOR}following` : ''}
					{snapshot.lines.length !== visible.length
						? `${SEPARATOR}${snapshot.lines.length - visible.length} filtered out`
						: ''}
				</Text>
			</Box>
			<Box
				flexDirection='column'
				flexShrink={0}
			>
				<Notice
					text={
						problem === undefined ? undefined : `pattern: ${problem}`
					}
				/>
				{help.open ? (
					<KeyHelp keys={allKeys(noun, leave)} />
				) : (
					<Hints hints={hints(noun, leave)} />
				)}
			</Box>
		</Box>
	);
}
