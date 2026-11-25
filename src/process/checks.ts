import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import { FAILED } from '../core/exit.ts';
import type { OutputStream } from '../core/streams.ts';
import { lineWriter } from '../core/streams.ts';
import { LOOKS } from '../ui/glyphs.ts';
import { LOG_MODE, spawnChild, SpawnFailure } from './spawn.ts';

/** How much of a failed logged check's output its report shows. */
const TAIL_LINES = 20;

const OUTPUT_INDENT = '    ';

/**
 * How a check ended: a failure always carries the fix for it, and may
 * carry the lines of its output the report shows under it.
 */
export type CheckOutcome =
	| { readonly ok: true; readonly detail: string }
	| {
			readonly ok: false;
			readonly detail: string;
			readonly fix: string;
			readonly output?: readonly string[];
	  };

/** One named, independent probe, one line of a report. */
export interface Check {
	readonly name: string;
	run(): Promise<CheckOutcome>;
}

/**
 * A check that runs `runs` in turn in `cwd`, stopping at the first that
 * fails, with all their output in `log`, relative to `cwd`, in the
 * order they wrote it. A failure shows the last `tail` lines of it, 20
 * by default, and its fix is `fix`, by default to read the log.
 */
export interface LoggedCheck {
	readonly runs: readonly (readonly string[])[];
	readonly cwd: string;
	readonly log: string;
	readonly tail?: number;
	readonly fix?: string;
}

type Settled<R> =
	| { readonly ok: true; readonly value: R }
	| { readonly ok: false; readonly error: unknown };

/**
 * Starts `run` on every item at once and hands each result to `each` in
 * the order of `items`, as soon as it and every one before it have
 * settled. Rejects with the first error in that order, once the results
 * before it are handed on.
 */
export async function allInOrder<T, R>(
	items: readonly T[],
	run: (item: T) => Promise<R>,
	each: (result: R, item: T) => void,
): Promise<void> {
	const settled = items.map(async (item): Promise<Settled<R>> => {
		try {
			return { ok: true, value: await run(item) };
		} catch (error) {
			return { ok: false, error };
		}
	});
	for (const [index, item] of items.entries()) {
		const result = await settled[index]!;
		if (!result.ok) throw result.error;
		each(result.value, item);
	}
}

const plural = (count: number): string =>
	`${count} ${count === 1 ? 'check' : 'checks'}`;

function reportLines(name: string, outcome: CheckOutcome): string[] {
	const head = (glyph: string, ...rest: string[]) =>
		[glyph, name, ...rest].filter(part => part !== '').join(' ');

	if (outcome.ok) return [head(LOOKS.done.glyph, outcome.detail)];
	return [
		head(LOOKS.failed.glyph, outcome.detail, '—', outcome.fix),
		...(outcome.output ?? []).map(line => `${OUTPUT_INDENT}${line}`),
	];
}

/**
 * Runs the checks at once and reports each on `stdout` in the order
 * given, as soon as it and those before it have ended: a pass as
 * `✓ name detail`, a failure as `✗ name detail — fix` with its output
 * indented under it, then a count of the failures by name. Answers
 * `FAILED` when any check failed, else 0.
 */
export async function runChecks(
	checks: readonly Check[],
	stdout: OutputStream,
): Promise<number> {
	const write = lineWriter(stdout);
	const failed: string[] = [];
	await allInOrder(
		checks,
		check => check.run(),
		(outcome, { name }) => {
			for (const line of reportLines(name, outcome)) write(line);
			if (!outcome.ok) failed.push(name);
		},
	);
	write(
		failed.length === 0
			? `${plural(checks.length)} passed`
			: `${failed.length} of ${plural(checks.length)} failed: ${failed.join(', ')}`,
	);
	return failed.length === 0 ? 0 : FAILED;
}

async function exitOf(
	argv: readonly string[],
	cwd: string,
	log: string,
): Promise<number> {
	try {
		const child = await spawnChild(
			{ title: argv[0] ?? '', cwd, argv },
			{ output: { logFile: log } },
		);
		return await child.exited;
	} catch (error) {
		if (!(error instanceof SpawnFailure)) throw error;
		appendFileSync(log, `${error.message}\n`);
		return error.code;
	}
}

const tailOf = (text: string, count: number): string[] => {
	const trimmed = text.trimEnd();
	return trimmed === '' ? [] : trimmed.split('\n').slice(-count);
};

/** A check that runs programs in turn, its output to a log. */
export function loggedCheck(
	name: string,
	{ runs, cwd, log, tail = TAIL_LINES, fix }: LoggedCheck,
): Check {
	const file = resolve(cwd, log);
	return {
		name,
		async run() {
			const started = performance.now();
			mkdirSync(dirname(file), { recursive: true });
			// Removed, not truncated, so a link left where the log goes is
			// replaced rather than written through.
			rmSync(file, { force: true });
			writeFileSync(file, '', { flag: 'wx', mode: LOG_MODE });
			let code = 0;
			for (const argv of runs) {
				code = await exitOf(argv, cwd, file);
				if (code !== 0) break;
			}
			const time = `${((performance.now() - started) / 1000).toFixed(1)} s`;
			if (code === 0) return { ok: true, detail: time };
			return {
				ok: false,
				detail: `exit ${code}, ${time}`,
				fix: fix ?? `read ${file}`,
				output: tailOf(readFileSync(file, 'utf8'), tail),
			};
		},
	};
}
