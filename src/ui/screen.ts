import { PassThrough } from 'node:stream';

import type { ComponentType, ReactElement } from 'react';

import { Failure, Refusal } from '../core/errors.ts';
import type {
	InputStream,
	OutputStream,
	Streams,
} from '../core/streams.ts';
import type {
	ChecklistItem,
	ChecklistViewProps,
} from './ChecklistView.tsx';
import type { LogViewerProps } from './LogViewer.tsx';
import {
	MOUSE_OFF,
	MOUSE_ON,
	mouseReports,
	splitReports,
} from './mouse.ts';

/**
 * The terminal a screen draws on: the input it reads, the output it
 * paints.
 */
interface Terminal {
	readonly stdin: InputStream;
	readonly screen: OutputStream;
}

/**
 * How a screen takes the terminal: on the alternate screen, drawn from
 * the top with nothing left behind when it ends, and with the mouse
 * reported, its reports reaching the views through `useMouse`.
 */
export interface Presentation {
	readonly alternate?: boolean;
	readonly mouse?: boolean;
}

/**
 * How a screen another screen hands the terminal to presents itself:
 * whole, with the mouse, and given back clean.
 */
export const WHOLE_SCREEN: Presentation = {
	alternate: true,
	mouse: true,
};

/**
 * The input as Ink reads it when the mouse is on: a stream fed what the
 * terminal sends with the mouse reports cut out, each report emitted to
 * the screen's listeners instead. Raw mode and the references pass to
 * the terminal itself.
 */
function withoutReports(stdin: InputStream): {
	readonly input: InputStream;
	readonly detach: () => void;
} {
	const terminal = stdin as RawInput;
	const input = Object.assign(new PassThrough(), {
		isTTY: true,
		setRawMode: (mode: boolean) => terminal.setRawMode?.(mode),
		ref: () => terminal.ref?.(),
		unref: () => terminal.unref?.(),
	});

	const onData = (chunk: Buffer | string): void => {
		const { reports, rest } = splitReports(chunk.toString());
		for (const report of reports) mouseReports.emit(report);
		if (rest !== '') input.write(rest);
	};

	const onEnd = (): void => {
		input.end();
	};

	stdin.on('data', onData);
	stdin.once('end', onEnd);
	// A terminal paused by an earlier screen flows again only when asked.
	stdin.resume();
	return {
		input: input as unknown as InputStream,
		detach: () => {
			stdin.removeListener('data', onData);
			stdin.removeListener('end', onEnd);
			input.destroy();
		},
	};
}

/** How a screen ends: with its value, by an interrupt, or by a failure. */
export interface Exit<T> {
	done(value: T): void;
	interrupt(): void;
	fail(error: unknown): void;
}

/** A terminal's input, with what Ink asks of it. */
interface RawInput extends InputStream {
	setRawMode?(mode: boolean): unknown;
	ref?(): unknown;
	unref?(): unknown;
}

/** Ends the screen drawn now; none while no screen is drawn. */
let endCurrent: (() => void) | undefined;

/**
 * Ends the screen drawn now with no value, whichever opener drew it, as
 * input that ends does: a caller that took a signal ends what shows and
 * handles the signal itself, so nothing is raised again.
 */
export const endShown = (): void => endCurrent?.();

const rawModeCapable = (stdin: InputStream): boolean =>
	stdin.isTTY === true
	&& 'setRawMode' in stdin
	&& typeof stdin.setRawMode === 'function';

/**
 * Refuses with `refusal` unless `stdin` is a terminal a screen can
 * draw on, for a caller that must know before it starts what the
 * screen shows.
 */
export function assertTerminal(
	stdin: InputStream,
	refusal: string,
): void {
	if (!rawModeCapable(stdin)) throw new Refusal(refusal);
}

/**
 * Draws the Ink element `open` builds on `io.screen` until it ends, and
 * answers the value it ended with, or `undefined` when it was
 * interrupted or the input ended first. stdin must be a terminal that
 * enters raw mode, else `refusal` is thrown as a Refusal. Ink and React
 * load here and nowhere else, so a run that opens no screen never pays
 * for them. Ctrl-C hands the terminal back and re-raises the interrupt,
 * so the shell sees it as one.
 */
