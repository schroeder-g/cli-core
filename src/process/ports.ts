import { createConnection } from 'node:net';

import { retry } from 'es-toolkit/function';

import { Failure } from '../core/errors.ts';
import { capture, SpawnFailure } from './spawn.ts';

/** The loopback every local server binds. */
export const LOCAL_HOST = '127.0.0.1';

const POLL_MS = 100;

const CONNECT_TIMEOUT_MS = 1_000;

export interface PortHolder {
	readonly pid: number;
	readonly command: string;
}

/** A subject whose port a process holds. */
export interface BusyPort<T> extends PortHolder {
	readonly subject: T;
}

/** A check that answered false: retried, and false once the time is up. */
class NotYet extends Error {}

/**
 * Polls `check` every 100 ms until it answers true; false once
 * `timeoutMs` has passed without one, or `signal` called it off.
 */
export async function until(
	check: () => boolean | Promise<boolean>,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<boolean> {
	// retry() throws its own error for a signal aborted before the first
	// attempt, where no NotYet tells the two apart.
	if (signal?.aborted === true) return false;
	try {
		await retry(
			async () => {
				if (!(await check())) throw new NotYet();
			},
			{
				delay: POLL_MS,
				signal:
					signal === undefined
						? AbortSignal.timeout(timeoutMs)
						: AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]),
				shouldRetry: error => error instanceof NotYet,
			},
		);
		return true;
	} catch (error) {
		if (error instanceof NotYet) return false;
		throw error;
	}
}

// lsof -F pc prints one `p<pid>` line, then one `c<command>` line, per
// process; the first pair is the listener.
const parseHolder = (output: string): PortHolder | undefined => {
	const lines = output.split('\n');
	const pidAt = lines.findIndex(line => line.startsWith('p'));
	const pid = Number(lines[pidAt]?.slice(1));
	if (pidAt < 0 || !Number.isInteger(pid)) return undefined;
	const command = lines
		.slice(pidAt + 1)
		.find(line => line.startsWith('c'));
	return { pid, command: command?.slice(1) ?? '' };
};

/**
 * The process listening on `port`, from `lsof`; undefined when nothing
 * listens. A machine without `lsof` cannot answer, which is a Failure.
 */
export async function portHolder(
	port: number,
): Promise<PortHolder | undefined> {
	const { code, stdout } = await capture([
		'lsof',
		'-nP',
		`-iTCP:${port}`,
		'-sTCP:LISTEN',
		'-Fpc',
	]).catch((error: unknown) => {
		if (!(error instanceof SpawnFailure)) throw error;
		throw new Failure(
			`cannot tell whether port ${port} is busy: ${error.message}`,
		);
	});
	return code === 0 ? parseHolder(stdout) : undefined;
}

/** The subjects whose port someone holds, every port probed at once. */
export async function busyPorts<T>(
	subjects: readonly T[],
	portOf: (subject: T) => number,
): Promise<BusyPort<T>[]> {
	const holders = await Promise.all(
		subjects.map(subject => portHolder(portOf(subject))),
	);
	return subjects.flatMap((subject, i) => {
		const holder = holders[i];
		return holder === undefined ? [] : [{ subject, ...holder }];
	});
}

const connects = (port: number): Promise<boolean> =>
	new Promise(resolve => {
		const socket = createConnection({ host: LOCAL_HOST, port });
		socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy());
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('close', () => resolve(false));
		socket.once('error', () => resolve(false));
	});

/**
 * Waits until a TCP connect to the loopback at `port` succeeds; false
 * when `timeoutMs` passes first.
 */
export function waitForPort(
	port: number,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<boolean> {
	return until(() => connects(port), timeoutMs, signal);
}

/** Whether something answers on the loopback at `port` right now. */
export const answering = (port: number): Promise<boolean> =>
	connects(port);

/** The process group `pid` belongs to, from `ps`; none once it is gone. */
export async function groupOf(
	pid: number,
): Promise<number | undefined> {
	const { code, stdout } = await capture([
		'ps',
		'-o',
		'pgid=',
		'-p',
		String(pid),
	]);
	const group = Number(stdout.trim());
	return code === 0 && Number.isInteger(group) && group > 0
		? group
		: undefined;
}
