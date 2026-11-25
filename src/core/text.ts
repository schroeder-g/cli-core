/** The width a formatted size is right-aligned in: `1023.9 MB`. */
const SIZE_WIDTH = 9;

/** Whether `char` is a C0 control character or DEL. */
export const isControl = (char: string): boolean => {
	const code = char.charCodeAt(0);
	return code < 0x20 || code === 0x7f;
};

/** `char` as the text `\xNN`. */
export const hexEscape = (char: string): string =>
	`\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;

/**
 * Whether `word` is a dry run's stand-in for a value it never read,
 * `<what>`.
 */
export const isPlaceholder = (word: string): boolean =>
	/^<[^<>]+>$/.test(word);

/** The widest of `items` by `text`; 0 for none. */
export const widthOf = <T>(
	items: readonly T[],
	text: (item: T) => string,
): number =>
	items.reduce((width, item) => Math.max(width, text(item).length), 0);

/** The first line of `text`, trimmed: one line of a report. */
export const firstLine = (text: string): string =>
	text.trim().split('\n')[0] ?? '';

/**
 * The last line of `text`, trimmed: a tool's reason, as it printed it
 * last.
 */
export const lastLine = (text: string): string =>
	text.trim().split('\n').at(-1) ?? '';

/**
 * `text` as the terminal may show it: every control character but
 * those of `keep` written as `\xNN`, so the text cannot drive the
 * terminal.
 */
export const visibleText = (
	text: string,
	keep: readonly string[] = [],
): string =>
	Array.from(text, char =>
		keep.includes(char) || !isControl(char) ? char : hexEscape(char),
	).join('');

/** A size in the unit that reads best. */
function formatBytes(bytes: number): string {
	const units = ['B', 'kB', 'MB', 'GB'];
	let size = bytes;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit++;
	}
	return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
}

/**
 * Rows of a name padded to the widest, its size right-aligned, then the
 * rest.
 */
export const sizeRows = (
	rows: readonly {
		readonly name: string;
		readonly bytes: number;
		readonly rest: string;
	}[],
): string[] => {
	const width = widthOf(rows, ({ name }) => name);
	return rows.map(
		({ name, bytes, rest }) =>
			`${name.padEnd(width)}  ${formatBytes(bytes).padStart(SIZE_WIDTH)}  ${rest}`,
	);
};
