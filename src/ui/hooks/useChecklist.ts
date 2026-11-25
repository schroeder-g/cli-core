import { useState } from 'react';

export interface Checklist {
	readonly checked: ReadonlySet<string>;
	readonly has: (name: string) => boolean;
	/** Checks or unchecks one name; `pull` names what checking adds. */
	readonly toggle: (name: string) => void;
	/** Everything, or nothing once everything is checked. */
	readonly toggleAll: () => void;
}

export interface ChecklistRules {
	/** What checking a name brings in with it; itself alone by default. */
	readonly pull?: (name: string) => readonly string[];
	/** The checked names that keep `name` checked. */
	readonly holds?: (
		name: string,
		checked: ReadonlySet<string>,
	) => readonly string[];
	/** Told of an uncheck `holds` refused, and what held it. */
	readonly onHeld?: (name: string, by: readonly string[]) => void;
}

/**
 * A set of checked names over `names`, `initial()` checked at first;
 * checking a name brings in what `pull` names, and unchecking one that
 * `holds` keeps is refused through `onHeld`.
 */
export function useChecklist(
	names: readonly string[],
	initial: () => ReadonlySet<string>,
	{
		pull = name => [name],
		holds = () => [],
		onHeld,
	}: ChecklistRules = {},
): Checklist {
	const [checked, setChecked] = useState<ReadonlySet<string>>(initial);
	return {
		checked,
		has: name => checked.has(name),
		toggle: name => {
			if (checked.has(name)) {
				const by = holds(name, checked);
				if (by.length > 0) {
					onHeld?.(name, by);
					return;
				}
				setChecked(
					new Set([...checked].filter(other => other !== name)),
				);
			} else setChecked(new Set([...checked, ...pull(name)]));
		},
		toggleAll: () =>
			setChecked(
				checked.size === names.length ? new Set() : new Set(names),
			),
	};
}
