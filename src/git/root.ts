import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Refusal } from '../core/errors.ts';

const GIT_MARKER = '.git';

/** @public */
export interface FindRootOptions {
	/** The entry, file or directory, that marks a root: `.git` by default. */
	readonly marker?: string;
	/**
	 * Why the nearest directory holding the marker is not a root the
	 * program acts on, which refuses it; nothing accepts it.
	 */
	readonly accept?: (dir: string) => string | undefined;
	/**
	 * Whether a root another user owns is refused, as git's
	 * safe.directory refuses it; true by default.
	 */
	readonly owned?: boolean;
}

const canonical = (path: string): string => {
	const absolute = resolve(path);
	try {
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
};

const unenclosed = (start: string, marker: string): string =>
	marker === GIT_MARKER
		? `no git checkout encloses ${start}`
		: `no directory up from ${start} holds ${marker}`;

const ownedByCaller = (dir: string): boolean => {
	const uid = process.getuid?.();
	return uid === undefined || statSync(dir).uid === uid;
};

/**
 * The root enclosing `cwd`: the nearest directory holding the marker,
 * found by walking up from `cwd`'s canonical path without running
 * anything. A `Refusal` when no directory up to `/` holds it, when
 * `accept` refuses the one that does, or when another user owns it.
 *
 * @public
 */
export function findRoot(
	cwd: string,
	{ marker = GIT_MARKER, accept, owned = true }: FindRootOptions = {},
): string {
	const start = canonical(cwd);
	for (let dir = start; ; dir = dirname(dir)) {
		if (existsSync(join(dir, marker))) {
			const refusal = accept?.(dir);
			if (refusal !== undefined) throw new Refusal(refusal);
			if (owned && !ownedByCaller(dir))
				throw new Refusal(`${dir} belongs to another user`);
			return dir;
		}
		if (dirname(dir) === dir)
			throw new Refusal(unenclosed(start, marker));
	}
}

/**
 * Whether `root` is a linked worktree: its `.git` is then a file
 * naming the repository's, where the primary checkout has the
 * directory.
 *
 * @public
 */
export function isLinkedWorktree(root: string): boolean {
	try {
		return statSync(join(root, GIT_MARKER)).isFile();
	} catch {
		return false;
	}
}
