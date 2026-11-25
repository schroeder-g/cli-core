import { afterEach, describe, expect, test } from 'bun:test';
import {
	mkdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { Refusal } from '../../core/errors.ts';
import { gitSync, initRepo, scratchDirs } from '../../testing/index.ts';
import { findRoot, isLinkedWorktree } from '../root.ts';

const ROOT_SOURCE = resolve(import.meta.dir, '..', 'root.ts');

const IMPORT_SPECIFIERS = /from '([^']+)'/g;

const scratch = scratchDirs();

afterEach(() => {
	scratch.clean();
});

/**
 * A repository with a linked worktree beside it, a subdirectory in
 * each.
 */
const repoAndWorktree = (): { repo: string; worktree: string } => {
	const repo = scratch.make();
	mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
	writeFileSync(join(repo, 'src', 'deep', 'file'), 'x\n');
	initRepo(repo);
	const worktree = join(scratch.make(), 'linked');
	gitSync(repo, 'worktree', 'add', '-q', '--detach', worktree, 'HEAD');
	return { repo, worktree };
};

describe('findRoot', () => {
	test('walks up to the nearest .git, a directory in a clone or a file in a worktree', () => {
		const { repo, worktree } = repoAndWorktree();
		expect(findRoot(join(repo, 'src', 'deep'))).toBe(repo);
		expect(findRoot(repo)).toBe(repo);
		expect(findRoot(join(worktree, 'src', 'deep'))).toBe(worktree);
	});

	test('gives one root to two spellings of a path', () => {
		const { repo } = repoAndWorktree();
		const link = join(scratch.make(), 'link');
		symlinkSync(repo, link);
		expect(findRoot(join(link, 'src'))).toBe(repo);
		expect(findRoot(join(repo, 'src', '..', 'src'))).toBe(repo);
	});

	test('refuses a directory no marker encloses', () => {
		const bare = scratch.make();
		expect(() => findRoot(bare)).toThrow(
			new Refusal(`no git checkout encloses ${bare}`),
		);
		expect(() =>
			findRoot(bare, { marker: 'nothing-holds-this' }),
		).toThrow(
			new Refusal(
				`no directory up from ${bare} holds nothing-holds-this`,
			),
		);
	});

	test("refuses what the program's acceptance refuses", () => {
		const { repo } = repoAndWorktree();

		const accept = (dir: string) =>
			dir === repo ? `${dir} is not this program's` : undefined;

		expect(() => findRoot(join(repo, 'src'), { accept })).toThrow(
			new Refusal(`${repo} is not this program's`),
		);
		expect(findRoot(repo, { accept: () => undefined })).toBe(repo);
	});

	test('walks to another marker, and refuses a root another user owns unless told not to', () => {
		const { repo } = repoAndWorktree();
		writeFileSync(join(repo, 'src', 'marker.toml'), '');
		expect(
			findRoot(join(repo, 'src', 'deep'), { marker: 'marker.toml' }),
		).toBe(join(repo, 'src'));
		if (process.getuid?.() === 0) return;
		expect(() => findRoot('/', { marker: 'usr' })).toThrow(
			new Refusal('/ belongs to another user'),
		);
		expect(findRoot('/', { marker: 'usr', owned: false })).toBe('/');
	});

	test('runs nothing: the module reaches only the file system and paths', () => {
		const source = readFileSync(ROOT_SOURCE, 'utf8');
		const imports = [...source.matchAll(IMPORT_SPECIFIERS)].map(
			m => m[1] ?? '',
		);
		expect(imports.sort((a, b) => a.localeCompare(b))).toEqual([
			'../core/errors.ts',
			'node:fs',
			'node:path',
		]);
		expect(source).not.toMatch(/Bun\.|child_process|\$`/);
	});
});

describe('isLinkedWorktree', () => {
	test('tells a linked worktree from the primary checkout', () => {
		const { repo, worktree } = repoAndWorktree();
		expect(isLinkedWorktree(worktree)).toBe(true);
		expect(isLinkedWorktree(repo)).toBe(false);
		expect(isLinkedWorktree(scratch.make())).toBe(false);
	});
});
