import { groupAlive } from './signals.ts';
import { capture } from './spawn.ts';

// ps prints lstart in the shell's zone and locale; both are pinned so a
// stop from another shell reads the text a start recorded.
const START_TIME = [
	'env',
	'TZ=UTC',
	'LC_ALL=C',
	'ps',
	'-o',
	'pid=,lstart=',
	'-p',
];

const START_TIME_LINE = /^\s*(\d+)\s+(.*?)\s*$/;

/**
 * A process a program started and may signal later: its pid, which
 * leads its process group, and the start time that pid carried then.
 */
export interface ProcessRecord {
	readonly pid: number;
	readonly startedAt: string;
}

/**
 * What a recorded process has become: still running; its leader gone
 * while its group lives on; its pid taken by another process; or gone.
 */
export type Standing = 'running' | 'leaderless' | 'reused' | 'gone';

/**
 * Each live process's start time as `ps` prints it, by pid: what a pid
 * is matched against before its group is signalled, so a reused pid is
 * never taken for the one recorded. One `ps` serves every pid; a pid
 * that is gone is absent.
 */
export async function startTimes(
	pids: readonly number[],
): Promise<ReadonlyMap<number, string>> {
	const times = new Map<number, string>();
	if (pids.length === 0) return times;
	const { stdout } = await capture([...START_TIME, pids.join(',')]);
	for (const line of stdout.split('\n')) {
		const found = START_TIME_LINE.exec(line);
		if (found && found[2] !== '')
			times.set(Number(found[1]), found[2] ?? '');
	}
	return times;
}

/** Each record's standing, judged by one `ps`. */
export async function standings<R extends ProcessRecord>(
	records: readonly R[],
): Promise<{ readonly record: R; readonly standing: Standing }[]> {
	const times = await startTimes(records.map(record => record.pid));

	const standing = (record: R): Standing => {
		const now = times.get(record.pid);
		if (now === record.startedAt) return 'running';
		if (now !== undefined) return 'reused';
		return groupAlive(record.pid) ? 'leaderless' : 'gone';
	};

	return records.map(record => ({
		record,
		standing: standing(record),
	}));
}
