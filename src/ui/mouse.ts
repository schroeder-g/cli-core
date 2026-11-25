/**
 * Mouse reports, as a terminal sends them once asked (the SGR form:
 * `ESC [ < button ; x ; y M` for a press, `m` for a release), cut out
 * of the input before Ink reads it, since Ink drops them, and handed
 * to whoever listens: the one screen presented.
 */

const ESC = '\u001b';

const REPORT = new RegExp(`${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])`, 'g');

/** Button presses and releases, reported in the SGR form. */
export const MOUSE_ON = '\u001b[?1000h\u001b[?1006h';

export const MOUSE_OFF = '\u001b[?1006l\u001b[?1000l';

/** The button bits: the low two name the button, 64 marks a wheel. */
const BUTTON_MASK = 3;

const WHEEL_BIT = 64;

export interface MouseReport {
	/** The button code as reported, modifiers and wheel bits included. */
	readonly button: number;
	/** The cell, 1-based from the top left. */
	readonly x: number;
	readonly y: number;
	readonly released: boolean;
}

export const isLeftPress = ({
	button,
	released,
}: MouseReport): boolean =>
	!released
	&& (button & WHEEL_BIT) === 0
	&& (button & BUTTON_MASK) === 0;

/** -1 for a wheel turn up, 1 for one down, nothing for no wheel. */
export const wheelOf = ({ button }: MouseReport): -1 | 1 | undefined =>
	(button & WHEEL_BIT) === 0 ? undefined : (button & 1) === 0 ? -1 : 1;

/** The reports in `text`, and `text` without them. */
export function splitReports(text: string): {
	readonly reports: MouseReport[];
	readonly rest: string;
} {
	const reports: MouseReport[] = [];
	const rest = text.replace(REPORT, (_, button, x, y, kind) => {
		reports.push({
			button: Number(button),
			x: Number(x),
			y: Number(y),
			released: kind === 'm',
		});
		return '';
	});
	return { reports, rest };
}

type Listener = (report: MouseReport) => void;

const listeners = new Set<Listener>();

/** The reports of the screen presented now, for its views to read. */
export const mouseReports = {
	subscribe(listener: Listener): () => void {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
	emit(report: MouseReport): void {
		for (const listener of listeners) listener(report);
	},
};
