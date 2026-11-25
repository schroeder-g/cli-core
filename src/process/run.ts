import type { Context } from '../core/command.ts';
import { Failure, messageOf } from '../core/errors.ts';
import { signalExit } from '../core/exit.ts';
import { log } from '../core/logging.ts';
import { formatStep, planLines } from '../core/plan.ts';
import type { Plan, Step } from '../core/plan.ts';
import type { OutputStreams } from '../core/streams.ts';
import { lineWriter } from '../core/streams.ts';
import { onSignals } from './signals.ts';
import { spawnChild, SpawnFailure } from './spawn.ts';
import type { ChildHandle } from './spawn.ts';

// The signal that arrived while a plan ran, kept until the plan answers.
let interruptedBy: NodeJS.Signals | undefined;

// LogTape reads `{name}` in a message as a placeholder, and its bare
// value renderer neutralizes the newlines a property holds, so dynamic
// text goes in as the message with each brace doubled.
const asMessage = (text: string): string =>
	text.replaceAll('{', '{{').replaceAll('}', '}}');

const stopIfInterrupted = (step: Step): void => {
	if (interruptedBy !== undefined)
		throw new Failure(
			`${interruptedBy} arrived before ${step.title} started`,
		);
};

async function runStep(
	step: Step,
	root: string,
	streams: OutputStreams,
	gate?: (step: Step) => void,
): Promise<number> {
	if (step.unless && (await step.unless.check())) {
		log.info('skipping {title}: {reason}', {
			title: step.title,
			reason: step.unless.describe,
		});
		return 0;
	}
	log.info(asMessage(formatStep(step, root)));
	let child: ChildHandle;
	try {
		child = await spawnChild(step, { root, streams }, gate);
	} catch (error) {
		if (!(error instanceof SpawnFailure)) throw error;
		log.error(asMessage(error.message));
		return error.code;
	}
	return child.exited;
}

/**
 * Runs the steps in order, stopping at the first that fails, then every
 * `finally` step however the run went. Answers the failing step's code,
 * `128 + n` for a child a signal killed, 127 for a program that could
 * not start, else 0; a `finally` step's failure fails a run that had
 * succeeded, and is logged when the run had already failed. Rejects,
 * after the `finally` steps, with the first error a `resolve()` or a
 * `check()` threw. SIGINT, SIGTERM and SIGHUP are ignored for the whole
 * run, so the child the terminal signalled too finishes cancelling and
 * the `finally` steps run; the plan then stops and answers `128 + n`
 * for that signal, whatever else happened. A plan that succeeded then
 * runs its `then` action, outside the guard, and answers its code.
 * Under `dryRun` the plan is printed, the action described, and
 * nothing runs.
 */
export async function runPlan<C extends Context>(
	plan: Plan<C>,
	ctx: C,
): Promise<number> {
	const root = ctx.root;
	const streams: OutputStreams = ctx;
	if (ctx.dryRun) {
		for (const line of [
			...planLines(plan, root),
			...(plan.then?.describe(root) ?? []),
		])
			lineWriter(streams.stdout)(line);
		return 0;
	}

	const note = (signal: NodeJS.Signals) => {
		interruptedBy ??= signal;
	};

	interruptedBy = undefined;
	const release = onSignals(note);
	let code = 0;
	let error: unknown;
	try {
		for (const step of plan.steps) {
			code = await runStep(step, root, streams, stopIfInterrupted);
			if (code !== 0 || interruptedBy !== undefined) break;
		}
	} catch (thrown) {
		error = thrown;
	}

	const failed = () => code !== 0 || error !== undefined;

	for (const step of plan.finally ?? []) {
		try {
			const last = await runStep(step, root, streams);
			if (last === 0) continue;
			if (failed())
				log.warning('finally step {title} exited {code}', {
					title: step.title,
					code: last,
				});
			else code = last;
		} catch (thrown) {
			if (failed())
				log.error('finally step {title} failed: {reason}', {
					title: step.title,
					reason: messageOf(thrown),
				});
			else error = thrown;
		}
	}
	release();
	const signal = interruptedBy;
	interruptedBy = undefined;
	if (signal !== undefined) {
		if (error !== undefined)
			log.debug('after {signal}: {reason}', {
				signal,
				reason: messageOf(error),
			});
		return signalExit(signal);
	}
	if (error !== undefined) throw error;
	if (code !== 0 || plan.then === undefined) return code;
	return plan.then.run(ctx);
}
