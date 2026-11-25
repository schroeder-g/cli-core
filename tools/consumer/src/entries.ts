import { log } from '@four7/cli-core';
import { message, names, text, timestamp } from '@four7/cli-core/args';
import type {
	Message,
	NonEmptyString,
	ValueParser,
	ValueParserResult,
} from '@four7/cli-core/args';
import { form } from '@four7/cli-core/builder';
import { findRoot } from '@four7/cli-core/git';
import { runPlan } from '@four7/cli-core/process';
import { hermetic, terminal } from '@four7/cli-core/testing';
import { Title } from '@four7/cli-core/ui';

import { config } from './program.ts';

export const entries = {
	log,
	form,
	runPlan,
	terminal,
	Title,
	findRoot,
};

export const targets = names(['-t', '--target'], () => ['a', 'b'], {
	description: message`The targets.`,
	noun: 'target',
});

export const since = timestamp();

const SHOUT: NonEmptyString = 'SHOUT';

const refusal = (input: string): Message =>
	message`Expected capitals, but got ${text(input)}.`;

/** A custom value parser, from the types `/args` gives a program. */
export const shout: ValueParser<'sync', string> = {
	mode: 'sync',
	metavar: SHOUT,
	placeholder: '',
	parse: (input): ValueParserResult<string> =>
		input === input.toUpperCase()
			? { success: true, value: input }
			: { success: false, error: refusal(input) },
	format: value => value,
};

export const loadHermetic = hermetic(config);

export const { context, load, sourceOf } = config;
