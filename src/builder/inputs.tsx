import {
	MultiSelect,
	PasswordInput,
	Select,
	TextInput,
} from '@inkjs/ui';
import { Box, Text } from 'ink';
import { useCallback, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { joinWords } from './fields.ts';
import type { Field } from './fields.ts';

// Select never reports the value '', so an empty choice carries a
// sentinel no literal can equal and is stored as ''.
const NONE = '\u0000';

const FLAG_ON = 'yes';

const COUNTS = ['0', '1', '2', '3'];

const VISIBLE_OPTIONS = 8;

interface Option {
	readonly label: string;
	readonly value: string;
}

interface InputProps {
	readonly field: Field;
	readonly onSubmit: (value: string) => void;
}

interface FieldPromptProps {
	readonly field: Field;
	readonly children: ReactNode;
}

export const label = (field: Field): string => {
	if (field.names.length > 0)
		return [field.names.join(', '), field.metavar]
			.filter(part => part !== undefined)
			.join(' ');
	if (field.kind === 'passthrough') return '--';
	return field.metavar ?? '';
};

// The static default is a hint and never the value: the effective one
// is the config's, which only the run resolves.
const hint = (field: Field): string => {
	const parts: string[] = [];
	if (field.required) parts.push('required');
	if (field.staticDefault !== undefined)
		parts.push(`default ${field.staticDefault}`);
	if (field.kind === 'multi' && field.choices === undefined)
		parts.push(
			field.metavar === undefined
				? 'how many times'
				: 'words, shell quoting',
		);
	if (field.kind === 'multi' && field.names.length === 0)
		parts.push('written after --');
	if (field.kind === 'passthrough')
		parts.push('words, shell quoting, written after --');
	return parts.join(', ');
};

const stored = (value: string): string => (value === NONE ? '' : value);

const choiceOptions = (field: Field): Option[] => [
	...(field.required ? [] : [{ label: '(none)', value: NONE }]),
	...(field.choices ?? []).map(value => ({ label: value, value })),
];

const flagOptions: Option[] = [
	{ label: 'no', value: NONE },
	{ label: 'yes', value: FLAG_ON },
];

const countOptions: Option[] = COUNTS.map(value => ({
	label: value,
	value,
}));

/** A field's line, bold name first, with its input beneath. */
export function FieldPrompt({ field, children }: FieldPromptProps) {
	const guidance = hint(field);
	return (
		<Box flexDirection='column'>
			<Text>
				<Text bold>{label(field)}</Text>
				{field.description === '' ? null : `  ${field.description}`}
				{guidance === '' ? null : (
					<Text dimColor>{`  (${guidance})`}</Text>
				)}
			</Text>
			<Box paddingLeft={2}>{children}</Box>
		</Box>
	);
}

function SecretInput({ field, onSubmit }: InputProps) {
	return (
		<PasswordInput
			placeholder={hint(field)}
			onSubmit={onSubmit}
		/>
	);
}

function FreeTextInput({ field, onSubmit }: InputProps) {
	return (
		<TextInput
			placeholder={hint(field)}
			onSubmit={onSubmit}
		/>
	);
}

function FlagInput({ onSubmit }: InputProps) {
	const change = useCallback(
		(value: string) => onSubmit(stored(value)),
		[onSubmit],
	);
	return (
		<Select
			options={flagOptions}
			onChange={change}
		/>
	);
}

function CountInput({ onSubmit }: InputProps) {
	return (
		<Select
			options={countOptions}
			onChange={onSubmit}
		/>
	);
}

function ChoiceInput({ field, onSubmit }: InputProps) {
	const options = useMemo(() => choiceOptions(field), [field]);
	const change = useCallback(
		(value: string) => onSubmit(stored(value)),
		[onSubmit],
	);
	return (
		<Select
			options={options}
			visibleOptionCount={VISIBLE_OPTIONS}
			onChange={change}
		/>
	);
}

function MultiChoiceInput({ field, onSubmit }: InputProps) {
	const options = useMemo(() => choiceOptions(field), [field]);
	const submit = useCallback(
		(values: string[]) => onSubmit(joinWords(values)),
		[onSubmit],
	);
	return (
		<MultiSelect
			options={options}
			visibleOptionCount={VISIBLE_OPTIONS}
			onSubmit={submit}
		/>
	);
}

/** The input a field takes its answer through, by what the field is. */
export const inputFor = (
	field: Field,
	onSubmit: (value: string) => void,
): ReactElement => {
	const props = { field, onSubmit };
	if (field.secret) return <SecretInput {...props} />;
	switch (field.kind) {
		case 'flag':
			return <FlagInput {...props} />;
		case 'choice':
			return <ChoiceInput {...props} />;
		case 'multi':
			if (field.choices !== undefined)
				return <MultiChoiceInput {...props} />;
			if (field.metavar === undefined) return <CountInput {...props} />;
			return <FreeTextInput {...props} />;
		default:
			return <FreeTextInput {...props} />;
	}
};
