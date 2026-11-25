import { object, or } from '@optique/core/constructs';
import { message, text } from '@optique/core/message';
import { map } from '@optique/core/modifiers';
import type { Mode, Parser } from '@optique/core/parser';
import { command } from '@optique/core/primitives';

import { Refusal } from './errors.ts';
import type { Plan } from './plan.ts';
import type { Streams } from './streams.ts';

// The parsers group() built, so a program can tell a group among its
// commands from a leaf without reaching into Optique's parsers.
const GROUPS = new WeakSet<object>();

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
	run(ctx: C): Promise<number>;
	readonly readOnly?: boolean;
}

export type Planner<T, C extends Context = Context> = (
	value: T,
	ctx: C,
) => Promise<Plan<C> | Action<C>>;

/**
 * What a parsed leaf carries: its own planner, so dispatch needs no
 * switch.
 */
export interface Command<C extends Context = Context> {
	readonly plan: (ctx: C) => Promise<Plan<C> | Action<C>>;
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

export const doc = (description: string) =>
	message`${text(description)}`;

/** Whether `parser` is a group, which the builder can open at. */
export const isGroup = (parser: object): boolean => GROUPS.has(parser);

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
 * The command builders over one program's context, bound once so its
 * commands name the context nowhere else.
 */
export function commands<C extends Context>() {
	/** The planner of a leaf whose task has not landed. */
	const notBuilt: Planner<unknown, C> = () =>
		Promise.reject(new Refusal('not built yet'));

	function leaf<M extends Mode, T, S>(
		name: string,
		description: string,
		parser: Parser<M, T, S>,
		plan: Planner<T, C>,
	) {
		return command(
			name,
			map(parser, (value): Command<C> => ({
				plan: ctx => plan(value, ctx),
			})),
			{ description: doc(description) },
		);
	}

	function group(
		name: string,
		description: string,
		...members: readonly [
			CommandParser<C>,
			CommandParser<C>,
			...CommandParser<C>[],
		]
	) {
		const [first, second, ...rest] = members;
		const built = command(name, or(first, second, ...rest), {
			description: doc(description),
		});
		GROUPS.add(built);
		return built;
	}

	/**
	 * A group of the manifest's shape whose every leaf takes no options
	 * and plans through `plan`: a stand-in for one loaded later.
	 */
	function lazyGroup(
		manifest: GroupManifest,
		plan: Planner<unknown, C>,
	) {
		const [first, second, ...rest] = Object.entries(
			manifest.leaves,
		).map(([name, description]) =>
			leaf(name, description, object({}), plan),
		);
		if (first === undefined || second === undefined)
			throw new Error(`${manifest.name} names fewer than two leaves`);
		return group(
			manifest.name,
			manifest.description,
			first,
			second,
			...rest,
		);
	}

	return { leaf, group, lazyGroup, notBuilt };
}
