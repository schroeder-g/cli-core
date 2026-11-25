import { captureOrFail, capture } from '../process/spawn.ts';

const DETACHED_HEAD = 'HEAD';

const COMMIT = 'commit';

const lines = (text: string): string[] =>
	text.split('\n').filter(line => line !== '');

/**
 * git in `root`: its stdout trimmed, or a `Failure` naming the
 * arguments, the root and git's stderr.
 *
 * @public
 */
export const git = async (
	root: string,
	args: readonly string[],
): Promise<string> =>
	(await captureOrFail(['git', ...args], { cwd: root })).trim();

/**
 * The root of every worktree of the repository, the primary checkout
 * first, whether or not its directory is still there.
 *
 * @public
 */
export const worktreeRoots = async (root: string): Promise<string[]> =>
	lines(await git(root, ['worktree', 'list', '--porcelain']))
		.filter(line => line.startsWith('worktree '))
		.map(line => line.slice('worktree '.length));

/**
 * The commit `HEAD` names, in full.
 *
 * @public
 */
export const headSha = (root: string): Promise<string> =>
	git(root, ['rev-parse', 'HEAD']);

/**
 * Whether `rev` names one commit the checkout holds; an id it lacks,
 * or one that is ambiguous, does not.
 *
 * @public
 */
export const commitExists = async (
	root: string,
	rev: string,
): Promise<boolean> =>
	(
		await capture(
			['git', 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`],
			{ cwd: root },
		)
	).code === 0;

/**
 * `git log --oneline <older>..<newer>`, one line per commit.
 *
 * @public
 */
export const commitsBetween = async (
	root: string,
	older: string,
	newer: string,
): Promise<string[]> =>
	lines(await git(root, ['log', '--oneline', `${older}..${newer}`]));

/**
 * The branch `HEAD` is on; nothing when it is detached.
 *
 * @public
 */
export async function currentBranch(
	root: string,
): Promise<string | undefined> {
	const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
	return branch === DETACHED_HEAD ? undefined : branch;
}

/**
 * Whether `git status --porcelain` lists nothing: no change, staged or
 * not, and no untracked file.
 *
 * @public
 */
export const cleanTree = async (root: string): Promise<boolean> =>
	(await git(root, ['status', '--porcelain'])) === '';

/**
 * The one commit whose id begins with `abbreviation`, in full, resolved
 * among the checkout's objects alone so a ref of that name cannot
 * stand in for it; nothing when no commit, or more than one object,
 * begins with it.
 *
 * @public
 */
export async function commitOf(
	root: string,
	abbreviation: string,
): Promise<string | undefined> {
	const { code, stdout } = await capture(
		['git', 'rev-parse', `--disambiguate=${abbreviation}`],
		{ cwd: root },
	);
	if (code !== 0) return undefined;
	const [id, ...rest] = lines(stdout);
	if (id === undefined || rest.length > 0) return undefined;
	const type = await capture(['git', 'cat-file', '-t', id], {
		cwd: root,
	});
	return type.stdout.trim() === COMMIT ? id : undefined;
}

/**
 * The tracked files under `pathspecs` that differ between `commit` and
 * the working tree, as `git diff --name-only` lists them.
 *
 * @public
 */
export const changedSince = async (
	root: string,
	commit: string,
	pathspecs: readonly string[],
): Promise<string[]> =>
	lines(
		await git(root, [
			'diff',
			'--name-only',
			commit,
			'--',
			...pathspecs,
		]),
	);
