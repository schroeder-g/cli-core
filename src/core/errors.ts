/** The program declines to proceed, before or between steps: exit 2. */
export class Refusal extends Error {
	override readonly name = 'Refusal';
}

/** A failure the program detected itself, such as a busy port: exit 1. */
export class Failure extends Error {
	override readonly name = 'Failure';
}

/**
 * The code a system error carries, such as `ENOENT`; none for another
 * error.
 */
export const codeOf = (error: unknown): string | undefined =>
	error instanceof Error && 'code' in error
		? String(error.code)
		: undefined;

/** An error's message, or the text of whatever else was thrown. */
export const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
