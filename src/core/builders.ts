import { object, or } from '@optique/core/constructs';
import { map } from '@optique/core/modifiers';
import type { Mode, Parser } from '@optique/core/parser';
import { command } from '@optique/core/primitives';

import { doc, nameOf } from './command.ts';
import type {
	BareLeafSpec,
	Command,
	CommandBuilders,
	CommandParser,
	Context,
	GroupManifest,
	GroupSpec,
	LeafSpec,
	Planner,
	Screen,
} from './command.ts';
import { Refusal } from './errors.ts';

const NO_ARGS = object({});

/** What group() knows of a group it built: its commands and its screen. */
interface Built {
	readonly commands: readonly CommandParser<never>[];
	readonly screen?: Screen<never>;
}

// The parsers group() built, so a program can tell a group among its
// commands from a leaf, and find its screen, without reaching into
// Optique's parsers, which carry neither.
const GROUPS = new WeakMap<object, Built>();

/** Whether `parser` is a group, which the builder can open at. */
export const isGroup = (parser: object): boolean => GROUPS.has(parser);

/**
 * The screen of the group `path` names among `commands`, at any depth;
 * none when the path ends on a leaf, names nothing, or names a group
 * that is no place.
 */
export function screenAt<C extends Context>(
	commands: readonly CommandParser<C>[],
	path: readonly string[],
): Screen<C> | undefined {
	let members: readonly CommandParser<never>[] = commands;
	let built: Built | undefined;
	for (const name of path) {
		const member = members.find(parser => nameOf(parser) === name);
		built = member === undefined ? undefined : GROUPS.get(member);
		if (built === undefined) return undefined;
		members = built.commands;
	}
	// The table holds every program's groups; this one was built over
	// the context of the program whose commands led to it.
	return built?.screen as Screen<C> | undefined;
}

/**
 * The command builders over one program's context, bound once so its
 * commands name the context nowhere else.
 */
export function builders<C extends Context>(): CommandBuilders<C> {
	const notBuilt: Planner<unknown, C> = () => {
		throw new Refusal('not built yet');
	};

	function leaf<M extends Mode, T>(
		spec: LeafSpec<M, T, C>,
	): Parser<M, Command<C>, unknown>;

	function leaf(
		spec: BareLeafSpec<C>,
	): Parser<'sync', Command<C>, unknown>;

	function leaf<M extends Mode, T>(
		spec: BareLeafSpec<C> | LeafSpec<M, T, C>,
	): Parser<Mode, Command<C>, unknown> {
		const args: Parser<Mode, unknown, unknown> =
			'args' in spec ? spec.args : NO_ARGS;
		const plan = spec.plan as Planner<unknown, C>;
		return command(
			spec.name,
			map(args, (value): Command<C> => ({
				plan: ctx => plan(value, ctx),
			})),
			{ description: doc(spec.description) },
		);
	}

	const group = ({
		name,
		description,
		commands,
		screen,
	}: GroupSpec<C>): CommandParser<C> => {
		const [first, second, ...rest] = commands;
		const built = command(name, or(first, second, ...rest), {
			description: doc(description),
		});
		GROUPS.set(built, { commands, screen });
		return built;
	};

	const lazyGroup = (
		manifest: GroupManifest,
		plan: Planner<unknown, C>,
	): CommandParser<C> => {
		const [first, second, ...rest] = Object.entries(
			manifest.leaves,
		).map(([name, description]) => leaf({ name, description, plan }));
		if (first === undefined || second === undefined)
			throw new Error(`${manifest.name} names fewer than two leaves`);
		return group({
			name: manifest.name,
			description: manifest.description,
			commands: [first, second, ...rest],
		});
	};

	return { leaf, group, lazyGroup, notBuilt };
}
