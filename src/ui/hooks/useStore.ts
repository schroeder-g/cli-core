import { useSyncExternalStore } from 'react';

import type { ExternalStore } from '../../core/store.ts';

/** The store's snapshot, redrawn when it publishes. */
export const useStore = <T>(store: ExternalStore<T>): T =>
	useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
