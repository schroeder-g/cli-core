import type { LogLevel } from '@logtape/logtape';
import { merge, object, or } from '@optique/core/constructs';
import type { SourceContext } from '@optique/core/context';
import {
	map,
	multiple,
	optional,
	withDefault,
} from '@optique/core/modifiers';
import type { FluentParser } from '@optique/core/modifiers';
import type { Mode, Parser } from '@optique/core/parser';
import {
	argument,
	command,
	flag,
	option,
} from '@optique/core/primitives';
import { choice, string } from '@optique/core/valueparser';
import { verbosity } from '@optique/logtape';
import { runAsync } from '@optique/run';
import type { RunOptions } from '@optique/run';

import { openBuilder } from '../builder/index.ts';
import { place } from '../builder/fields.ts';
import type { Place } from '../builder/fields.ts';
import { runPlan } from '../process/run.ts';
import {
	argvReader,
	BASE_LEVEL,
	COMPLETION,
	CONFIG_OPTION,
	configFromArgv,
	DRY_RUN_OPTION,
	HELP,
	HELP_FLAGS,
	levelFromArgv,
	QUIET_FLAGS,
	valuedOptions,
	VERBOSE_LONG,
	VERBOSE_SHORT,
} from './argv.ts';
import type { ArgvReader } from './argv.ts';
import { builders, isGroup } from './builders.ts';
import { doc, isAction, nameOf } from './command.ts';
import type {
	Awaitable,
	Command,
	CommandBuilders,
	CommandParser,
	Context,
	GroupManifest,
} from './command.ts';
import type { Config, LoadedConfig } from './config.ts';
import { Failure } from './errors.ts';
import { Exit, exitCode, REFUSED } from './exit.ts';
import { configureLogging, log } from './logging.ts';
import { lineReader } from './prompt.ts';
import { lineWriter } from './streams.ts';
import type { Streams } from './streams.ts';

/** What separates a help page's usage from the paragraphs under it. */
const PARAGRAPH_BREAK = '\n\n';

/** The leaf that opens the builder, unless the program names another. */
const BUILDER = 'i';

/**
 * A group loaded only for an argv that opens on it: help and
 * completion show its manifest until then.
 */
export interface LazyGroup<C extends Context> {
	readonly manifest: GroupManifest;
	readonly load: () => Awaitable<CommandParser<C>>;
}

/**
 * A group that is a place, not a list: named alone on a terminal, with
 * no dry run and no help asked, it opens a screen.
 */
export interface Screen<C extends Context> {
	readonly group: string;
	open(ctx: C): Awaitable<number>;
}

/** What one run sets up, once its config is known to the loader. */
export interface Session<C extends Context> {
	/** Sources beside the config's, registered unless help is asked. */
	readonly contexts?: readonly SourceContext[];
	/**
	 * The run's context over what the runner owns, `root` included.
	 * Called only for a leaf about to plan, a screen about to open or
	 * the builder about to open, so help and completion never reach
	 * what it reads.
	 */
	context(base: Context): C;
}

export interface ProgramSpec<C extends Context, T> {
	/** The program's name, as usage and the builder spell it. */
	readonly name: string;
	/**
	 * The top-level commands, in help's order; a lazy group stands in
	 * place.
	 */
	readonly commands: readonly (CommandParser<C> | LazyGroup<C>)[];
	readonly screens?: readonly Screen<C>[];
	/** The leaf that opens the builder. */
	readonly builder?: string;
	/**
	 * The root the run's steps resolve against, located from the
	 * working directory; the working directory itself by default. It is
	 * called once per run, and only when the context is built, so help
	 * and completion never locate it; what it throws ends the run.
	 */
	readonly root?: (cwd: string) => string;
	/**
	 * Sets up a run over `config`, which answers the config loaded so
	 * far.
	 */
	readonly session: SessionFactory<C, T>;
}

/** What sets up one run: the spec's, or a caller's over it. */
export type SessionFactory<C extends Context, T> = (run: {
	readonly config: () => T;
}) => Session<C>;

export interface RunProgramOptions<
	C extends Context,
	T,
> extends Partial<Streams> {
	/**
	 * The config loader, over the spec's: what `--config` named, or
	 * nothing.
	 */
	readonly load?: (path: string | undefined) => LoadedConfig<T>;
	/** The tree, over the spec's, as the fixtures run under one. */
	readonly program?: Program<C>;
	readonly session?: SessionFactory<C, T>;
	/** The directory the root is located from, the process's by default. */
	readonly cwd?: string;
	/** The root, when the caller located it already, over the spec's. */
	readonly root?: string;
}

