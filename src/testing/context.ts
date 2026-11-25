import type { Context } from '../core/command.ts';
import { capture, stdin } from './streams.ts';

/** A base context at `root`, off a terminal, that expects no prompt. */
export const testContext = (
	root: string,
	overrides: Partial<Context> = {},
): Context => ({
	root,
	dryRun: false,
	stdin: stdin({ tty: false }),
	stdout: capture(),
	stderr: capture(),
	prompt: () => Promise.reject(new Error('no prompt expected')),
	...overrides,
});
