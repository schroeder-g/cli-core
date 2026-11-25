import { Refusal } from '../core/errors.ts';

// Bun.which reads the PATH the process started with unless one is
// passed, so a PATH changed since, a test's included, is honoured only
// this way.
/** The program's path on `PATH`, or undefined when none is found. */
export function findTool(name: string): string | undefined {
	return Bun.which(name, { PATH: process.env.PATH ?? '' }) ?? undefined;
}

/**
 * Refuses, naming every program of `names` absent from `PATH`, so a run
 * that needs them stops before its first step.
 */
export function preflight(names: readonly string[]): void {
	const missing = [...new Set(names)].filter(
		name => findTool(name) === undefined,
	);
	if (missing.length === 0) return;
	throw new Refusal(`missing from PATH: ${missing.join(', ')}`);
}
