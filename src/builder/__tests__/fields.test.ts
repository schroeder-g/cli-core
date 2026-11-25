import { describe, expect, test } from 'bun:test';

import { object } from '@optique/core/constructs';
import { message } from '@optique/core/message';
import {
	multiple,
	optional,
	withDefault,
} from '@optique/core/modifiers';
import type { Mode, Parser } from '@optique/core/parser';
import {
	argument,
	flag,
	option,
	passThrough,
} from '@optique/core/primitives';
import { choice, integer, string } from '@optique/core/valueparser';

import { builders } from '../../core/builders.ts';
import type { Context } from '../../core/command.ts';
import { fixtureTree } from '../../testing/index.ts';
import {
	commandLine,
	form,
	joinWords,
	levels,
	splitWords,
	toArgv,
} from '../fields.ts';
import type { Field } from '../fields.ts';

const PORT_DEFAULT = 9000;

const { leaf } = builders<Context>();

interface Shaped {
	readonly kind: Field['kind'];
	readonly names: readonly string[];
	readonly metavar?: string;
	readonly choices?: readonly string[];
	readonly required: boolean;
	readonly secret: boolean;
	readonly staticDefault?: string;
}

const GLOBALS: Shaped[] = [
	{
		kind: 'flag',
		names: ['--dry-run'],
		required: false,
		secret: false,
	},
	{
		kind: 'value',
		names: ['--config'],
		metavar: 'FILE',
		required: false,
		secret: false,
	},
	{
		kind: 'flag',
		names: ['-q', '--quiet'],
		required: false,
		secret: false,
	},
	{
		kind: 'multi',
		names: ['-v', '--verbose'],
		required: false,
		secret: false,
	},
];

const nothing = () => Promise.resolve({ steps: [] });

const fx = <M extends Mode, T, S>(parser: Parser<M, T, S>) =>
	fixtureTree(
		leaf({
			name: 'fx',
			description: 'Fixture.',
			args: parser,
			plan: nothing,
		}),
	);

const program = fx(
	object({
		mode: option(
			'--mode',
			choice(['fast', 'slow'], { metavar: 'MODE' }),
			{
				description: message`How fast.`,
			},
		),
		tag: multiple(option('--tag', string({ metavar: 'TAG' }))),
		clear: multiple(
			option('--clear', choice(['cache', 'logs'], { metavar: 'WHAT' })),
		),
		port: withDefault(
			option('--port', integer({ metavar: 'PORT' })),
			PORT_DEFAULT,
		),
		password: optional(
			option('--password', string({ metavar: 'PASSWORD' })),
		),
		force: optional(flag('--force')),
		name: argument(string({ metavar: 'NAME' })),
		rest: multiple(argument(string({ metavar: 'REST' }))),
	}),
);

const passing = fx(object({ args: passThrough() }));

const positioned = fx(
	object({
		first: argument(choice(['a', 'b'], { metavar: 'FIRST' })),
		second: argument(choice(['x', 'y'], { metavar: 'SECOND' })),
	}),
);

const shape = ({
	kind,
	names,
	metavar,
	choices,
	required,
	secret,
	staticDefault,
}: Field): Shaped => ({
	kind,
	names,
	required,
	secret,
	...(metavar === undefined ? {} : { metavar }),
	...(choices === undefined ? {} : { choices }),
	...(staticDefault === undefined ? {} : { staticDefault }),
});

