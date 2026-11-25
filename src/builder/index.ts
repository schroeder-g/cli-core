import { Refusal } from '../core/errors.ts';
import type { Streams } from '../core/streams.ts';
import { presentView } from '../ui/screen.ts';
import { place } from './fields.ts';
import type { AnyParser } from './fields.ts';
import type { BuilderProps } from './provider.tsx';

export * from './fields.ts';

/**
 * Judges `path` from its one doc page: a word naming no command
 * refuses, and so does a path ending on a leaf, which has no levels to
 * pick.
 */
async function assertGroup(
	program: AnyParser,
	path: readonly string[],
): Promise<void> {
	if (path.length === 0) return;
	const { path: resolved, levels } = await place(program, path);
	if (resolved.length < path.length)
		throw new Refusal(
			`\`${path.slice(0, resolved.length + 1).join(' ')}\` names no command group`,
		);
	if (levels.length === 0)
		throw new Refusal(
			`\`${path.join(' ')}\` is a command, not a group; run it with its options`,
		);
}

/**
 * Opens the interactive builder over `program` at the group `path` and
 * returns the argv it assembled, or `undefined` on cancel. The form
 * renders on the run's stderr, so stdout stays the plan's. A path
 * naming no group throws a `Refusal`, and so does a stdin that is no
 * terminal.
 */
export async function openBuilder(
	name: string,
	program: AnyParser,
	path: string[],
	io: Streams,
): Promise<string[] | undefined> {
	await assertGroup(program, path);
	return presentView<string[] | undefined, BuilderProps>(
		io,
		'the builder needs a terminal; write the command and its options instead',
		() => import('./App.tsx'),
		'Builder',
		exit => ({
			name,
			program,
			path,
			onDone: argv => exit.done(argv),
			onError: error => exit.fail(error),
		}),
		{ onStderr: true },
	);
}
