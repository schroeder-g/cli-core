import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Refusal } from '../../core/errors.ts';
import {
	gitSync,
	initRepo,
	isolateGit,
	scratchDirs,
} from '../../testing/index.ts';
import { ANY_BRANCH, assertGate, gateVerdict } from '../gate.ts';
import type { BranchGate } from '../gate.ts';

const MAIN_CLEAN: BranchGate = { branches: ['main'], cleanTree: true };

const ANY_CLEAN: BranchGate = {
	branches: [ANY_BRANCH],
	cleanTree: true,
};

const SUBJECT = 'release runs';

const scratch = scratchDirs();

describe('gateVerdict', () => {
	test('admits a listed branch, any branch under the wildcard', () => {
		expect(
			gateVerdict(SUBJECT, MAIN_CLEAN, { branch: 'main', clean: true }),
		).toEqual({ branch: 'main' });
		expect(
			gateVerdict(SUBJECT, ANY_CLEAN, { branch: 'fix/x', clean: true }),
		).toEqual({ branch: 'fix/x' });
		expect(
			gateVerdict(
				SUBJECT,
				{ branches: ['main', 'next'], cleanTree: false },
				{ branch: 'next', clean: false },
			),
		).toEqual({ branch: 'next' });
	});

	test('refuses a detached HEAD, then the branch, then the tree', () => {
		for (const gate of [MAIN_CLEAN, ANY_CLEAN])
			expect(
				gateVerdict(SUBJECT, gate, { branch: undefined, clean: false }),
			).toEqual({
				refusal: expect.stringMatching(
					/^release runs .*; HEAD is detached, on no branch$/,
				),
			});
		expect(
			gateVerdict(SUBJECT, MAIN_CLEAN, {
				branch: 'fix/x',
				clean: false,
			}),
		).toEqual({
			refusal:
				'release runs only from main with a clean tree, not from fix/x',
		});
		expect(
			gateVerdict(SUBJECT, ANY_CLEAN, {
				branch: 'fix/x',
				clean: false,
			}),
		).toEqual({
			refusal:
				'release runs from any branch with a clean tree; fix/x has uncommitted or untracked files (git status --porcelain)',
		});
		expect(
			gateVerdict(
				SUBJECT,
				{ branches: ['main', 'next'], cleanTree: false },
				{ branch: 'fix', clean: true },
			),
		).toEqual({
			refusal: 'release runs only from main or next, not from fix',
		});
	});
});

describe('assertGate', () => {
	let root = '';

	let restore = () => {};

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

	test("answers the branch the checkout's state passes, or refuses at the root", async () => {
		expect(await assertGate(root, SUBJECT, MAIN_CLEAN)).toBe('main');
		writeFileSync(join(root, 'stray'), 'x\n');
		await expect(assertGate(root, SUBJECT, MAIN_CLEAN)).rejects.toThrow(
			new Refusal(
				`release runs only from main with a clean tree; main has uncommitted or untracked files (git status --porcelain), at ${root}`,
			),
		);
		gitSync(root, 'checkout', '-q', '--detach');
		await expect(assertGate(root, SUBJECT, MAIN_CLEAN)).rejects.toThrow(
			'HEAD is detached',
		);
	});
});
