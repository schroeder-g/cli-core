import type { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';

import type { InputStream } from '../core/streams.ts';
import { screen, terminal } from './streams.ts';
import type { Captured } from './streams.ts';

const POLL_MS = 15;

const DEFAULT_TIMEOUT_MS = 4000;

/** The screen's tail a failure shows. */
const TAIL = 800;

/** How long a failed drive gives the view to end on q before it throws. */
const QUIT_GRACE_MS = 2000;

/**
 * A key to send once the screen, its escapes stripped, satisfies
 * `until`; `before` is the screen as the step began.
 */
export interface Step {
	readonly label: string;
	readonly until: (now: string, before: string) => boolean;
	readonly key: string;
	/** Done once the screen satisfies the step, before the key. */
	readonly act?: () => void;
}

/** A view open on a fake terminal, its result pending. */
export interface Opened<T> {
	readonly input: InputStream & PassThrough;
	readonly out: Captured;
	readonly pending: Promise<T>;
}

export interface Driven<T> {
	readonly result: T;
	/** Every frame drawn, in order, the escapes stripped. */
	readonly screen: string;
	/** The frames as written, escapes included. */
	readonly raw: string;
}

export interface DriveOptions {
	readonly timeoutMs?: number;
	readonly pollMs?: number;
	/** What a failure appends: the calls a stub saw, for one. */
	readonly context?: () => string;
}

export const occurrences = (text: string, marker: string): number =>
	text.split(marker).length - 1;

/** Once `marker` is on the screen. */
export const shown = (marker: string, key: string): Step => ({
	label: `${marker} shown`,
	until: now => now.includes(marker),
	key,
});

/** Once `marker` has been drawn `times` over since the screen opened. */
export const drawn = (
	marker: string,
	key: string,
	times = 1,
): Step => ({
	label: `${marker} drawn ${times} times`,
	until: now => occurrences(now, marker) >= times,
	key,
});

/** Once `marker` has been drawn again since the step began. */
export const again = (marker: string, key: string): Step => ({
	label: `${marker} drawn again`,
	until: (now, before) =>
		occurrences(now, marker) > occurrences(before, marker),
	key,
});

/** Once the screen, as `frame` cuts it, matches `pattern`. */
export const matching = (
	pattern: RegExp,
	key: string,
	frame: (now: string) => string = now => now,
	act?: () => void,
): Step => ({
	label: `a frame matching ${pattern}`,
	until: now => pattern.test(frame(now)),
	key,
	act,
});

/** Opens a view through `start` on a fake terminal drawing to `out`. */
export const open = <T>(
	start: (
		input: InputStream & PassThrough,
		out: Captured,
	) => Promise<T>,
): Opened<T> => {
	const input = terminal();
	const out = screen();
	return { input, out, pending: start(input, out) };
};

/**
 * Sends each step's key once the screen satisfies it; a step the
 * screen never satisfies quits the view and fails with what it read.
 */
export async function drive<T>(
	{ input, out, pending }: Opened<T>,
	steps: readonly Step[],
	{
		timeoutMs = DEFAULT_TIMEOUT_MS,
		pollMs = POLL_MS,
		context = () => '',
	}: DriveOptions = {},
): Promise<Driven<T>> {
	for (const step of steps) {
		const before = stripVTControlCharacters(out.text());
		const deadline = Date.now() + timeoutMs;
		while (!step.until(stripVTControlCharacters(out.text()), before)) {
			if (Date.now() > deadline) {
				input.write('q');
				await Promise.race([
					pending.catch(() => undefined),
					Bun.sleep(QUIT_GRACE_MS),
				]);
				throw new Error(
					`the screen never showed ${step.label}; it reads:\n${stripVTControlCharacters(out.text()).slice(-TAIL)}\n${context()}`,
				);
			}
			await Bun.sleep(pollMs);
		}
		step.act?.();
		// A frame is drawn at commit, and the input handlers it mounts
		// subscribe in effects React has queued behind it; a key sent
		// before they run reaches no handler.
		await new Promise(resolve => setImmediate(resolve));
		if (step.key !== '') input.write(step.key);
	}
	const result = await pending;
	return {
		result,
		screen: stripVTControlCharacters(out.text()),
		raw: out.text(),
	};
}
