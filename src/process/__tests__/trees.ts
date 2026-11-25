import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Step } from '../../core/plan.ts';
import { capture } from '../spawn.ts';

/** How long a test waits on a child to come up or go. */
export const SETTLE_MS = 10_000;

export const listener = (port: number, trap = ''): string =>
	`${trap} Bun.serve({ hostname: '127.0.0.1', port: ${port}, fetch: () => new Response('ok') });`;

/**
 * A process as a dev server is: a leader whose child holds the port,
 * so signalling the leader alone leaves the listener up. The leader
 * writes its pid to `pidFile`; `trap` runs first in both.
 */
export const tree = (
	title: string,
	pidFile: string,
	port: number,
	trap = '',
): Step => ({
	title,
	cwd: '.',
	argv: [
		'bun',
		'-e',
		`${trap}
		require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
		const child = Bun.spawn(['bun', '-e', ${JSON.stringify(listener(port, trap))}], { stdout: 'inherit', stderr: 'inherit' });
		await child.exited;`,
	],
});

export const pidIn = (file: string): number =>
	Number(readFileSync(file, 'utf8'));

export const pidFileIn = (dir: string, name: string): string =>
	join(dir, `${name}.pid`);

/**
 * The pids among `pids` that live, from one `ps`; a named column, since
 * the default TIME column needs an entitlement on macOS.
 */
export async function live(pids: readonly number[]): Promise<number[]> {
	const { stdout } = await capture([
		'ps',
		'-o',
		'pid=',
		'-p',
		pids.join(','),
	]);
	return stdout
		.split('\n')
		.map(line => Number(line.trim()))
		.filter(pid => pid > 0);
}
