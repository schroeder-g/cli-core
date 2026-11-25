import { useInput } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { BuilderContext } from './context.ts';
import type { BuilderContextValue, Stage } from './context.ts';
import { describe, toArgv } from './fields.ts';
import type { AnyParser, Filled, Level } from './fields.ts';

export interface BuilderProps {
	readonly name: string;
	readonly program: AnyParser;
	readonly path: readonly string[];
	readonly onDone: (argv: string[] | undefined) => void;
	readonly onError: (error: unknown) => void;
}

interface BuilderProviderProps extends BuilderProps {
	readonly children: ReactNode;
}

/**
 * Owns the walk: describes `program` at the path so far, holds the
 * levels chosen and the fields filled, and hands the parts their state
 * and actions. Escape cancels.
 */
export function BuilderProvider({
	name,
	program,
	path: start,
	onDone,
	onError,
	children,
}: BuilderProviderProps) {
	const [chosen, setChosen] = useState<readonly Level[]>([]);
	const [stage, setStage] = useState<Stage>({ kind: 'loading' });
	const [filled, setFilled] = useState<readonly Filled[]>([]);
	const path = useMemo(
		() => [...start, ...chosen.map(level => level.name)],
		[start, chosen],
	);

	useEffect(() => {
		let current = true;

		const load = async () => {
			const { levels: options, fields } = await describe(program, path);
			if (options.length > 0) {
				if (current) setStage({ kind: 'levels', options });
				return;
			}
			if (current)
				setStage(
					fields.length > 0
						? { kind: 'fields', fields }
						: { kind: 'confirm' },
				);
		};

		load().catch((error: unknown) => {
			if (current) onError(error);
		});
		return () => {
			current = false;
		};
	}, [program, path, onError]);

	const cancel = useCallback(() => onDone(undefined), [onDone]);

	useInput((input, key) => {
		if (key.escape) cancel();
	});

	const current =
		stage.kind === 'fields' ? stage.fields[filled.length] : undefined;

	const choose = useCallback(
		(name: string) => {
			if (stage.kind !== 'levels') return;
			const level = stage.options.find(option => option.name === name);
			setChosen([
				...chosen,
				{ name, description: level?.description ?? '' },
			]);
			setStage({ kind: 'loading' });
		},
		[stage, chosen],
	);

	const fill = useCallback(
		(value: string) => {
			if (stage.kind !== 'fields' || current === undefined) return;
			const next = [...filled, { field: current, value }];
			setFilled(next);
			if (next.length === stage.fields.length)
				setStage({ kind: 'confirm' });
		},
		[stage, filled, current],
	);

	const run = useCallback(
		() => onDone(toArgv(path, filled)),
		[onDone, path, filled],
	);

	const value = useMemo<BuilderContextValue>(
		() => ({
			state: { stage, chosen, filled, current, path },
			actions: { choose, fill, run, cancel },
			meta: { name, start },
		}),
		[
			stage,
			chosen,
			filled,
			current,
			path,
			choose,
			fill,
			run,
			cancel,
			name,
			start,
		],
	);

	return <BuilderContext value={value}>{children}</BuilderContext>;
}
