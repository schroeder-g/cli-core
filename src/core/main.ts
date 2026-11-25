/**
 * Runs a program as its process's entry: `program` gets `argv`, the
 * arguments after the script's by default, and the code it answers
 * becomes the process's. A reader that closes early, `prog | head`,
 * ends the process quietly with 0.
 *
 * @public
 */
export async function runMain(
	program: (argv: readonly string[]) => Promise<number>,
	argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
	for (const stream of [process.stdout, process.stderr])
		stream.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'EPIPE') process.exit(0);
			throw error;
		});
	// exitCode, not exit(): Bun exits once the queued writes have drained.
	process.exitCode = await program(argv);
}
