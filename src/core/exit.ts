import { constants as os } from 'node:os';

import { Failure, messageOf, Refusal } from './errors.ts';
import { log } from './logging.ts';

/** A failure the program detected itself, or an error nothing explains. */
export const FAILED = 1;

/** A usage error, or a refusal before any step. */
export const REFUSED = 2;

/** A program that could not start. */
export const CANNOT_SPAWN = 127;

const SIGNAL_EXIT_BASE = 128;

/** The runner's way out of help, completion and parse errors. */
export class Exit extends Error {
	constructor(readonly code: number) {
		super(`exit ${code}`);
	}
}

/** `128 + n` for the signal numbered `n`, as a shell reports it. */
export const signalExit = (signal: NodeJS.Signals): number =>
	SIGNAL_EXIT_BASE + os.signals[signal];

/** A run an interrupt ended. */
export const INTERRUPTED = signalExit('SIGINT');

/**
 * A refusal exits 2, a failure 1 with its message, anything else 1
 * with its stack at debug.
 */
export const exitCode = (error: unknown): number => {
	if (error instanceof Exit) return error.code;
	log.error(messageOf(error));
	if (error instanceof Refusal) return REFUSED;
	if (
		!(error instanceof Failure)
		&& error instanceof Error
		&& error.stack
	)
		log.debug(error.stack);
	return FAILED;
};
