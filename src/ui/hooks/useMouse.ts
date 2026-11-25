import { useEffect, useEffectEvent } from 'react';

import { isLeftPress, mouseReports, wheelOf } from '../mouse.ts';
import type { MouseReport } from '../mouse.ts';

/** A terminal cell, 1-based from the top left. */
interface Cell {
	readonly x: number;
	readonly y: number;
}

export interface MouseHandlers {
	/** A left button press. */
	readonly onClick?: (cell: Cell) => void;
	/** A wheel turn: -1 up, 1 down. */
	readonly onWheel?: (direction: -1 | 1) => void;
}

/**
 * Clicks and wheel turns on a screen presented with the mouse on; the
 * handlers given last are the ones called, through one subscription.
 */
export function useMouse({ onClick, onWheel }: MouseHandlers): void {
	const onReport = useEffectEvent((report: MouseReport) => {
		const wheel = wheelOf(report);
		if (wheel !== undefined) onWheel?.(wheel);
		else if (isLeftPress(report))
			onClick?.({ x: report.x, y: report.y });
	});
	useEffect(
		() => mouseReports.subscribe(report => onReport(report)),
		[],
	);
}