// A type literal, not an interface: merge() admits only values with an
// implicit index signature.
type BuilderRequest = {
	readonly builder: readonly string[];
};

/** What the globals parse to, beside the leaf or the builder request. */
type Globals = {
	readonly dryRun: boolean;
	readonly config: string | undefined;
	readonly level: LogLevel;
};

const globals = object({
	dryRun: option(DRY_RUN_OPTION, {
		description: doc('Print what would run and run nothing.'),
	}),
	config: optional(
		option(CONFIG_OPTION, string({ metavar: 'FILE' }), {
			description: doc('The config file, over the default locations.'),
		}),
	),
	level: withDefault(
		or(
			map(
				flag(...QUIET_FLAGS, { description: doc('Log errors only.') }),
				(): LogLevel => 'error',
			),
			verbosity({
				short: VERBOSE_SHORT,
				long: VERBOSE_LONG,
				baseLevel: BASE_LEVEL,
			}),
		),
		BASE_LEVEL,
	),
});

/**
 * The globals over a tree of leaves: the shape every program has.
 *
 * @public
 */
export function withGlobals<C extends Context>(
	tree: Parser<Mode, Command<C> | BuilderRequest, unknown>,
): Program<C> {
	return merge(globals, tree);
}

/** @public */
export type Program<C extends Context> = FluentParser<
	'async',
	Globals & (Command<C> | BuilderRequest),
	Record<string | symbol, unknown>
>;

const isLazy = <C extends Context>(
	member: CommandParser<C> | LazyGroup<C>,
): member is LazyGroup<C> => 'manifest' in member;

// The first pass hands the context what it parsed, or a partial value
// when it stopped short; only `--config` is read from it.
const configPath = (parsed: unknown): string | undefined => {
	const path = (parsed as { config?: unknown } | null | undefined)
		?.config;
	return typeof path === 'string' ? path : undefined;
};

const namesGroup = (
	{ path: opened, levels }: Place,
	path: readonly string[],
): boolean =>
	path.length > 0 && opened.length === path.length && levels.length > 0;

/** A program: its tree, its run and what routing reads of an argv. */
export interface DefinedProgram<C extends Context, T> {
	/**
	 * The tree and the builder's leaf under the globals, each lazy group
	 * `loaded` names in place of its placeholder.
	 */
	readonly build: (
		loaded?: ReadonlyMap<LazyGroup<C>, CommandParser<C>>,
	) => Program<C>;
	/**
	 * The one entry for the flag path, the builder and the tests: parses
	 * `argv`, then prints, runs or describes what the leaf planned.
	 */
	readonly run: (
		argv: readonly string[],
		opts?: RunProgramOptions<C, T>,
	) => Promise<number>;
	/**
	 * Whether the run needs `group` loaded: the arguments open on it, a
	 * completion request names it, or the builder is about to open, on
	 * its leaf or on an argv of globals alone when stdin is a terminal.
	 */
	readonly needs: (
		argv: readonly string[],
		group: string,
		stdinIsTTY?: boolean,
	) => boolean;
	/** The argv as the placeholders read it, before any group loads. */
	readonly reader: ArgvReader;
	/** The groups' names, as the builder's leaf completes them. */
	readonly groupNames: readonly string[];
}

/** A program's spec with what its runs share. */
interface Compiled<C extends Context, T> {
	readonly spec: ProgramSpec<C, T>;
	readonly config: Config<T>;
	/** The argv as the placeholders read it, before any group loads. */
	readonly reader: ArgvReader;
	/** The tree for `argv`, each lazy group it needs loaded. */
	readonly load: (
		argv: readonly string[],
		ttyIn: boolean,
	) => Promise<Program<C>>;
}

/** The screen `argv` opens: its group alone, no listing asked. */
const screenOf = <C extends Context, T>(
	spec: ProgramSpec<C, T>,
	read: ArgvReader,
	argv: readonly string[],
	path: readonly string[],
): Screen<C> | undefined =>
	path.length === 1
	&& !read.optionTokens(argv).includes(DRY_RUN_OPTION)
	&& !read.wantsHelp(argv)
		? spec.screens?.find(screen => screen.group === path[0])
		: undefined;

/**
 * One run of `argv`; the builder's argv runs again under the
 * program and the session it was assembled in.
 */
