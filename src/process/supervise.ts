import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { Failure } from '../core/errors.ts';
import { INTERRUPTED } from '../core/exit.ts';
import { log } from '../core/logging.ts';
import type { Step } from '../core/plan.ts';
import type { OutputStreams } from '../core/streams.ts';
import { stopGroup } from './group.ts';
import { standings } from './identity.ts';
import type { ProcessRecord, Standing } from './identity.ts';
import { awaitListening } from './listening.ts';
import { LOCAL_HOST } from './ports.ts';
import type { RecordFile, Unstamped } from './records.ts';
import { onSignals, signalGroup } from './signals.ts';
import { spawnChild } from './spawn.ts';
import type { ChildHandle } from './spawn.ts';

/** How long a launched process with a port gets to answer, by default. */
const READY_MS = 120_000;

/** A process a supervisor starts, in a process group of its own. */
export interface Supervised {
	/** What its prefixed lines, its record and the logs call it. */
	readonly name: string;
	readonly step: Step;
	/** The loopback port it listens on once it is up, if it serves one. */
	readonly port?: number;
}

export interface ForegroundOptions {
	/** How long each group gets after the signal before SIGKILL. */
	readonly graceMs?: number;
	/** Where the prefixed lines go; the process's own by default. */
	readonly streams?: OutputStreams;
	/** What a relative `cwd` resolves against. */
	readonly root?: string;
}

export interface DetachedOptions<
	P extends Supervised,
	R extends ProcessRecord,
> {
	/** Where each process is recorded once it runs. */
	readonly records: RecordFile<R>;
	/** The file a process's output is appended to. */
	readonly logFile: (proc: P) => string;
	/**
	 * The record of a process now running as `pid`, logging to
	 * `logFile`, the start time aside, which the record file reads.
	 */
	readonly record: (
		proc: P,
		pid: number,
		logFile: string,
	) => Unstamped<R>;
	/**
	 * Runs before each launch, its log's directory made: to rotate the
	 * log, say, or mark the run in it.
	 */
	readonly beforeLaunch?: (proc: P, logFile: string) => void;
	/** How long a process with a port gets to answer; 120 s by default. */
	readonly readyMs?: number;
	/**
	 * What ends the processes left running, in the program's words, as
	 * the notices and refusals end: `nt stop ends them`.
	 */
	readonly stopHint?: string;
	readonly streams?: OutputStreams;
	readonly root?: string;
}

export interface RecordedStop {
	/** The names to stop; every record by default. */
	readonly only?: readonly string[];
	readonly graceMs?: number;
}

interface Running {
	readonly proc: Supervised;
	readonly child: ChildHandle;
}

interface Interrupted {
	readonly signal: NodeJS.Signals;
}

interface Unanswered {
	readonly reason: string;
}

const stopAll = (
	running: readonly Running[],
	graceMs: number | undefined,
	signal: NodeJS.Signals = 'SIGTERM',
) =>
	Promise.all(
		running.map(({ proc, child }) =>
			stopGroup(child.pid, { name: proc.name, signal, graceMs }),
		),
	);

const startingLine = (proc: Supervised, pid: number): void => {
	if (proc.port === undefined)
		log.info('starting {name}, pid {pid}', { name: proc.name, pid });
	else
		log.info('starting {name} on http://{host}:{port}, pid {pid}', {
			name: proc.name,
			host: LOCAL_HOST,
			port: proc.port,
			pid,
		});
};

/**
 * Runs the processes in the foreground, each in its own process group
 * with its lines prefixed `[name]`. SIGINT, SIGTERM or SIGHUP is
 * forwarded to those groups alone, each gets the grace before SIGKILL,
 * a repeated signal kills them at once, and the run answers 130 once
 * they are gone. The first to exit by itself stops the others, and the
 * run answers its code. A process that cannot start stops those
 * already started, and its error is thrown.
 */
export async function supervise(
	processes: readonly Supervised[],
	{ graceMs, streams, root }: ForegroundOptions = {},
): Promise<number> {
	const running: Running[] = [];
	let received: NodeJS.Signals | undefined;
	let stopping: Promise<unknown> = Promise.resolve();

	const onSignal = (signal: NodeJS.Signals) => {
		if (received !== undefined) {
			log.warning('{signal} again; killing the processes now', {
				signal,
			});
			for (const { child } of running)
				signalGroup(child.pid, 'SIGKILL');
			return;
		}
		received = signal;
		log.info('{signal} received; stopping the processes', { signal });
		stopping = stopAll(running, graceMs, signal);
	};

	const release = onSignals(onSignal);
	try {
		for (const proc of processes) {
			if (received !== undefined) break;
			let child: ChildHandle;
			try {
				child = await spawnChild(proc.step, {
					detached: true,
					output: { prefix: proc.name },
					root,
					streams,
				});
			} catch (error) {
				await stopAll(running, graceMs);
				throw error;
			}
			startingLine(proc, child.pid);
			running.push({ proc, child });
		}
		if (received !== undefined) {
			await stopping;
			await stopAll(running, graceMs);
			await Promise.all(running.map(({ child }) => child.exited));
			return INTERRUPTED;
		}
		const first = await Promise.race(
			running.map(async ({ proc, child }) => ({
				proc,
				code: await child.exited,
			})),
		);
		if (received === undefined) {
			log.warning('{name} exited with {code}; stopping the others', {
				name: first.proc.name,
				code: first.code,
			});
			await stopAll(running, graceMs);
		} else await stopping;
		await Promise.all(running.map(({ child }) => child.exited));
		return received === undefined ? first.code : INTERRUPTED;
	} finally {
		release();
	}
}

