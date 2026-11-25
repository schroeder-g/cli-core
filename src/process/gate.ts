/** One start's readiness, settled once: opened when up, failed when not. */
export interface Latch {
	readonly ready: Promise<void>;
	open(): void;
	fail(reason: Error): void;
}

const latch = (): Latch => {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	// A failure nobody waits on yet is not an unhandled rejection.
	promise.catch(() => undefined);
	return { ready: promise, open: resolve, fail: reject };
};

/**
 * The readiness of a set of units by name, so each starts once the
 * units it needs are up: the caller names the needs, the gate holds no
 * graph. Each start arms a fresh latch and settles the one it was armed
 * with, so a start a restart superseded never settles the next.
 */
export class DependencyGate {
	readonly #latches = new Map<string, Latch>();

	constructor(names: Iterable<string> = []) {
		for (const name of names) this.arm(name);
	}

	/** A fresh latch for the next start of `name`, in place of the last. */
	arm(name: string): Latch {
		const fresh = latch();
		this.#latches.set(name, fresh);
		return fresh;
	}

	/** The latch of the current start of `name`, if it was ever armed. */
	latch(name: string): Latch | undefined {
		return this.#latches.get(name);
	}

	/**
	 * Resolves once every one of `needs` is ready, a name never armed
	 * counting as ready; rejects with the reason of the first that fails.
	 */
	async awaitReady(needs: readonly string[]): Promise<void> {
		await Promise.all(
			needs.flatMap(need => {
				const ready = this.#latches.get(need)?.ready;
				return ready === undefined ? [] : [ready];
			}),
		);
	}
}
