import { createServer } from 'node:http';
import type { Logger } from './logger.js';

export interface HealthState {
  startedAt: number;
  lastProcessedBlock: bigint | null;
  latestBlock: bigint | null;
  rpcHealthy: boolean;
  lastError: string | null;
}

/**
 * Health endpoint for container probes and the admin health page.
 * `/healthz` is liveness; `/readyz` requires a healthy RPC and a persisted cursor.
 */
export function startHealthServer(port: number, logger: Logger, state: HealthState) {
  const server = createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'ok',
          uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
          lastProcessedBlock: state.lastProcessedBlock?.toString() ?? null,
          latestBlock: state.latestBlock?.toString() ?? null,
          lagBlocks:
            state.latestBlock !== null && state.lastProcessedBlock !== null
              ? Number(state.latestBlock - state.lastProcessedBlock)
              : null,
          rpcHealthy: state.rpcHealthy,
          lastError: state.lastError,
        }),
      );
      return;
    }
    if (request.url === '/readyz') {
      const ready = state.rpcHealthy && state.lastProcessedBlock !== null;
      response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ready }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(port, () => logger.info({ port }, 'indexer health server listening'));

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
