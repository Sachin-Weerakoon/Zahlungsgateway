import { createServer } from 'node:http';
import type { Logger } from './logger.js';

export interface WorkerHealthStats {
  pending: number;
  failedLast24h: number;
  succeededLast24h: number;
  lastDeliveryAt: string | null;
}

/**
 * Worker health endpoint. `/healthz` is liveness, `/readyz` requires database access so the
 * queue is observable and a stuck worker is restarted by the orchestrator.
 */
export function startHealthServer(
  port: number,
  logger: Logger,
  getStats: () => Promise<WorkerHealthStats>,
) {
  const startedAt = Date.now();

  const server = createServer(async (request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'ok',
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        }),
      );
      return;
    }

    if (request.url === '/readyz') {
      try {
        const stats = await getStats();
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ready: true, ...stats }));
      } catch (error) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ready: false,
            error: error instanceof Error ? error.message : 'health check failed',
          }),
        );
      }
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(port, () => logger.info({ port }, 'worker health server listening'));

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
