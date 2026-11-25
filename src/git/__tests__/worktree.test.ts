import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Refusal } from '../../core/errors.ts';
import { runPlan } from '../../process/run.ts';
import {
	gitSync,
	initRepo,
	isolateGit,
	scratchDirs,
	testContext,
} from '../../testing/index.ts';
import { currentBranch, headSha } from '../queries.ts';
import { scratchWorktree } from '../worktree.ts';

const PATH = '.state/build/abc';

const OWNER = 'tool';

const scratch = scratchDirs();

let root = '';

let restore = () => {};

const lockedAs = (reason: string) => {
	gitSync(root, 'worktree', 'unlock', PATH);
	gitSync(root, 'worktree', 'lock', '--reason', reason, PATH);
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

describe('scratchWorktree', () => {
	test('adds a detached worktree locked to this run, and removes only that', async () => {
		const sha = await headSha(root);
		const { path, add, remove } = scratchWorktree(root, PATH, sha, {
			owner: OWNER,
		});
		const reason = `${OWNER} ${process.pid}`;
		expect(path).toBe(PATH);
		expect(add).toMatchObject({
			title: `add a worktree of ${sha.slice(0, 7)} at ${PATH}`,
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
				PATH,
				sha,
			],
		});
		expect(remove).toMatchObject({
			title: `remove the worktree at ${PATH}`,
			cwd: root,
			argv: [
				'git',
				'worktree',
				'remove',
				'--force',
				'--force',
				'--',
				PATH,
			],
			unless: { describe: `no worktree of this run is at ${PATH}` },
		});
		const ctx = testContext(root);
		expect(await remove.unless?.check()).toBe(true);
		expect(await runPlan({ steps: [add] }, ctx)).toBe(0);
		expect(existsSync(join(root, PATH, 'README'))).toBe(true);
		expect(await headSha(join(root, PATH))).toBe(sha);
		expect(await currentBranch(join(root, PATH))).toBeUndefined();
		expect(await remove.unless?.check()).toBe(false);
		lockedAs(`${OWNER} 1`);
		expect(await remove.unless?.check()).toBe(true);
		expect(await runPlan({ steps: [remove] }, ctx)).toBe(0);
		expect(existsSync(join(root, PATH))).toBe(true);
		lockedAs(reason);
		writeFileSync(join(root, PATH, 'untracked'), 'x\n');
		expect(await runPlan({ steps: [remove] }, ctx)).toBe(0);
		expect(existsSync(join(root, PATH))).toBe(false);
	});

	test('removes the worktree when the plan fails after adding it', async () => {
		const sha = await headSha(root);
		const { add, remove } = scratchWorktree(root, PATH, sha, {
			owner: OWNER,
		});
		const failing = { title: 'fails', cwd: PATH, argv: ['false'] };
		const code = await runPlan(
			{ steps: [add, failing], finally: [remove] },
			testContext(root),
		);
		expect(code).toBe(1);
		expect(existsSync(join(root, PATH))).toBe(false);
	});

	test('refuses a path that exists already, from a run in progress or one killed', () => {
		mkdirSync(join(root, PATH), { recursive: true });
		expect(() =>
			scratchWorktree(root, PATH, 'HEAD', { owner: OWNER }),
		).toThrow(
			new Refusal(
				`a worktree is at ${PATH}, from a run in progress or one that was killed; once no run holds it, remove it with git worktree remove --force --force ${PATH}`,
			),
		);
	});

	test('names a ref, a placeholder or a short id as given', () => {
		for (const commit of ['<staging commit>', 'release/1.2', 'abc1234'])
			expect(
				scratchWorktree(root, PATH, commit, { owner: OWNER }).add.title,
			).toBe(`add a worktree of ${commit} at ${PATH}`);
	});
});
