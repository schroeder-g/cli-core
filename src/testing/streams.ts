import { PassThrough, Writable } from 'node:stream';

import type { InputStream, OutputStream } from '../core/streams.ts';

export interface Captured extends OutputStream {
	readonly text: () => string;
}

/** An output stream that keeps what was written, off a terminal. */
export function capture(): Captured {
	let text = '';
	const stream = new Writable({
		write(chunk: Buffer | string, _encoding, callback) {
			text += chunk.toString();
			callback();
		},
	});
	return Object.assign(stream, { isTTY: false, text: () => text });
}

/** A stdin that claims to be a terminal and takes raw mode. */
export const terminal = (): InputStream & PassThrough =>
	Object.assign(new PassThrough(), {
		isTTY: true,
		setRawMode() {},
		ref() {},
		unref() {},
	});

/** An output that claims to be a terminal, so Ink draws every frame. */
export const screen = (): Captured =>
	Object.assign(capture(), { isTTY: true, columns: 80, rows: 24 });

/** A stdin holding `lines`, then ended. */
export function stdin(opts: {
	readonly tty: boolean;
	readonly lines?: readonly string[];
}): InputStream {
	const stream = new PassThrough();
	for (const line of opts.lines ?? []) stream.write(`${line}\n`);
	stream.end();
	return Object.assign(stream, { isTTY: opts.tty });
}
