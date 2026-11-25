import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { Refusal } from '../core/errors.ts';
import type { Step } from '../core/plan.ts';
import { git } from './queries.ts';

const SHORT_ID_LENGTH = 7;

/** An object id longer than the abbreviation a title shows. */
const LONG_ID = new RegExp(`^[0-9a-f]{${SHORT_ID_LENGTH + 1},}$`);

/** @public */
export interface ScratchWorktree {
	/** Where it lives, as given: relative to the root, or absolute. */
	readonly path: string;
	readonly add: Step;
	readonly remove: Step;
}

/** @public */
export interface ScratchWorktreeOptions {
	/**
	 * The program the lock names, beside this process's id, so a run
	 * tells its own worktree from another run's.
	 */
	readonly owner: string;
}

const shownCommit = (commit: string): string =>
	LONG_ID.test(commit) ? commit.slice(0, SHORT_ID_LENGTH) : commit;

/**
 * Whether git lists the worktree at `path` locked with `reason`.
 */
async function lockedWith(
	root: string,
	path: string,
	reason: string,
): Promise<boolean> {
	const suffix = `/${relative(root, resolve(root, path))}`;
	const listed = await git(root, ['worktree', 'list', '--porcelain']);
	return listed.split('\n\n').some(block => {
		const [first, ...rest] = block.split('\n');
		return (
			first?.startsWith('worktree ') === true
			&& first.endsWith(suffix)
			&& rest.includes(`locked ${reason}`)
		);
	});
}

/**
 * The steps of a detached worktree of `commit` at `path`, relative to
 * `root`: `add` makes it locked with this run as the reason, and
 * `remove`, for a plan's `finally`, removes it whatever it holds, but
 * only when this run's lock is on it, so a worktree another run holds,
 * or none, is left alone. A path that exists already, from a run in
 * progress or one killed outright, is a `Refusal` here, before any
 * step.
 *
 * @public
 */
export function scratchWorktree(
	root: string,
	path: string,
	commit: string,
	{ owner }: ScratchWorktreeOptions,
): ScratchWorktree {
	if (existsSync(join(root, path)))
		throw new Refusal(
			`a worktree is at ${path}, from a run in progress or one that was killed; once no run holds it, remove it with git worktree remove --force --force ${path}`,
		);
	const reason = `${owner} ${process.pid}`;
	return {
		path,
		add: {
			title: `add a worktree of ${shownCommit(commit)} at ${path}`,
			cwd: root,
			argv: [
				'git',
				'worktree',
				'add',
				'--detach',
				'--lock',
				'--reason',
				reason,
				'--',
				path,
				commit,
			],
		},
		remove: {
			title: `remove the worktree at ${path}`,
			cwd: root,
			argv: [
				'git',
				'worktree',
				'remove',
				'--force',
				'--force',
				'--',
				path,
			],
			unless: {
				describe: `no worktree of this run is at ${path}`,
				check: async () => !(await lockedWith(root, path, reason)),
			},
		},
	};
}
