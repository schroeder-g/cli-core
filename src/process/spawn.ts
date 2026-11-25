import { once } from 'node:events';
import {
	closeSync,
	constants as fs,
	existsSync,
	openSync,
} from 'node:fs';
import { resolve } from 'node:path';

import { Failure, codeOf } from '../core/errors.ts';
import { CANNOT_SPAWN, signalExit } from '../core/exit.ts';
import { isSecret } from '../core/plan.ts';
import type { Arg, Secret, Step } from '../core/plan.ts';
import type { OutputStream, OutputStreams } from '../core/streams.ts';
import { signalGroup } from './signals.ts';

/**
 * How a log is opened for writing: appended, created, never through a
 * link.
 */
export const LOG_OPEN_FLAGS =
	fs.O_WRONLY | fs.O_APPEND | fs.O_CREAT | fs.O_NOFOLLOW;

export const LOG_MODE = 0o600;

const SPAWN_REASONS: Readonly<Record<string, string>> = {
	ENOENT: 'not found on PATH',
	EACCES: 'not executable',
};

type Output = ReadableStream<Uint8Array>;

type Subprocess = Bun.Subprocess<
	Bun.SpawnOptions.Writable,
	Bun.SpawnOptions.Readable,
	Bun.SpawnOptions.Readable
>;

type Attached = 'inherit' | 'pipe' | number;

interface Stdio {
	readonly stdin: 'ignore' | 'inherit' | Blob;
	readonly stdout: Attached;
	readonly stderr: Attached;
}

interface Resolved {
	readonly argv: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

interface Writer {
	write(data: string | Uint8Array): Promise<void>;
	close(): void;
}

/**
 * Where a child's output goes when it is not forwarded: each line
 * prefixed on the program's own streams, or appended to a file,
 * relative to the step's `cwd`, that the child writes without passing
 * through the program.
 *
 * @public
 */
export type ChildOutput =
	| { readonly prefix: string }
	| { readonly logFile: string };

/**
 * `root` is what a relative `cwd` resolves against, the checkout root
 * under a plan; `streams` are where forwarded output goes and what the
 * terminal rule reads, the process's own when absent.
 *
 * @public
 */
export interface SpawnOptions {
	readonly detached?: boolean;
	readonly output?: ChildOutput;
	readonly root?: string;
	readonly streams?: OutputStreams;
}

/**
 * A running child. `exited` resolves with its code, `128 + n` for a
 * signal, once every piped byte has been forwarded, so a grandchild
 * that keeps the pipe open keeps it pending. `kill` signals the process
 * group when the child was `detached`, else the child alone, and does
 * nothing once it has gone. `release` lets the caller's event loop end
 * while a `detached` child lives: the process is unref'd and its piped
 * streams are cancelled, so nothing more of its output is forwarded;
 * on a child that is not `detached` it does nothing.
 *
 * @public
 */
export interface ChildHandle {
	readonly pid: number;
	readonly exited: Promise<number>;
	kill(signal: NodeJS.Signals): void;
	release(): void;
}

interface Relay {
	readonly drained: Promise<void>;
	cancel(): void;
}

// Bun declares two reader types that differ in `readMany`; this is the
// part the relay uses of either.
interface Reader {
	read(): Promise<{
		readonly done: boolean;
		readonly value?: Uint8Array;
	}>;
	cancel(): Promise<void>;
}

/** @public */
export interface CaptureResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

const QUIET: Stdio = {
	stdin: 'ignore',
	stdout: 'pipe',
	stderr: 'pipe',
};

/**
 * A program that could not start: exit 127, read from `code` by every
 * caller.
 *
 * @public
 */
export class SpawnFailure extends Failure {
	readonly code = CANNOT_SPAWN;

