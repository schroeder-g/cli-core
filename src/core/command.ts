import { message, text } from '@optique/core/message';
import type { Message } from '@optique/core/message';
import type { Mode, Parser } from '@optique/core/parser';

import type { Plan } from './plan.ts';
import type { Streams } from './streams.ts';

/** What cli-core awaits: the value, or a promise of it. */
export type Awaitable<T> = T | Promise<T>;

/**
 * What every planner and action gets: the run's root, its streams,
 * injected or the process's, and whether it is a dry run. A program
 * extends it with what its own commands read.
 */
export interface Context extends Streams {
	/** What a step's relative `cwd` resolves against. */
	readonly root: string;
	readonly dryRun: boolean;
	/**
	 * Writes the question to stderr and reads one line from stdin;
	 * rejects with a `Refusal` when the input ends before an answer.
	 */
	prompt(question: string): Promise<string>;
}

/**
 * A command that is no sequence of steps. `--dry-run` prints
 * `describe()` instead of running it, unless it is `readOnly`.
 */
export interface Action<C extends Context = Context> {
	describe(root: string): string[];
	run(ctx: C): Awaitable<number>;
	readonly readOnly?: boolean;
}

export type Planner<T, C extends Context = Context> = (
	value: T,
	ctx: C,
) => Awaitable<Plan<C> | Action<C>>;

/**
 * What a parsed leaf carries: its own planner, so dispatch needs no
 * switch.
 */
export interface Command<C extends Context = Context> {
	readonly plan: (ctx: C) => Awaitable<Plan<C> | Action<C>>;
}

/** A leaf or a group: a parser whose value carries a planner. */
export type CommandParser<C extends Context = Context> = Parser<
	Mode,
	Command<C>,
	unknown
>;

export const isAction = <C extends Context>(
	result: Plan<C> | Action<C>,
): result is Action<C> => 'run' in result;

export const doc = (description: string): Message =>
	message`${text(description)}`;

/** A command parser's name: the first term of its usage. */
export const nameOf = (parser: CommandParser<never>): string => {
	const [term] = parser.usage;
	return term?.type === 'command' ? term.name : '';
};

/**
 * A group as help and completion show it: its name, its description
 * and each leaf's, in order.
 */
export interface GroupManifest {
	readonly name: string;
	readonly description: string;
	readonly leaves: Readonly<Record<string, string>>;
}

/**
 * A leaf as help shows it, `args` parsing what it takes into the value
 * its planner gets.
 */
export interface LeafSpec<
	M extends Mode,
	T,
	C extends Context = Context,
> {
	readonly name: string;
	readonly description: string;
	readonly args: Parser<M, T, unknown>;
	readonly plan: Planner<T, C>;
}

/** A leaf that takes no arguments and no options of its own. */
export type BareLeafSpec<C extends Context = Context> = Omit<
	LeafSpec<'sync', Readonly<Record<never, never>>, C>,
	'args'
>;

/** A leaf from its spec: a command whose value carries its planner. */
export interface LeafBuilder<C extends Context> {
	<M extends Mode, T>(
		spec: LeafSpec<M, T, C>,
	): Parser<M, Command<C>, unknown>;
	(spec: BareLeafSpec<C>): Parser<'sync', Command<C>, unknown>;
}

/** Two commands or more, as a group holds them, in help's order. */
export type GroupMembers<C extends Context> = readonly [
	CommandParser<C>,
	CommandParser<C>,
	...CommandParser<C>[],
];

/** A group: its name, its description and the commands it holds. */
export interface GroupSpec<C extends Context> {
	readonly name: string;
	readonly description: string;
	readonly commands: GroupMembers<C>;
}

/** The command builders over one program's context. */
export interface CommandBuilders<C extends Context> {
	readonly leaf: LeafBuilder<C>;
	readonly group: (spec: GroupSpec<C>) => CommandParser<C>;
	/**
	 * A group of the manifest's shape whose every leaf takes nothing and
	 * plans through `plan`: a stand-in for one loaded later.
	 */
	readonly lazyGroup: (
		manifest: GroupManifest,
		plan: Planner<unknown, C>,
	) => CommandParser<C>;
	/** The planner of a leaf whose task has not landed. */
	readonly notBuilt: Planner<unknown, C>;
}