async function runWith<C extends Context, T>(
	compiled: Compiled<C, T>,
	argv: readonly string[],
	opts: RunProgramOptions<C, T>,
	reentered?: {
		readonly program: Program<C>;
		readonly session: Session<C>;
		readonly root: () => string;
	},
): Promise<number> {
	const { spec, config, reader, load } = compiled;
	const stdin = opts.stdin ?? process.stdin;
	const stdout = opts.stdout ?? process.stdout;
	const stderr = opts.stderr ?? process.stderr;
	const ttyIn = stdin.isTTY === true;
	const writeOut = lineWriter(stdout);
	const writeErr = lineWriter(stderr);
	const prompts = lineReader(stdin, stderr);

	// One load serves the configured flags and the session, so neither
	// can read a config the other did not.
	let current = config.defaults;

	const loadConfig = (parsed: unknown): LoadedConfig<T> => {
		const loaded = (opts.load ?? config.load)(configPath(parsed));
		current = loaded.value;
		return loaded;
	};

	const session =
		reentered?.session
		?? (opts.session ?? spec.session)({ config: () => current });

	let located = opts.root;

	const root =
		reentered?.root
		?? (() => {
			located ??= (spec.root ?? (cwd => cwd))(
				opts.cwd ?? process.cwd(),
			);
			return located;
		});

	const options: RunOptions = {
		args: argv,
		programName: spec.name,
		help: { command: true, option: { names: HELP_FLAGS } },
		showDefault: true,
		completion: 'command',
		errorExitCode: REFUSED,
		colors:
			opts.stdout === undefined ? undefined : stdout.isTTY === true,
		stdout: writeOut,
		stderr: writeErr,
		onExit: code => {
			throw new Exit(code);
		},
		contexts: reader.wantsHelp(argv)
			? []
			: [config.context, ...(session.contexts ?? [])],
		contextOptions: { load: loadConfig },
	};

	/** The run's context, once the config is loaded. */
	const contextOf = (dryRun: boolean): C =>
		session.context({
			root: root(),
			dryRun,
			stdin,
			stdout,
			stderr,
			prompt: question => prompts.prompt(question),
		});

	// The builder's argv runs with the globals it was given, through
	// the program and the session this run already has. A context the
	// run cannot build refuses before the form opens.
	const reenter = async (
		program: Program<C>,
		read: ArgvReader,
		path: readonly string[],
	) => {
		contextOf(false);
		const assembled = await openBuilder(spec.name, program, [...path], {
			stdin,
			stdout,
			stderr,
		});
		if (assembled === undefined) return 0;
		return runWith(
			compiled,
			[...read.optionTokens(argv), ...assembled],
			opts,
			{
				program,
				session,
				root,
			},
		);
	};

	// The help page at `path`, as `help` prints it, to `write`. No
	// context, as on any help request.
	const helpPage = async (
		program: Program<C>,
		path: readonly string[],
		write: (line: string) => void,
	) => {
		try {
			await runAsync(program, {
				...options,
				args: path.length === 0 ? ['--help'] : [HELP, ...path],
				contexts: [],
				stdout: write,
			});
		} catch (error) {
			if (!(error instanceof Exit)) throw error;
		}
	};

	// Globals alone off a terminal, or a group and nothing more: the
	// help goes to stderr, exit 2.
	const usage = async (
		program: Program<C>,
		path: readonly string[],
	) => {
		await helpPage(program, path, writeErr);
		return REFUSED;
	};

	// The page's first paragraph is the command's usage, wrapped and
	// coloured as the help shows it.
	const usageLine = async (
		program: Program<C>,
		path: readonly string[],
	) => {
		let page = '';
		await helpPage(program, path, line => {
			page += line;
		});
		writeErr(page.split(PARAGRAPH_BREAK)[0] ?? '');
	};

	// Optique puts the root's usage above every error. Inside a
	// command, that command's own usage answers the mistake, so the
	// error is held until the usage is out.
	const parse = async (
		program: Program<C>,
		opened: readonly string[],
	) => {
		const held: string[] = [];
		try {
			return await runAsync(program, {
				...options,
				aboveError: opened.length === 0 ? 'usage' : 'none',
				stderr: line => held.push(line),
			});
		} catch (error) {
			if (
				error instanceof Exit
				&& error.code === REFUSED
				&& opened.length > 0
			)
				await usageLine(program, opened);
			throw error;
		} finally {
			for (const line of held) writeErr(line);
		}
	};

	// The lexical level serves what is logged before the parse; the
	// parsed value differs from it only for an argv the parser would
	// refuse.
	const level = levelFromArgv(argv);
	await configureLogging(level, writeErr);
	try {
		const program =
			reentered?.program ?? opts.program ?? (await load(argv, ttyIn));
		// The tree this run parses, its loaded groups' options included.
		const read = argvReader(valuedOptions(program.usage));
		if (read.bare(argv))
			return ttyIn
				? await reenter(program, read, [])
				: await usage(program, []);
		const placed = await place(program, read.words(argv));
		const path = read.plainWords(argv);
		const screen = ttyIn ? screenOf(spec, read, argv, path) : undefined;
		if (screen !== undefined) {
			loadConfig({ config: configFromArgv(argv) });
			return await screen.open(contextOf(false));
		}
		if (namesGroup(placed, path)) return await usage(program, path);
		const value = await parse(program, placed.path);
		if (value.level !== level)
			await configureLogging(value.level, writeErr);
		if ('builder' in value)
			return await reenter(program, read, value.builder);
		const ctx = contextOf(value.dryRun);
		const result = await value.plan(ctx);
		if (isAction(result)) {
			if (!value.dryRun || result.readOnly)
				return await result.run(ctx);
			for (const line of result.describe(ctx.root)) writeOut(line);
			return 0;
		}
		return await runPlan(result, ctx);
	} catch (error) {
		return exitCode(error);
	} finally {
		prompts.close();
	}
}

