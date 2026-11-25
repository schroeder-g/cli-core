import { log } from '../core/logging.ts';
import { until } from './ports.ts';
import { groupAlive, signalGroup } from './signals.ts';

/** How long a signalled group gets before SIGKILL, by default. */
const GRACE_MS = 10_000;

/** How long a killed group gets to disappear before it is given up on. */
const KILL_WAIT_MS = 2_000;

export interface GroupStop {
	/** What the warnings call the group. */
	readonly name: string;
	/** The signal sent first; SIGTERM by default. */
	readonly signal?: NodeJS.Signals;
	/** How long every member gets to go before SIGKILL; 10 s by default. */
	readonly graceMs?: number;
}

/**
 * Signals the process group `pgid`, waits up to the grace for every
 * member to go, then kills what remains, warning that it did, and
 * again when even SIGKILL leaves one. A group already gone answers at
 * once.
 */
export async function stopGroup(
	pgid: number,
	{ name, signal = 'SIGTERM', graceMs = GRACE_MS }: GroupStop,
): Promise<void> {
	if (!signalGroup(pgid, signal)) return;
	if (await until(() => !groupAlive(pgid), graceMs)) return;
	log.warning(
		'{name} outlived the {seconds} s grace; killing its process group',
		{ name, seconds: graceMs / 1000 },
	);
	signalGroup(pgid, 'SIGKILL');
	if (!(await until(() => !groupAlive(pgid), KILL_WAIT_MS)))
		log.warning('{name} (process group {pgid}) survived SIGKILL', {
			name,
			pgid,
		});
}
