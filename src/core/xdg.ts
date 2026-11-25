import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export type Environment = Readonly<Record<string, string | undefined>>;

/** The kinds of file the XDG base-directory specification places. */
export type XdgKind = 'config' | 'state' | 'data' | 'cache';

const HOMES: Readonly<
	Record<XdgKind, { readonly variable: string; readonly under: string }>
> = {
	config: { variable: 'XDG_CONFIG_HOME', under: '.config' },
	state: { variable: 'XDG_STATE_HOME', under: join('.local', 'state') },
	data: { variable: 'XDG_DATA_HOME', under: join('.local', 'share') },
	cache: { variable: 'XDG_CACHE_HOME', under: '.cache' },
};

/**
 * The base directory of `kind` under the XDG base-directory
 * specification: its variable when that is an absolute path, which the
 * specification says to require, else its default under HOME, or the
 * user's home when HOME is empty.
 *
 * @public
 */
export function xdgHome(
	kind: XdgKind,
	env: Environment = process.env,
): string {
	const { variable, under } = HOMES[kind];
	const set = env[variable];
	if (set !== undefined && isAbsolute(set)) return set;
	return join(env.HOME || homedir(), under);
}
