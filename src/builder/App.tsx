import { ConfirmInput, Select } from '@inkjs/ui';
import { Box, Text } from 'ink';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { Title } from '../ui/atoms/Title.tsx';
import { useBuilder } from './context.ts';
import { commandLine, toArgv } from './fields.ts';
import type { Filled } from './fields.ts';
import { FieldPrompt, inputFor, label } from './inputs.tsx';
import { BuilderProvider } from './provider.tsx';
import type { BuilderProps } from './provider.tsx';

const HIDDEN = '<hidden>';

const SKIPPED = '(skipped)';

const VISIBLE_OPTIONS = 8;

interface FrameProps {
	readonly children: ReactNode;
}

const shown = ({ field, value }: Filled): string => {
	if (value === '') return SKIPPED;
	return field.secret ? HIDDEN : value;
};

const masked = (filled: Filled): Filled =>
	filled.field.secret && filled.value !== ''
		? { ...filled, value: HIDDEN }
		: filled;

function Frame({ children }: FrameProps) {
	return <Box flexDirection='column'>{children}</Box>;
}

function Heading() {
	const {
		meta: { name, start },
	} = useBuilder();
	return (
		<Title
			name={`${commandLine(name, start)}: pick a command and fill it in`}
		/>
	);
}

/** The levels chosen so far, one dim line each. */
function Trail() {
	const {
		state: { chosen },
	} = useBuilder();
	return chosen.map(level => (
		<Text
			key={level.name}
			dimColor
		>
			{`${level.name}  ${level.description}`}
		</Text>
	));
}

/** The Select over the current level's subcommands. */
function Levels() {
	const {
		state: { stage, path },
		actions: { choose },
	} = useBuilder();
	const options = useMemo(
		() =>
			stage.kind === 'levels'
				? stage.options.map(level => ({
						label: `${level.name}  ${level.description}`,
						value: level.name,
					}))
				: [],
		[stage],
	);
	if (stage.kind !== 'levels') return null;
	return (
		<Select
			key={path.join(' ')}
			options={options}
			visibleOptionCount={VISIBLE_OPTIONS}
			onChange={choose}
		/>
	);
}

/** The fields answered so far, one dim line each, secrets hidden. */
function Answers() {
	const {
		state: { filled },
	} = useBuilder();
	return filled.map(entry => (
		<Text
			key={label(entry.field)}
			dimColor
		>
			{`${label(entry.field)}: ${shown(entry)}`}
		</Text>
	));
}

/** The field awaiting an answer, with the input its kind takes. */
function Prompt() {
	const {
		state: { current, filled },
		actions: { fill },
	} = useBuilder();
	if (current === undefined) return null;
	return (
		<FieldPrompt
			key={filled.length}
			field={current}
		>
			{inputFor(current, fill)}
		</FieldPrompt>
	);
}

/** The assembled line behind a yes/no that defaults to no. */
function Confirmation() {
	const {
		state: { stage, path, filled },
		actions: { run, cancel },
		meta: { name },
	} = useBuilder();
	if (stage.kind !== 'confirm') return null;
	return (
		<Box
			flexDirection='column'
			marginTop={1}
		>
			<Text color='green'>
				{commandLine(name, toArgv(path, filled.map(masked)))}
			</Text>
			<Box>
				<Text>Run it? </Text>
				<ConfirmInput
					defaultChoice='cancel'
					onConfirm={run}
					onCancel={cancel}
				/>
			</Box>
		</Box>
	);
}

/**
 * One Select per level of the tree, then one input per field, then the
 * assembled command line behind a confirmation that defaults to no.
 */
export function Builder(props: BuilderProps) {
	return (
		<BuilderProvider {...props}>
			<Frame>
				<Heading />
				<Trail />
				<Levels />
				<Answers />
				<Prompt />
				<Confirmation />
			</Frame>
		</BuilderProvider>
	);
}
