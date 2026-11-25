/** The signals a terminal sends to end a run. */
const TERMINATING: readonly NodeJS.Signals[] = [
	'SIGINT',
	'SIGTERM',
	'SIGHUP',
];

/**
 * Handles each terminating signal until the returned release is
 * called.
 */
export function onSignals(
	handler: (signal: NodeJS.Signals) => void,
): () => void {
	for (const signal of TERMINATING) process.on(signal, handler);
	return () => {
		for (const signal of TERMINATING) process.off(signal, handler);
	};
}

/** Signals a process group; false once it is gone. */
export const signalGroup = (
	pgid: number,
	signal: NodeJS.Signals | 0,
): boolean => {
	try {
		process.kill(-pgid, signal);
		return true;
	} catch {
		return false;
	}
};

export const groupAlive = (pgid: number): boolean =>
	signalGroup(pgid, 0);
