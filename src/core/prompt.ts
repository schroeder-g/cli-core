import { createInterface } from 'node:readline';

import { Refusal } from './errors.ts';
import type { InputStream, OutputStream } from './streams.ts';

export interface LineReader {
	/**
	 * Writes the question to stderr and answers the next line of stdin;
	 * rejects with a `Refusal` when the input ends before an answer.
	 */
	prompt(question: string): Promise<string>;
	close(): void;
}

// One reader per run over readline's own line buffer: lines that arrive
// before they are asked for wait in order, and the end of input refuses
// every question after it.
export function lineReader(
	stdin: InputStream,
	stderr: OutputStream,
): LineReader {
	let lines: AsyncIterator<string> | undefined;
	return {
		async prompt(question) {
			stderr.write(question);
			lines ??= createInterface({ input: stdin, terminal: false })[
				Symbol.asyncIterator
			]();
			const next = await lines.next();
			if (next.done)
				throw new Refusal(
					`no answer to ${JSON.stringify(question)}: input ended`,
				);
			return next.value;
		},
		close() {
			void lines?.return?.();
		},
	};
}
