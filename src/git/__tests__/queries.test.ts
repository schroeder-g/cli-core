import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Failure } from '../../core/errors.ts';
import {
	gitSync,
	initRepo,
	isolateGit,
	scratchDirs,
} from '../../testing/index.ts';
import {
	changedSince,
	cleanTree,
	commitExists,
	commitOf,
	commitsBetween,
	currentBranch,
	git,
	headSha,
	worktreeRoots,
} from '../queries.ts';

const scratch = scratchDirs();

let root = '';

let restore = () => {};

const commit = (text: string): string => {
	writeFileSync(join(root, 'README'), `${text}\n`);
	gitSync(root, 'add', 'README');
	gitSync(root, 'commit', '-q', '-m', text);
	return gitSync(root, 'rev-parse', 'HEAD');
};

beforeEach(() => {
	restore = isolateGit();
	root = scratch.make();
	writeFileSync(join(root, 'README'), 'one\n');
	initRepo(root);
});

afterEach(() => {
	restore();
	scratch.clean();
});

describe('git', () => {
	test("answers git's stdout trimmed, or a Failure naming the args, the root and stderr", async () => {
		expect(await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
			'main',
		);
		await expect(git(root, ['rev-parse', 'nope'])).rejects.toThrow(
			new RegExp(`^git rev-parse nope failed in ${root}: fatal: `),
		);
	});

	test('reads the head, the branch and the tree', async () => {
		expect(await headSha(root)).toBe(
			gitSync(root, 'rev-parse', 'HEAD'),
		);
		expect(await currentBranch(root)).toBe('main');
		expect(await cleanTree(root)).toBe(true);
		writeFileSync(join(root, 'README'), 'two\n');
		expect(await cleanTree(root)).toBe(false);
		gitSync(root, 'add', 'README');
		expect(await cleanTree(root)).toBe(false);
		gitSync(root, 'commit', '-q', '-m', 'two');
		expect(await cleanTree(root)).toBe(true);
		writeFileSync(join(root, 'stray'), 'x\n');
		expect(await cleanTree(root)).toBe(false);
		gitSync(root, 'checkout', '-q', '-b', 'fix');
		expect(await currentBranch(root)).toBe('fix');
	});

	test('reads a detached HEAD as on no branch', async () => {
		gitSync(root, 'checkout', '-q', '--detach');
		expect(await currentBranch(root)).toBeUndefined();
	});

	test('reads the commits between two, and whether one exists', async () => {
		const one = await headSha(root);
		const two = commit('two');
		expect(await commitExists(root, one.slice(0, 7))).toBe(true);
		expect(await commitExists(root, '0000000')).toBe(false);
		expect(await commitsBetween(root, one, two)).toEqual([
			`${two.slice(0, 7)} two`,
		]);
		expect(await commitsBetween(root, two, two)).toEqual([]);
	});

	test('fails outside a repository', async () => {
		const bare = scratch.make();
		for (const read of [headSha, currentBranch, cleanTree]) {
			const failure = read(bare);
			await expect(failure).rejects.toBeInstanceOf(Failure);
			await expect(failure).rejects.toThrow(/not a git repository/);
		}
	});

	test('resolves an abbreviation among objects alone, never a ref', async () => {
		const one = await headSha(root);
		const short = one.slice(0, 7);
		expect(await commitOf(root, short)).toBe(one);
		expect(await commitOf(root, '0000000')).toBeUndefined();
		const two = commit('two');
		gitSync(root, 'tag', short, two);
		expect(gitSync(root, 'rev-parse', `${short}^{commit}`)).toBe(two);
		expect(await commitOf(root, short)).toBe(one);
		const blob = gitSync(root, 'rev-parse', `${two}:README`);
		expect(await commitOf(root, blob.slice(0, 7))).toBeUndefined();
	});

	test('lists the files under pathspecs that changed since a commit', async () => {
		const one = await headSha(root);
		const two = commit('two');
		expect(await changedSince(root, one, ['README'])).toEqual([
			'README',
		]);
		expect(await changedSince(root, two, ['README'])).toEqual([]);
		writeFileSync(join(root, 'README'), 'three\n');
		expect(await changedSince(root, two, ['README'])).toEqual([
			'README',
		]);
		expect(await changedSince(root, two, ['envs/*'])).toEqual([]);
	});

	test("lists every worktree's root, the primary first", async () => {
		const linked = join(scratch.make(), 'linked');
		gitSync(root, 'worktree', 'add', '-q', '--detach', linked, 'HEAD');
		expect(await worktreeRoots(root)).toEqual([root, linked]);
		expect(await worktreeRoots(linked)).toEqual([root, linked]);
	});
});
