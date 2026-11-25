export * from '@optique/core/constructs';
export * from '@optique/core/message';
export * from '@optique/core/modifiers';
export * from '@optique/core/nonempty';
export * from '@optique/core/primitives';
export * from '@optique/core/valueparser';
// message's url, a link term, yields to the value parser, as in
// Optique's own root; link() is that term.
export { url } from '@optique/core/valueparser';
export {
	getDocPage,
	parse,
	parseAsync,
	parseSync,
	suggest,
	suggestAsync,
	suggestSync,
} from '@optique/core/parser';
export type {
	DocState,
	InferMode,
	InferValue,
	Mode,
	ModeValue,
	Parser,
	ParserContext,
	ParserResult,
	Result,
	Suggestion,
} from '@optique/core/parser';
export { isDocEntryHidden } from '@optique/core/doc';
export type { DocEntry, DocPage, DocSection } from '@optique/core/doc';
export type { OptionName, Usage, UsageTerm } from '@optique/core/usage';
export * from './options.ts';