/**
 * A program over `config` and `spec`: its tree, with each lazy group's
 * placeholder or the group itself, and the run that parses an argv and
 * prints, runs or describes what the leaf planned.
 */
function defineProgram<C extends Context, T>(
	config: Config<T>,
	spec: ProgramSpec<C, T>,
): DefinedProgram<C, T> {
	const builderLeaf = spec.builder ?? BUILDER;
	const { lazyGroup } = builders<C>();

	// Stands in for a lazy group in help and completion; routing loads
	// the real one before any argv that opens on it is parsed.
	const placeholders = new Map(
		spec.commands.filter(isLazy).map(group => [
			group,
			lazyGroup(group.manifest, () => {
				throw new Failure(
					`the ${group.manifest.name} group was not loaded for this invocation`,
				);
			}),
		]),
	);

	const resolveAll = (
		loaded: ReadonlyMap<LazyGroup<C>, CommandParser<C>>,
	): CommandParser<C>[] =>
		spec.commands.map(member =>
			isLazy(member)
				? (loaded.get(member) ?? placeholders.get(member)!)
				: member,
		);

	const groupNames = resolveAll(new Map()).filter(isGroup).map(nameOf);

	const builder = command(
		builderLeaf,
		object({
			builder: multiple(
				argument(choice(groupNames, { metavar: 'GROUP' })),
			),
		}),
		{ description: doc('Build a command interactively, at a group.') },
	);

	const build = (
		loaded: ReadonlyMap<LazyGroup<C>, CommandParser<C>> = new Map(),
	): Program<C> => {
		const [first, ...rest] = resolveAll(loaded);
		if (first === undefined)
			throw new Error(`${spec.name} declares no command`);
		return withGlobals<C>(or(first, ...rest, builder));
	};

	const reader: ArgvReader = argvReader(valuedOptions(build().usage));

	const needs = (
		argv: readonly string[],
		group: string,
		stdinIsTTY = false,
	): boolean => {
		const [head, second] = reader.words(argv);
		if (head === COMPLETION)
			return needs(argv.slice(argv.indexOf(COMPLETION) + 2), group);
		if (head === undefined) return stdinIsTTY;
		return (
			head === group
			|| head === builderLeaf
			|| (head === HELP && second === group)
		);
	};

	const load = async (argv: readonly string[], ttyIn: boolean) => {
		const wanted = spec.commands
			.filter(isLazy)
			.filter(group => needs(argv, group.manifest.name, ttyIn));
		const loaded = await Promise.all(
			wanted.map(async group => {
				log.debug('loading {group}', { group: group.manifest.name });
				return [group, await group.load()] as const;
			}),
		);
		return build(new Map(loaded));
	};

	const run = (
		argv: readonly string[],
		opts: RunProgramOptions<C, T> = {},
	): Promise<number> =>
		runWith({ spec, config, reader, load }, argv, opts);

	return { build, run, needs, reader, groupNames };
}

/**
 * The builders over the context `C`, and the program over them and the
 * config.
 */
export interface Commands<
	C extends Context,
	T,
> extends CommandBuilders<C> {
	readonly program: (spec: ProgramSpec<C, T>) => DefinedProgram<C, T>;
}

/** A program's config, waiting for the context its commands plan over. */
export interface ConfiguredCommands<T> {
	/** The builders and the program over the context `C`. */
	over<C extends Context = Context>(): Commands<C, T>;
}

/**
 * The command builders and the program over `config`: the config's
 * type comes from it, and `over` names the context once, so neither is
 * named again.
 */
export function commands<T>(config: Config<T>): ConfiguredCommands<T> {
	return {
		over: <C extends Context = Context>(): Commands<C, T> => ({
			...builders<C>(),
			program: spec => defineProgram(config, spec),
		}),
	};
}
