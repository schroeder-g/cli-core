import { LOCAL_HOST, until } from './ports.ts';

/** How long one probe waits for an answer. */
const PROBE_TIMEOUT_MS = 2_000;

/** How a server says it is well. */
export interface HealthCheck {
	/** The path asked, from the server's root. */
	readonly path: string;
	/**
	 * Whether only a 2xx is well; otherwise any answer under 500 is,
	 * as for a page that a dev server compiles on its first request.
	 */
	readonly strict: boolean;
}

export interface Health {
	readonly ok: boolean;
	/** What the probe saw: the status and path, or why there was none. */
	readonly detail: string;
}

/** Asks the server on `port` the check's path once. */
export async function probe(
	port: number,
	{ path, strict }: HealthCheck,
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<Health> {
	try {
		const response = await fetch(
			`http://${LOCAL_HOST}:${port}${path}`,
			{
				redirect: 'manual',
				signal: AbortSignal.timeout(timeoutMs),
			},
		);
		await response.body?.cancel();
		const { status } = response;
		const ok = strict ? status >= 200 && status < 300 : status < 500;
		return { ok, detail: `${status} on ${path}` };
	} catch (error) {
		const reason =
			error instanceof Error && error.name === 'TimeoutError'
				? `no answer on ${path} within ${timeoutMs / 1000} s`
				: `nothing answers on ${path}`;
		return { ok: false, detail: reason };
	}
}

/**
 * Probes until the server is well or `timeoutMs` passes, and answers
 * the last probe's health.
 */
export async function awaitHealthy(
	port: number,
	check: HealthCheck,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<Health> {
	let last: Health = {
		ok: false,
		detail: `nothing answers on ${check.path}`,
	};
	await until(
		async () => {
			last = await probe(port, check);
			return last.ok;
		},
		timeoutMs,
		signal,
	);
	return last;
}