async function draw<T>(
	io: Terminal,
	refusal: string,
	open: (exit: Exit<T>) => Promise<ReactElement>,
	{ alternate = false, mouse = false }: Presentation = {},
): Promise<T | undefined> {
	assertTerminal(io.stdin, refusal);
	let result: T | undefined;
	let failure: unknown;
	let interrupted = false;
	let app: ReturnType<typeof render> | undefined;

	const end = () => app?.unmount();

	const [{ render }, element] = await Promise.all([
		import('ink'),
		open({
			done: value => {
				result = value;
				end();
			},
			interrupt: () => {
				interrupted = true;
				end();
			},
			fail: error => {
				failure = error;
				end();
			},
		}),
	]);
	const reading = mouse ? withoutReports(io.stdin) : undefined;
	app = render(element, {
		stdin: reading?.input ?? io.stdin,
		stdout: io.screen,
		stderr: io.screen,
		interactive: io.screen.isTTY === true,
		exitOnCtrlC: false,
		alternateScreen: alternate,
	});
	if (mouse) io.screen.write(MOUSE_ON);
	endCurrent = end;

	// Input that ends leaves nothing to show: the screen closes.
	const ended = () => end();

	io.stdin.once('end', ended);
	try {
		await app.waitUntilExit();
	} finally {
		endCurrent = undefined;
		io.stdin.removeListener('end', ended);
		if (mouse) io.screen.write(MOUSE_OFF);
		reading?.detach();
		// Ink has left raw mode; pausing stops this process reading the terminal, so
		// a child that inherits it gets every byte typed next.
		io.stdin.pause();
	}
	if (interrupted) {
		process.kill(process.pid, 'SIGINT');
		return undefined;
	}
	if (failure instanceof Error) throw failure;
	if (failure !== undefined)
		throw new Failure(`the screen failed: ${JSON.stringify(failure)}`);
	return result;
}

/**
 * Says `prompt` and waits for one key on a terminal that takes raw
 * mode, so what a hand-over printed stays readable before a screen
 * draws over it; off one it returns at once.
 */
export async function awaitKey(
	io: Streams,
	prompt: string,
): Promise<void> {
	if (!rawModeCapable(io.stdin)) return;
	const terminal = io.stdin as RawInput;
	io.stdout.write(`${prompt}\n`);
	terminal.setRawMode?.(true);
	io.stdin.resume();
	try {
		await new Promise<void>(resolve => {
			io.stdin.once('data', () => resolve());
			io.stdin.once('end', () => resolve());
		});
	} finally {
		terminal.setRawMode?.(false);
		io.stdin.pause();
	}
}

export interface ScreenOptions {
	/**
	 * The screen that handed the terminal over: this one takes it whole,
	 * and q goes back.
	 */
	readonly from?: string;
	/** How the screen takes the terminal, over what `from` implies. */
	readonly presentation?: Presentation;
	/** Draws on stderr, so stdout carries only what the screen answers. */
	readonly onStderr?: boolean;
}

/**
 * A view's component, loaded when its screen opens, so a run that
 * opens none never loads it, Ink or React.
 */
export type LazyView<P> = () => Promise<ComponentType<P>>;

/**
 * What a screen draws a view with: the run's streams, the refusal a
 * stdin that is no terminal gets, and the view's props built over the
 * exit it ends through.
 */
export interface Presenting<T, P> extends ScreenOptions {
	readonly io: Streams;
	readonly refusal: string;
	readonly props: (exit: Exit<T>) => P;
}

/** A view to draw, its props those of the component `view` loads. */
export interface ViewSpec<T, P> extends Presenting<T, NoInfer<P>> {
	readonly view: LazyView<P>;
}

/**
 * Draws the view `view` loads inside the screen frame until it ends,
 * and answers the value it ended with through `exit.done`, or
 * `undefined` on an interrupt or when the input ended first. Ink, React
 * and the view load only here. `T` comes from where the answer goes,
 * or from the `exit` parameter's type when nothing names it there.
 */
export async function presentView<T, P extends object>({
	io,
	refusal,
	view,
	props,
	from,
	presentation = from === undefined ? {} : WHOLE_SCREEN,
	onStderr = false,
}: ViewSpec<T, P>): Promise<T | undefined> {
	return draw<T>(
		{ stdin: io.stdin, screen: onStderr ? io.stderr : io.stdout },
		refusal,
		async exit => {
			const [{ createElement }, { ScreenFrame }, component] =
				await Promise.all([
					import('react'),
					import('./ScreenFrame.tsx'),
					view(),
				]);
			return createElement(ScreenFrame, {
				from,
				onInterrupt: () => exit.interrupt(),
				children: createElement(component, props(exit)),
			});
		},
		presentation,
	);
}

/**
 * cli-core's checklist screen, `ChecklistView`, as a view to present.
 * `checklistView<I>` types its items as a program's own.
 */
export function checklistView<I extends ChecklistItem>(): Promise<
	ComponentType<ChecklistViewProps<I>>
>;

// Inference reads the last signature, so a view named with no type
// argument takes plain items rather than an unresolved `I`.
export function checklistView(): Promise<
	ComponentType<ChecklistViewProps<ChecklistItem>>
>;

export function checklistView(): Promise<
	ComponentType<ChecklistViewProps<ChecklistItem>>
> {
	return import('./ChecklistView.tsx').then(
		module => module.ChecklistView,
	);
}

/** cli-core's log viewer, `LogViewer`, as a view to present. */
export const logViewer: LazyView<LogViewerProps> = () =>
	import('./LogViewer.tsx').then(module => module.LogViewer);
