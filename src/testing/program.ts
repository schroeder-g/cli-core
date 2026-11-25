import { object, or } from '@optique/core/constructs';

import { commands } from '../core/command.ts';
import type { CommandParser, Context } from '../core/command.ts';
import { withGlobals } from '../core/program.ts';
import type { Program } from '../core/program.ts';
import { capture, stdin } from './streams.ts';

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
