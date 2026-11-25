import { createContext, use } from 'react';

import type { Field, Filled, Level } from './fields.ts';

export type Stage =
	| { readonly kind: 'loading' }
	| { readonly kind: 'levels'; readonly options: readonly Level[] }
	| { readonly kind: 'fields'; readonly fields: readonly Field[] }
	| { readonly kind: 'confirm' };

/** How far the walk has come: the levels picked, the fields answered. */
interface BuilderState {
	readonly stage: Stage;
	readonly chosen: readonly Level[];
	readonly filled: readonly Filled[];
	/** The field awaiting an answer, while the stage is `fields`. */
	readonly current: Field | undefined;
	/** The start path and the name of every chosen level. */
	readonly path: readonly string[];
}

interface BuilderActions {
	readonly choose: (name: string) => void;
	readonly fill: (value: string) => void;
	readonly run: () => void;
	readonly cancel: () => void;
}

interface BuilderMeta {
	/** The program's name, as its command line spells it. */
	readonly name: string;
	readonly start: readonly string[];
}

export interface BuilderContextValue {
	readonly state: BuilderState;
	readonly actions: BuilderActions;
	readonly meta: BuilderMeta;
}

export const BuilderContext = createContext<BuilderContextValue | null>(
	null,
);

export const useBuilder = (): BuilderContextValue => {
	const value = use(BuilderContext);
	if (value === null)
		throw new Error(
			'a builder part renders inside BuilderProvider only',
		);
	return value;
};
