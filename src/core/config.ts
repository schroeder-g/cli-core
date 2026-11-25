import { dirname, join, resolve } from 'node:path';

import { bindConfig, createConfigContext } from '@optique/config';
import type { ConfigContext, ConfigLoadResult } from '@optique/config';
import type { Mode, Parser } from '@optique/core/parser';
import { isPlainObject } from 'es-toolkit/predicate';
import type { z } from 'zod';

import { Refusal } from './errors.ts';
import { readToml } from './files.ts';
import { xdgHome } from './xdg.ts';
import type { Environment } from './xdg.ts';

const CONFIG_FILE = 'config.toml';

export type { ConfigContext, ConfigMeta } from '@optique/config';

export { z } from 'zod';

export * from './xdg.ts';

type Table = Record<string, unknown>;

/** Every key path of a table, as its schema spells it. */
type Paths<T> = T extends object
	? {
			[K in keyof T & string]: [K] | [K, ...Paths<NonNullable<T[K]>>];
		}[keyof T & string]
	: never;

/** Where a variable lands in the file's table, and how its text reads. */
export interface Variable<I> {
	readonly path: Paths<I>;
	readonly read: (text: string) => unknown;
}

/** Where a flag-backed value may also come from, as help spells it. */
export interface Source {
	/** The file's key, dotted. */
	readonly key: string;
	readonly variable: string;
}

/**
 * What the context's `load` answers: the table for the schema to
 * validate, where it came from, and the config it validates to.
 */
export interface LoadedConfig<T> extends ConfigLoadResult {
	readonly value: T;
}

export interface ConfigSpec<
	T,
	I,
	V extends Readonly<Record<string, Variable<I>>>,
> {
	/** The directory under the config home the file lives in. */
	readonly name: string;
	/**
	 * What each variable's name starts with, past which `variables` keys
	 * it.
	 */
	readonly envPrefix: string;
	/** The file's schema; `{}` must validate, to the defaults. */
	readonly schema: z.ZodType<T, I>;
	readonly variables: V;
}

interface Location {
	readonly file: string;
	readonly explicit: boolean;
}

// A variable's digits become the number the schema expects; any other
// text stays as it is, for the schema's type error to name.
export const numeral = (text: string): unknown =>
	/^\d+$/.test(text) ? Number(text) : text;

export const verbatim = (text: string): unknown => text;

function readTable({ file, explicit }: Location): Table | undefined {
	const loaded = readToml(file);
	if (loaded.ok) return isPlainObject(loaded.value) ? loaded.value : {};
	if (loaded.code === 'ENOENT') {
		if (explicit) throw new Refusal(`config file not found: ${file}`);
		return undefined;
	}
	throw new Refusal(
		loaded.code === undefined
			? `${file}: ${loaded.reason}`
			: `cannot read config ${file}: ${loaded.reason}`,
	);
}

// A table the file typed wrongly stays as it is, so the schema names
// the file's error rather than the variable's overlay hiding it.
function set(
	table: Table,
	path: readonly string[],
	value: unknown,
): void {
	const [head, ...rest] = path;
	if (head === undefined) return;
	if (rest.length === 0) {
		table[head] = value;
		return;
	}
	const existing = table[head];
	if (existing !== undefined && !isPlainObject(existing)) return;
	const next: Table = isPlainObject(existing) ? { ...existing } : {};
	table[head] = next;
	set(next, rest, value);
}

const describeIssue = (
	issue: z.core.$ZodIssue,
	variables: ReadonlyMap<string, string>,
): string => {
	const path = issue.path.map(String).join('.');
	const variable = variables.get(path);
	const where = path === '' ? 'the top level' : path;
	const source = variable === undefined ? '' : ` (${variable})`;
	return `  ${where}${source}: ${issue.message}`;
};

/**
 * A program's config: a TOML file, `--config` or
 * `<config home>/<name>/config.toml`, the `<envPrefix>*` variables
 * laid over it, validated by `schema`.
 */
export function defineConfig<
	T,
	I,
	V extends Readonly<Record<string, Variable<I>>>,
>({
	name,
	envPrefix,
	schema,
	variables,
}: ConfigSpec<T, I, V>): DefinedConfig<T, V> {
	const defaults: T = schema.parse({});
	const context = createConfigContext({ schema });

	const locate = (
		path: string | undefined,
		env: Environment,
	): Location =>
		path === undefined
			? {
					file: join(xdgHome('config', env), name, CONFIG_FILE),
					explicit: false,
				}
			: { file: resolve(path), explicit: true };

	/**
	 * The variables laid over a copy of the table, by the path each
	 * wrote.
	 */
	const overlay = (
		read: Table | undefined,
		env: Environment,
	): {
		readonly table: Table;
		readonly written: ReadonlyMap<string, string>;
	} => {
		const table: Table = { ...read };
		const written = new Map<string, string>();
		for (const [key, variable] of Object.entries<Variable<I>>(
			variables,
		)) {
			const variableName = `${envPrefix}${key}`;
			const text = env[variableName];
			if (!text) continue;
			const path = variable.path as readonly string[];
			set(table, path, variable.read(text));
			written.set(path.join('.'), variableName);
		}
		return { table, written };
	};

	/**
	 * Reads the file, `path` or the first of the XDG and `~/.config`
	 * locations, lays the variables of `env` over it, and validates the
	 * result; a file or a variable the schema refuses is a `Refusal`
	 * naming the file and each failing key. An absent default file gives
	 * the defaults.
	 */
	function load(
		path?: string,
		env: Environment = process.env,
	): LoadedConfig<T> {
		const location = locate(path, env);
		const read = readTable(location);
		const { table, written } = overlay(read, env);
		const result = schema.safeParse(table);
		if (!result.success) {
			const source =
				read === undefined ? 'the environment' : location.file;
			const issues = result.error.issues.map(issue =>
				describeIssue(issue, written),
			);
			throw new Refusal(
				[`invalid config in ${source}:`, ...issues].join('\n'),
			);
		}
		return {
			config: table,
			meta:
				read === undefined
					? undefined
					: {
							configDir: dirname(location.file),
							configPath: location.file,
						},
			value: result.data,
		};
	}

	const sourceOf = (key: keyof V & string): Source => {
		const variable: Variable<I> = variables[key];
		return {
			key: (variable.path as readonly string[]).join('.'),
			variable: `${envPrefix}${key}`,
		};
	};

	function configured<M extends Mode, U, S>(
		option: Parser<M, U, S>,
		key: (config: T) => U,
	): Parser<M, U, S> {
		return bindConfig(option, {
			context,
			key,
			default: key(defaults),
		});
	}

	return { defaults, context, load, sourceOf, configured };
}

/** What a program's config gives its runner. */
export interface Config<T> {
	readonly defaults: T;
	readonly context: ConfigContext<T>;
	readonly load: (path?: string, env?: Environment) => LoadedConfig<T>;
}

/**
 * What `defineConfig` answers: the runner's `Config`, where each
 * variable lands, and the flags that also live in the config.
 */
export interface DefinedConfig<T, V> extends Config<T> {
	/** The file's key the variable `key` writes, and its full name. */
	readonly sourceOf: (key: keyof V & string) => Source;
	/**
	 * A flag that also lives in the config: the flag, else the config's
	 * key, which its variable has already overlaid, else the schema's
	 * default for it, which help shows.
	 */
	readonly configured: <M extends Mode, U, S>(
		option: Parser<M, U, S>,
		key: (config: T) => U,
	) => Parser<M, U, S>;
}
