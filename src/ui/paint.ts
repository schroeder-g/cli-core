/** How a run of text is drawn: Ink's Text props, nothing more. */
interface Style {
	readonly color?: string;
	readonly dimColor?: boolean;
	readonly bold?: boolean;
	readonly underline?: boolean;
	readonly inverse?: boolean;
}

/** A run of text and its style; plain text has the empty style. */
export interface Segment {
	readonly text: string;
	readonly style: Style;
}

/**
 * What a pattern paints: every match of `pattern` in a line takes
 * `style`, or the style `style` derives from the match. A rule with
 * `when` paints only lines `when` matches.
 */
export interface Rule {
	readonly pattern: RegExp;
	readonly style: Style | ((match: RegExpExecArray) => Style);
	readonly when?: RegExp;
}

interface Span {
	readonly start: number;
	readonly end: number;
	readonly style: Style;
	readonly rank: number;
}

const PLAIN: Style = {};

/** Each pattern's global form, built once however often it scans. */
const globals = new WeakMap<RegExp, RegExp>();

const global = (pattern: RegExp): RegExp => {
	let scan = globals.get(pattern);
	if (scan === undefined) {
		scan = pattern.flags.includes('g')
			? pattern
			: new RegExp(pattern.source, `${pattern.flags}g`);
		globals.set(pattern, scan);
	}
	scan.lastIndex = 0;
	return scan;
};

/** Every match of `pattern` in `text` as a span of `rank`. */
function spansOf(
	text: string,
	pattern: RegExp,
	style: Rule['style'],
	rank: number,
): Span[] {
	const spans: Span[] = [];
	const scan = global(pattern);
	for (
		let match = scan.exec(text);
		match !== null;
		match = scan.exec(text)
	) {
		if (match[0] === '') {
			scan.lastIndex++;
			continue;
		}
		spans.push({
			start: match.index,
			end: match.index + match[0].length,
			style: typeof style === 'function' ? style(match) : style,
			rank,
		});
	}
	return spans;
}

/**
 * `spans` with every overlap resolved: earliest first, then lowest
 * rank.
 */
function settle(spans: readonly Span[]): Span[] {
	const kept: Span[] = [];
	let reach = 0;
	for (const span of [...spans].sort(
		(a, b) => a.start - b.start || a.rank - b.rank,
	)) {
		if (span.start < reach) continue;
		kept.push(span);
		reach = span.end;
	}
	return kept;
}

/** `text` cut into segments by `spans`, the gaps plain. */
function segmentsOf(text: string, spans: readonly Span[]): Segment[] {
	const segments: Segment[] = [];
	let at = 0;
	for (const span of spans) {
		if (span.start > at)
			segments.push({ text: text.slice(at, span.start), style: PLAIN });
		segments.push({
			text: text.slice(span.start, span.end),
			style: span.style,
		});
		at = span.end;
	}
	if (at < text.length)
		segments.push({ text: text.slice(at), style: PLAIN });
	return segments;
}

/**
 * `text` painted by `rules`: where two rules match the same text, the
 * earlier start wins, then the earlier rule.
 */
export function paint(text: string, rules: readonly Rule[]): Segment[] {
	if (text === '') return [];
	const spans = rules.flatMap((rule, rank) =>
		rule.when !== undefined && !rule.when.test(text)
			? []
			: spansOf(text, rule.pattern, rule.style, rank),
	);
	return segmentsOf(text, settle(spans));
}

/**
 * `segments` with every match of `pattern` inverted over its style, so
 * what a filter matched shows through the colours.
 */
export function highlight(
	segments: readonly Segment[],
	pattern: RegExp | undefined,
): Segment[] {
	if (pattern === undefined) return [...segments];
	return segments.flatMap(({ text, style }) => {
		const spans = spansOf(
			text,
			pattern,
			{ ...style, inverse: true },
			0,
		);
		return spans.length === 0
			? [{ text, style }]
			: segmentsOf(text, spans).map(segment =>
					segment.style === PLAIN
						? { text: segment.text, style }
						: segment,
				);
	});
}
