import { object, or } from '@optique/core/constructs';
import { map } from '@optique/core/modifiers';
import type { Mode, Parser } from '@optique/core/parser';
import { command } from '@optique/core/primitives';

import { doc } from './command.ts';
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
} from './command.ts';
import { Refusal } from './errors.ts';

const NO_ARGS = object({});

// The parsers group() built, so a program can tell a group among its
// commands from a leaf without reaching into Optique's parsers.
const GROUPS = new WeakSet<object>();

/** Whether `parser` is a group, which the builder can open at. */
export const isGroup = (parser: object): boolean => GROUPS.has(parser);

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
		commands: [first, second, ...rest],
	}: GroupSpec<C>): CommandParser<C> => {
		const built = command(name, or(first, second, ...rest), {
			description: doc(description),
		});
		GROUPS.add(built);
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
