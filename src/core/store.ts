/**
 * A store a screen reads through `useSyncExternalStore`: one snapshot
 * object until something changes, then a new one and every listener
 * told. Subclasses hold the state and call `publish` with the next
 * snapshot.
 */
export class ExternalStore<T> {
	#current: T;

	readonly #listeners = new Set<() => void>();

	constructor(initial: T) {
		this.#current = initial;
	}

	readonly subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	};

	/** The same object until the next `publish`, as React expects. */
	readonly snapshot = (): T => this.#current;

	protected publish(next: T): void {
		this.#current = next;
		for (const listener of this.#listeners) listener();
	}
}
