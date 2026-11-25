import { useInput } from 'ink';
import type { Key } from 'ink';
import { useState } from 'react';

import { useChecklist } from './useChecklist.ts';
import type { ChecklistRules } from './useChecklist.ts';
import { useMouse } from './useMouse.ts';
import { useScreen } from './useScreen.ts';

export interface ChecklistScreenKeys {
	/** The screen row the first name is on, where a click lands. */
	readonly firstRow: number;
	/** q or Escape. */
	readonly onQuit: () => void;
	/**
	 * Enter, with the names checked: why they cannot go, shown as the
	 * notice, or nothing once they went.
	 */
	readonly onConfirm: (
		checked: ReadonlySet<string>,
	) => string | undefined;
	/** Every key the checklist leaves. */
	readonly onKey?: (input: string, key: Key) => void;
	/** What the notice says when `holds` keeps a name checked. */
	readonly heldNotice?: (name: string, by: readonly string[]) => string;
}

export interface ChecklistScreen {
	/** The row the cursor is on. */
	readonly index: number;
	readonly has: (name: string) => boolean;
	/** Why the last key did nothing, or nothing. */
	readonly notice: string | undefined;
}

/**
 * What every checklist screen does: the list screen's cursor, space
 * toggling the pointed name and a every name, Enter confirming the
 * checked ones, a click selecting and toggling its row, and a notice
 * the next key clears.
 */
export function useChecklistScreen(
	names: readonly string[],
	initial: () => ReadonlySet<string>,
	{
		firstRow,
		onQuit,
		onConfirm,
		onKey,
		heldNotice,
		...rules
	}: ChecklistScreenKeys & Omit<ChecklistRules, 'onHeld'>,
): ChecklistScreen {
	const [notice, setNotice] = useState<string | undefined>(undefined);
	const list = useChecklist(names, initial, {
		...rules,
		onHeld: (name, by) => setNotice(heldNotice?.(name, by)),
	});
	// Ink calls the input handlers in the order they were declared, so
	// this clear runs before the key a notice of its own may set.
	useInput(() => setNotice(undefined));
	const { index, select } = useScreen(names.length, {
		onQuit,
		onKey: (input, key) => {
			const pointed = names[index];
			if (input === ' ' && pointed !== undefined) list.toggle(pointed);
			else if (input === 'a') list.toggleAll();
			else if (key.return) setNotice(onConfirm(list.checked));
			else onKey?.(input, key);
		},
	});
	useMouse({
		onClick: ({ y }) => {
			const name = names[y - firstRow];
			if (name === undefined) return;
			setNotice(undefined);
			select(y - firstRow);
			list.toggle(name);
		},
	});
	return { index, has: list.has, notice };
}
