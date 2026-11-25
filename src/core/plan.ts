import { relative, resolve } from 'node:path';

import type { Action, Context } from './command.ts';
import { hexEscape, isControl } from './text.ts';

const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

const ESCAPES: Readonly<Record<string, string>> = {
	'\n': '\\n',
	'\t': '\\t',
	'\r': '\\r',
	'\u001b': '\\e',
	"'": "\\'",
	'\\': '\\\\',
};

/**
 * A value the runner resolves at spawn and every printer shows by its
 * `ref`.
 */
export interface Secret {
	readonly ref: string;
	resolve(): Promise<string>;
}

/** @public */
export type Arg = string | Secret;

/** @public */
export interface Step {
	readonly title: string;
	/** Absolute, or relative to the checkout root. */
	readonly cwd: string;
	readonly argv: readonly Arg[];
	readonly env?: Readonly<Record<string, Arg>>;
	/**
	 * `stderr` for a step whose output is not the command's own, so
	 * stdout carries only what the command prints.
	 */
	readonly stdout?: 'stderr';
	readonly unless?: {
		readonly describe: string;
		check(): Promise<boolean>;
	};
}

/**
 * Steps run in order, `finally` steps run however the run went, and
 * `then` an action run once the plan has succeeded, after its `finally`
 * steps; `--dry-run` prints the steps and then describes it.
 */
export interface Plan<C extends Context = Context> {
	readonly steps: readonly Step[];
	readonly finally?: readonly Step[];
	readonly then?: Action<C>;
}

/** @public */
export const isSecret = (arg: Arg): arg is Secret =>
	typeof arg !== 'string';

const escaped = (char: string): string =>
	ESCAPES[char] ?? (isControl(char) ? hexEscape(char) : char);

/**
 * A word as a shell takes it: plain, single-quoted, or in bash's `$'…'`
 * form when it holds a control character, so one word always prints on
 * one line and an escape sequence shows as text.
 */
export const shellWord = (word: string): string => {
	if (PLAIN_WORD.test(word)) return word;
	return Array.from(word).some(isControl)
		? `$'${Array.from(word, escaped).join('')}'`
		: `'${word.replaceAll("'", "'\\''")}'`;
};

/** `argv` as one shell line, each word quoted as it needs. */
export const shellLine = (argv: readonly string[]): string =>
	argv.map(shellWord).join(' ');

const argWord = (arg: Arg): string =>
	isSecret(arg) ? `<${arg.ref}>` : shellWord(arg);

const envEntry = ([name, value]: [string, Arg]): string =>
	isSecret(value) ? `${name} ← ${value.ref}` : name;

/** @public */
export function formatStep(step: Step, root: string): string {
	const cwd = relative(root, resolve(root, step.cwd)) || '.';
	const lines = [
		`# ${step.title}`,
		`$ ${step.argv.map(argWord).join(' ')}`,
		`  cwd: ${cwd}`,
	];
	const env = Object.entries(step.env ?? {});
	if (env.length > 0)
		lines.push(`  env: ${env.map(envEntry).join(', ')}`);
	if (step.unless) lines.push(`  only if not: ${step.unless.describe}`);
	return lines.join('\n');
}

const stepLines = (steps: readonly Step[], root: string): string[] =>
	steps.flatMap(step => formatStep(step, root).split('\n'));

/**
 * The plan as `--dry-run` prints it: each step, then the `finally`
 * steps under their heading.
 */
export function planLines(
	plan: Pick<Plan, 'steps' | 'finally'>,
	root: string,
): string[] {
	const lines = stepLines(plan.steps, root);
	if (plan.finally?.length)
		lines.push('finally:', ...stepLines(plan.finally, root));
	return lines;
}
