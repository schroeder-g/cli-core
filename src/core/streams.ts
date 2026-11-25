export interface InputStream extends NodeJS.ReadableStream {
	readonly isTTY?: boolean;
}

export interface OutputStream extends NodeJS.WritableStream {
	readonly isTTY?: boolean;
}

/** The streams a run reads and writes: the process's, or injected. */
export interface Streams {
	readonly stdin: InputStream;
	readonly stdout: OutputStream;
	readonly stderr: OutputStream;
}

/** Where forwarded output goes and what the terminal rule reads. */
export type OutputStreams = Pick<Streams, 'stdout' | 'stderr'>;

export const lineWriter =
	(stream: OutputStream): ((line: string) => void) =>
	line => {
		stream.write(`${line}\n`);
	};
