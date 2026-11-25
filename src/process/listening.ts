import { waitForPort } from './ports.ts';
import type { ChildHandle } from './spawn.ts';

/** The pause before a child that exited is started again, by default. */
const RETRY_MS = 3_000;

/**
 * How a wait on a child's port ended: the port connects, the child
 * exited first with `code`, or neither before the time was up or the
 * wait was called off.
 */
export type Listening =
	| { readonly kind: 'listening' }
	| { readonly kind: 'exited'; readonly code: number }
	| { readonly kind: 'silent' };

export interface ListenRetry {
	/** How long every start together gets to listen. */
	readonly timeoutMs: number;
	/** The pause before a start after an exit; 3 s by default. */
	readonly retryMs?: number;
	/**
	 * Calls the wait off: no start follows, and the child is left as it
	 * is.
	 */
	readonly signal?: AbortSignal;
}

/**
 * Waits until something answers on the loopback at `port` or `child`
 * exits, whichever comes first, for up to `timeoutMs`. A silent child
 * is left running.
 */
export async function awaitListening(
	child: ChildHandle,
	port: number,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<Listening> {
	const exited = child.exited.then(code => ({
		kind: 'exited' as const,
		code,
	}));
	const outcome = await Promise.race([
		waitForPort(port, timeoutMs, signal),
		exited,
	]);
	if (typeof outcome === 'object') return outcome;
	return outcome ? { kind: 'listening' } : { kind: 'silent' };
}

/**
 * Starts a child with `start` until one listens on `port`, as for a
 * tunnel whose far end is still booting: a child that exits first is
 * started again after the pause, until `timeoutMs` has passed over all
 * of them. One still silent at the deadline is stopped with SIGTERM.
 * Answers the last child and how its wait ended.
 */
export async function listenWithRetry(
	start: () => Promise<ChildHandle>,
	port: number,
	{ timeoutMs, retryMs = RETRY_MS, signal }: ListenRetry,
): Promise<{
	readonly child: ChildHandle;
	readonly outcome: Listening;
}> {
	const deadline = Date.now() + timeoutMs;

	const calledOff = () => signal?.aborted === true;

	for (;;) {
		const child = await start();
		const left = Math.max(1, deadline - Date.now());
		const outcome = await awaitListening(child, port, left, signal);
		if (outcome.kind === 'listening' || calledOff())
			return { child, outcome };
		if (outcome.kind === 'silent') {
			child.kill('SIGTERM');
			await child.exited;
			return { child, outcome };
		}
		if (Date.now() + retryMs >= deadline) return { child, outcome };
		await Bun.sleep(retryMs);
		if (calledOff()) return { child, outcome };
	}
}
