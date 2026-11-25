/** What the selected row opens with. */
export const POINTER = '▸';

/** How two things on one line keep apart. */
export const SEPARATOR = ' · ';

/**
 * How a state reads at a glance, whatever the domain calls it: busy
 * work, a thing that is up, one that failed, one that was never
 * touched, one that ended, and a step passed or left out.
 */
export type Tone =
	| 'busy'
	| 'ready'
	| 'failed'
	| 'idle'
	| 'ended'
	| 'done'
	| 'skipped';

export interface Look {
	readonly glyph: string;
	readonly color: string | undefined;
}

export const LOOKS: Readonly<Record<Tone, Look>> = {
	busy: { glyph: '…', color: 'yellow' },
	ready: { glyph: '●', color: 'green' },
	failed: { glyph: '✗', color: 'red' },
	idle: { glyph: '○', color: undefined },
	ended: { glyph: '◌', color: undefined },
	done: { glyph: '✓', color: 'green' },
	skipped: { glyph: '–', color: undefined },
};