describe('builder fields match the parser', () => {
	test('a fixture leaf derives one field per documented term', async () => {
		expect(await levels(program, [])).toEqual([
			{ name: 'fx', description: 'Fixture.' },
			{ name: 'other', description: 'Other.' },
		]);
		expect(await levels(program, ['fx'])).toEqual([]);
		const fields = await form(program, ['fx']);
		expect(fields.map(shape)).toEqual([
			{
				kind: 'choice',
				names: ['--mode'],
				metavar: 'MODE',
				choices: ['fast', 'slow'],
				required: true,
				secret: false,
			},
			{
				kind: 'multi',
				names: ['--tag'],
				metavar: 'TAG',
				required: false,
				secret: false,
			},
			{
				kind: 'multi',
				names: ['--clear'],
				metavar: 'WHAT',
				choices: ['cache', 'logs'],
				required: false,
				secret: false,
			},
			{
				kind: 'value',
				names: ['--port'],
				metavar: 'PORT',
				required: false,
				secret: false,
				staticDefault: String(PORT_DEFAULT),
			},
			{
				kind: 'value',
				names: ['--password'],
				metavar: 'PASSWORD',
				required: false,
				secret: true,
			},
			{
				kind: 'flag',
				names: ['--force'],
				required: false,
				secret: false,
			},
			{
				kind: 'positional',
				names: [],
				metavar: 'NAME',
				required: true,
				secret: false,
			},
			{
				kind: 'multi',
				names: [],
				metavar: 'REST',
				required: false,
				secret: false,
			},
			...GLOBALS,
		]);
		expect(fields[0]?.description).toBe('How fast.');
		expect((await form(passing, ['fx'])).map(shape)).toEqual([
			{
				kind: 'passthrough',
				names: [],
				required: false,
				secret: false,
			},
			...GLOBALS,
		]);
	});

	test('a choice argument after another keeps its own list', async () => {
		const fields = await form(positioned, ['fx']);
		expect(fields.slice(0, 2).map(shape)).toEqual([
			{
				kind: 'choice',
				names: [],
				metavar: 'FIRST',
				choices: ['a', 'b'],
				required: true,
				secret: false,
			},
			{
				kind: 'choice',
				names: [],
				metavar: 'SECOND',
				choices: ['x', 'y'],
				required: true,
				secret: false,
			},
		]);
	});
});

describe('builds the argv', () => {
	test('in documented order, the words after -- last', async () => {
		const fields = await form(program, ['fx']);

		const by = (name: string) =>
			fields.find(f => f.names.includes(name) || f.metavar === name);

		const argv = toArgv(
			['fx'],
			[
				{ field: by('--mode') as Field, value: 'fast' },
				{ field: by('--tag') as Field, value: 'a b' },
				{
					field: by('--clear') as Field,
					value: joinWords(['cache', 'logs']),
				},
				{ field: by('--port') as Field, value: '' },
				{ field: by('--password') as Field, value: 'hunter2 two' },
				{ field: by('--force') as Field, value: 'yes' },
				{ field: by('NAME') as Field, value: 'two words' },
				{ field: by('REST') as Field, value: '--diff "x y"' },
				{ field: by('--dry-run') as Field, value: 'yes' },
				{ field: by('--config') as Field, value: '' },
				{ field: by('--quiet') as Field, value: '' },
				{ field: by('--verbose') as Field, value: '2' },
			],
		);
		expect(argv).toEqual([
			'fx',
			'--mode',
			'fast',
			'--tag',
			'a',
			'--tag',
			'b',
			'--clear',
			'cache',
			'--clear',
			'logs',
			'--password',
			'hunter2 two',
			'--force',
			'two words',
			'--dry-run',
			'--verbose',
			'--verbose',
			'--',
			'--diff',
			'x y',
		]);
		expect(commandLine('f7', argv)).toBe(
			"f7 fx --mode fast --tag a --tag b --clear cache --clear logs --password 'hunter2 two' --force 'two words' --dry-run --verbose --verbose -- --diff 'x y'",
		);
		expect(
			toArgv(['fx'], [{ field: by('--verbose') as Field, value: 'x' }]),
		).toEqual(['fx']);
	});

	test('an empty form is the path alone', () => {
		expect(toArgv(['doctor'], [])).toEqual(['doctor']);
		expect(commandLine('f7', ['doctor'])).toBe('f7 doctor');
	});

	test('splits words as a shell does', () => {
		expect(
			splitWords(
				`--message='deploy x' --target="a b" c\\ d '' "q\\"r"`,
			),
		).toEqual(['--message=deploy x', '--target=a b', 'c d', '', 'q"r']);
		expect(splitWords("  open 'to the end")).toEqual([
			'open',
			'to the end',
		]);
		expect(splitWords('')).toEqual([]);
		expect(splitWords(joinWords(['a b', "it's", 'plain']))).toEqual([
			'a b',
			"it's",
			'plain',
		]);
	});

	test('shows a control character as the shell would take it', () => {
		expect(commandLine('f7', ['fx', 'ok@b.c\rx'])).toBe(
			"f7 fx $'ok@b.c\\rx'",
		);
		expect(commandLine('f7', ['fx', "it's"])).toBe("f7 fx 'it'\\''s'");
	});
});