	constructor(program: string, reason: string) {
		super(`${program} could not start: ${reason}`);
	}
}

const shown = (arg: Arg): string => (isSecret(arg) ? arg.ref : arg);

const reasonOf = (error: unknown): string => {
	const code = codeOf(error) ?? 'failed';
	return SPAWN_REASONS[code] ?? code;
};

/**
 * Each distinct secret of a step read once, at the spawn, and every
 * value checked for a NUL byte, which neither an argument nor a
 * variable can carry and which the spawn error would otherwise quote.
 */
async function resolved(step: Step): Promise<Resolved> {
	const entries = Object.entries(step.env ?? {});
	const secrets = new Set(
		[...step.argv, ...entries.map(([, value]) => value)].filter(
			isSecret,
		),
	);
	const values = new Map<Secret, string>(
		await Promise.all(
			[...secrets].map(
				async secret => [secret, await secret.resolve()] as const,
			),
		),
	);

	const value = (arg: Arg, name: string): string => {
		const text = isSecret(arg) ? values.get(arg)! : arg;
		if (text.includes('\0'))
			throw new Failure(
				`${name} holds a NUL byte, which ${step.title} cannot pass on`,
			);
		return text;
	};

	return {
		argv: step.argv.map((arg, i) => value(arg, `argument ${i + 1}`)),
		env: Object.fromEntries(
			entries.map(([name, arg]) => [name, value(arg, name)]),
		),
	};
}

function start(
	{ argv, env }: Resolved,
	program: string,
	cwd: string,
	stdio: Stdio,
	detached = false,
): Subprocess {
	if (argv.length === 0) throw new Failure('a step names no program');
	if (!existsSync(cwd))
		throw new Failure(
			`${cwd} does not exist, so ${program} cannot run there`,
		);
	try {
		return Bun.spawn([...argv], {
			cwd,
			env: { ...process.env, ...env },
			detached,
			...stdio,
		});
	} catch (error) {
		throw new SpawnFailure(program, reasonOf(error));
	}
}

const exitCode = (proc: Subprocess, code: number): number => {
	const signal = proc.signalCode;
	return typeof signal === 'string' ? signalExit(signal) : code;
};

const attach = (stream: OutputStream): Attached =>
	stream.isTTY === true ? 'inherit' : 'pipe';

/** A piped stream of the child, as Bun typed it, without a cast. */
const pipeOf = (stream: unknown): Output | undefined =>
	stream instanceof ReadableStream ? (stream as Output) : undefined;

// A reader that closes early fails the write with EPIPE. From then on
// the child's output is read and dropped, so it never blocks on a full
// pipe, and the plan waits for it as it would have.
function writer(sink: OutputStream): Writer {
	let open = true;

	const failed = () => {
		open = false;
	};

	sink.on('error', failed);
	return {
		async write(data) {
			if (!open) return;
			try {
				if (!sink.write(data)) await once(sink, 'drain');
			} catch {
				open = false;
			}
		},
		close() {
			sink.off('error', failed);
		},
	};
}

// Read through a reader the relay keeps, so `release` can cancel a
// pending read; iterating the stream itself would lock it.
async function* chunksOf(reader: Reader): AsyncGenerator<Uint8Array> {
	for (;;) {
		const { done, value } = await reader.read();
		if (done || value === undefined) return;
		yield value;
	}
}

async function forward(
	output: AsyncIterable<Uint8Array>,
	out: Writer,
): Promise<void> {
	for await (const chunk of output) await out.write(chunk);
}

async function forwardLines(
	output: AsyncIterable<Uint8Array>,
	out: Writer,
	prefix: string,
): Promise<void> {
	const decoder = new TextDecoder();
	let rest = '';
	for await (const chunk of output) {
		const lines = (
			rest + decoder.decode(chunk, { stream: true })
		).split('\n');
		rest = lines.pop() ?? '';
		if (lines.length > 0)
			await out.write(
				lines.map(line => `[${prefix}] ${line}\n`).join(''),
			);
	}
	rest += decoder.decode();
	if (rest !== '') await out.write(`[${prefix}] ${rest}\n`);
}

function relay(
	proc: Subprocess,
	streams: OutputStreams,
	prefix?: string,
): Relay {
	const pairs = [
		[pipeOf(proc.stdout)?.getReader(), streams.stdout],
		[pipeOf(proc.stderr)?.getReader(), streams.stderr],
	] as const;
	const writers = pairs.map(([, sink]) => writer(sink));
	const drained = Promise.all(
		pairs.map(([reader], i) => {
			const out = writers[i]!;
			if (reader === undefined) return Promise.resolve();
			const chunks = chunksOf(reader);
			return prefix === undefined
				? forward(chunks, out)
				: forwardLines(chunks, out, prefix);
		}),
	).then(
		() => {
			for (const out of writers) out.close();
		},
		(error: unknown) => {
			for (const out of writers) out.close();
			throw error;
		},
	);
	return {
		drained,
		cancel() {
			for (const [reader] of pairs) void reader?.cancel();
		},
	};
}

function openLog(path: string): number {
	try {
		return openSync(path, LOG_OPEN_FLAGS, LOG_MODE);
	} catch (error) {
		throw new Failure(
			`${path} cannot be opened for the log: ${codeOf(error)}`,
		);
	}
}

/**
 * The child's streams: inherited when the program's own are
 * terminals, piped and drained otherwise, since an inherited
 * non-blocking pipe loses a child that cannot cope; under `prefix`
 * both piped; under `logFile` both the file's descriptor, opened here
 * and closed after the spawn.
 */
function stdioFor(
	output: ChildOutput | undefined,
	cwd: string,
	streams: OutputStreams,
): { readonly stdio: Stdio; readonly fd?: number } {
	if (output === undefined)
		return {
			stdio: {
				stdin: 'inherit',
				stdout: attach(streams.stdout),
				stderr: attach(streams.stderr),
			},
		};
	if ('prefix' in output) return { stdio: QUIET };
	const fd = openLog(resolve(cwd, output.logFile));
	return { stdio: { stdin: 'ignore', stdout: fd, stderr: fd }, fd };
}

/**
 * Starts a step's process with its secrets read, its env over the
 * program's, and its output forwarded, prefixed or logged as `output`
 * says. Rejects with `SpawnFailure` for a program that cannot start,
 * with `Failure` for a missing working directory, a value holding a
 * NUL byte or a log file that cannot open, and with whatever a
 * `resolve()` threw. A plan step's `gate` runs once the secrets are
 * read and before the spawn, so an interrupt that arrived during a
 * `resolve()` starts nothing.
 *
 * @public
 */
export async function spawnChild(
	step: Step,
	opts: SpawnOptions = {},
	gate?: (step: Step) => void,
): Promise<ChildHandle> {
	const values = await resolved(step);
	gate?.(step);
	const program = shown(step.argv[0] ?? '');
	const cwd = resolve(opts.root ?? process.cwd(), step.cwd);
	const given = opts.streams ?? process;
	const streams: OutputStreams =
		step.stdout === 'stderr'
			? { stdout: given.stderr, stderr: given.stderr }
			: given;
	const { stdio, fd } = stdioFor(opts.output, cwd, streams);
	let proc: Subprocess;
	try {
		proc = start(values, program, cwd, stdio, opts.detached);
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
	const prefix =
		opts.output !== undefined && 'prefix' in opts.output
			? opts.output.prefix
			: undefined;
	const piped =
		stdio.stdout === 'pipe' || stdio.stderr === 'pipe'
			? relay(proc, streams, prefix)
			: undefined;
	return {
		pid: proc.pid,
		exited: Promise.all([proc.exited, piped?.drained]).then(([code]) =>
			exitCode(proc, code),
		),
		kill: signal => {
			if (opts.detached) signalGroup(proc.pid, signal);
			else proc.kill(signal);
		},
		release: () => {
			if (!opts.detached) return;
			proc.unref();
			piped?.cancel();
		},
	};
}

/**
 * Runs a read-only check's program with both streams captured, in
 * `cwd` or the working directory, with `env` over the program's.
 * Rejects with `SpawnFailure` for a program that cannot start and
 * `Failure` for a missing directory.
 *
 * @public
 */
export async function capture(
	argv: readonly string[],
	{
		cwd = process.cwd(),
		env = {},
		input,
	}: {
		readonly cwd?: string;
		readonly env?: Readonly<Record<string, string>>;
		/** Text the program reads on stdin; nothing by default. */
		readonly input?: string;
	} = {},
): Promise<CaptureResult> {
	const proc = start({ argv, env }, argv[0] ?? '', cwd, {
		...QUIET,
		...(input === undefined ? {} : { stdin: new Blob([input]) }),
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(pipeOf(proc.stdout)).text(),
		new Response(pipeOf(proc.stderr)).text(),
		proc.exited,
	]);
	return { code: exitCode(proc, code), stdout, stderr };
}
