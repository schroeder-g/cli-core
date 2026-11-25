import { createServer } from 'node:net';

import { LOCAL_HOST } from '../process/ports.ts';

export interface HeldPort {
	readonly port: number;
	release(): Promise<void>;
}

/** A loopback port nothing listens on. */
export const freePort = (): Promise<number> =>
	new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, LOCAL_HOST, () => {
			const address = probe.address();
			const port = typeof address === 'object' ? address?.port : 0;
			probe.close(() => resolve(port ?? 0));
		});
	});

/** A loopback port this process listens on until released. */
export const holdPort = (): Promise<HeldPort> =>
	new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, LOCAL_HOST, () => {
			const address = server.address();
			resolve({
				port: typeof address === 'object' ? (address?.port ?? 0) : 0,
				release: () =>
					new Promise(done => {
						server.close(() => done());
					}),
			});
		});
	});
