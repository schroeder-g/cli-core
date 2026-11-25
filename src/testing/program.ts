import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { object, or } from '@optique/core/constructs';

import { commands } from '../core/command.ts';
import type { CommandParser, Context } from '../core/command.ts';
import type {
	Config,
	Environment,
	LoadedConfig,
} from '../core/config.ts';
import { withGlobals } from '../core/program.ts';
import type { Program } from '../core/program.ts';
import { capture, stdin } from './streams.ts';

// A home no file is ever written under, so a hermetic load finds no
// default config file.
const NO_HOME = join(tmpdir(), 'cli-core-no-home');

export interface Run {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

/**
 * A fixture tree: the leaves beside an `other` leaf, so the root is a
 * group as a real program's is.
 */
export function fixtureTree<C extends Context>(
	first: CommandParser<C>,
	...rest: readonly CommandParser<C>[]
): Program<C> {
	const { leaf } = commands<C>();
	return withGlobals<C>(
		or(
			first,
			...rest,
			leaf('other', 'Other.', object({}), () =>
				Promise.resolve({ steps: [] }),
			),
		),
	);
}

/** One run off a terminal, its streams captured, over `opts`. */
export async function runCaptured<O extends object>(
	run: (argv: readonly string[], opts?: O) => Promise<number>,
	argv: readonly string[],
	opts: NoInfer<O>,
): Promise<Run> {
	const stdout = capture();
	const stderr = capture();
	const code = await run(argv, {
		stdin: stdin({ tty: false }),
		stdout,
		stderr,
		...opts,
	});
	return { code, stdout: stdout.text(), stderr: stderr.text() };
}

/**
 * The lines a plan print gives one step, from its `$ command` line to
 * the next step's heading.
 */
export function printedStep(stdout: string, command: string): string[] {
	const lines = stdout.split('\n');
	const at = lines.indexOf(`$ ${command}`);
	if (at < 0) return [];
	const end = lines.findIndex(
		(line, i) =>
			i > at && (line.startsWith('# ') || line === 'finally:'),
	);
	return lines.slice(at, end < 0 ? undefined : end);
}

/**
 * A config loader that sees `env` alone, over a home holding no file:
 * no config file of the developer's and no variable of the process's
 * reaches the run, only what `env` and `--config` name.
 */
export const hermetic =
	<T>(config: Pick<Config<T>, 'load'>, env: Environment = {}) =>
	(path: string | undefined): LoadedConfig<T> =>
		config.load(path, { HOME: NO_HOME, ...env });
