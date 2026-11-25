import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The git config a scratch repository reads: none of the developer's,
 * so no signing, hook or default branch rule reaches a test.
 */
export const ISOLATED_GIT: Readonly<Record<string, string>> = {
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1',
};

const SCRATCH_PREFIX = 'cli-scratch-';

/** The temporary directories a suite makes, removed together. */
export interface ScratchDirs {
	make(prefix?: string): string;
	clean(): void;
}

/**
 * A canonical temporary directory no checkout encloses, so a walk up
 * from it finds no `.git`; it throws when the temporary directory sits
 * inside one.
 */
export function freshScratch(prefix = SCRATCH_PREFIX): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	for (let d = dirname(dir); dirname(d) !== d; d = dirname(d))
		if (existsSync(join(d, '.git'))) {
			rmSync(dir, { recursive: true, force: true });
			throw new Error(
				`${d} is a checkout; a scratch directory must not be inside one`,
			);
		}
	return dir;
}

/** A registry of `freshScratch` directories, for an `afterEach`. */
export function scratchDirs(): ScratchDirs {
	const made: string[] = [];
	return {
		make: prefix => {
			const dir = freshScratch(prefix);
			made.push(dir);
			return dir;
		},
		clean: () => {
			for (const dir of made.splice(0))
				rmSync(dir, { recursive: true, force: true });
		},
	};
}

/**
 * Sets `ISOLATED_GIT` on the process, for the code under test that
 * runs git; the restore puts back what was there.
 */
export function isolateGit(): () => void {
	const saved = Object.keys(ISOLATED_GIT).map(
		name => [name, process.env[name]] as const,
	);
	Object.assign(process.env, ISOLATED_GIT);
	return () => {
		for (const [name, value] of saved)
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
	};
}

/**
 * git in `cwd` under `ISOLATED_GIT`, synchronously: its stdout trimmed,
 * or an Error carrying its stderr.
 */
export function gitSync(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(['git', '-C', cwd, ...args], {
		env: { ...process.env, ...ISOLATED_GIT },
	});
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

/**
 * `dir` made a repository on `branch` whose one commit holds whatever
 * `dir` holds; answers that commit.
 */
export function initRepo(
	dir: string,
	{ branch = 'main', message = 'one' } = {},
): string {
	gitSync(dir, 'init', '-q', '-b', branch);
	gitSync(dir, 'config', 'user.email', 'cli-core@example.test');
	gitSync(dir, 'config', 'user.name', 'cli-core');
	gitSync(dir, 'add', '-A');
	gitSync(dir, 'commit', '-q', '--allow-empty', '-m', message);
	return gitSync(dir, 'rev-parse', 'HEAD');
}