/**
 * Resolves once the process answers on its port, with the reason when
 * it cannot: it exited first, or the wait ran out. One with no port is
 * taken as up.
 */
async function answering(
	{ proc, child }: Running,
	logFile: string,
	readyMs: number,
): Promise<Unanswered | undefined> {
	const { name, port } = proc;
	if (port === undefined) return undefined;
	const outcome = await awaitListening(child, port, readyMs);
	if (outcome.kind === 'exited')
		return {
			reason: `${name} exited with ${outcome.code} before answering on port ${port}; its log is ${logFile}`,
		};
	if (outcome.kind === 'silent')
		return {
			reason: `${name} did not answer on port ${port} within ${readyMs / 1000} s; its log is ${logFile}`,
		};
	log.info(
		'{name} answers on http://{host}:{port}, pid {pid}, log {log}',
		{ name, host: LOCAL_HOST, port, pid: child.pid, log: logFile },
	);
	return undefined;
}

/**
 * Launches the processes to outlive the program: each in its own
 * process group, its output appended to its log file, recorded with
 * its start time the moment it runs, beside the live records of an
 * earlier launch. Answers 0 once every port answers, 130 when a signal
 * arrives while it waits, with the processes left running. A process
 * that cannot start, gives no start time, or exits or stays silent
 * before it answers is a Failure naming those still running, recorded.
 */
export async function launchDetached<
	P extends Supervised,
	R extends ProcessRecord,
>(
	processes: readonly P[],
	{
		records,
		logFile,
		record,
		beforeLaunch,
		readyMs = READY_MS,
		stopHint,
		streams,
		root,
	}: DetachedOptions<P, R>,
): Promise<number> {
	const recorded = await records.live();
	const started: {
		readonly running: Running;
		readonly file: string;
	}[] = [];
	const hint = stopHint === undefined ? '' : `; ${stopHint}`;

	const stillRunning = (except?: number): string => {
		const left = recorded.filter(({ pid }) => pid !== except);
		return left.length === 0
			? ''
			: `; still running, recorded in ${records.path}: ${records.describe(left)}${hint}`;
	};

	const { promise: signalled, resolve: signalledBy } =
		Promise.withResolvers<Interrupted>();
	const release = onSignals(signal => signalledBy({ signal }));
	try {
		for (const proc of processes) {
			const file = logFile(proc);
			let child: ChildHandle;
			try {
				mkdirSync(dirname(file), { recursive: true });
				beforeLaunch?.(proc, file);
				child = await spawnChild(proc.step, {
					detached: true,
					output: { logFile: file },
					root,
					streams,
				});
			} catch (error) {
				if (!(error instanceof Error)) throw error;
				throw new Failure(`${error.message}${stillRunning()}`, {
					cause: error,
				});
			}
			started.push({ running: { proc, child }, file });
			const [entry] = await records.add([
				record(proc, child.pid, file),
			]);
			if (entry === undefined) {
				await stopGroup(child.pid, { name: proc.name });
				throw new Failure(
					`${proc.name} (pid ${child.pid}) gave no start time, so it was stopped rather than recorded${stillRunning()}`,
				);
			}
			recorded.push(entry);
		}
		for (const { running, file } of started) {
			const outcome = await Promise.race([
				answering(running, file, readyMs),
				signalled,
			]);
			if (outcome === undefined) continue;
			if ('signal' in outcome) {
				log.warning(
					'{signal} received while waiting; {count} processes keep running, recorded in {file}{hint}',
					{
						signal: outcome.signal,
						count: recorded.length,
						file: records.path,
						hint,
					},
				);
				return INTERRUPTED;
			}
			throw new Failure(
				`${outcome.reason}${stillRunning(running.child.pid)}`,
			);
		}
	} finally {
		release();
		for (const { running } of started) running.child.release();
	}
	log.info('{count} processes running, recorded in {file}{hint}', {
		count: recorded.length,
		file: records.path,
		hint,
	});
	return 0;
}

/**
 * Stops the processes `records` holds, every one or those named in
 * `only`, and removes them from the record. A group is signalled while
 * its leader still carries the recorded start time, or while it
 * outlives its leader; a pid another process has taken is never
 * signalled.
 */
export async function stopRecorded<R extends ProcessRecord>(
	records: RecordFile<R>,
	{ only, graceMs }: RecordedStop = {},
): Promise<void> {
	const { nameOf } = records;
	const chosen = records
		.read()
		.filter(
			record => only === undefined || only.includes(nameOf(record)),
		);
	if (chosen.length === 0) {
		log.info(
			only === undefined
				? 'nothing is recorded in {file}'
				: 'none of {only} is recorded in {file}',
			{ file: records.path, only: only?.join(', ') },
		);
		return;
	}

	const stop = (record: R, standing: Standing): Promise<void> => {
		const name = nameOf(record);
		const { pid } = record;
		if (standing === 'reused') {
			log.warning(
				'pid {pid} is no longer the {name} recorded; skipping',
				{ pid, name },
			);
			return Promise.resolve();
		}
		if (standing === 'gone') {
			log.info('{name} (pid {pid}) is already gone', { name, pid });
			return Promise.resolve();
		}
		log.info('stopping {name} (pid {pid})', { name, pid });
		return stopGroup(pid, { name, graceMs });
	};

	await Promise.all(
		(await standings(chosen)).map(({ record, standing }) =>
			stop(record, standing),
		),
	);
	records.forget(chosen.map(nameOf));
}
