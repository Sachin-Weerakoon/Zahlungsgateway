import { createServer } from 'node:http';
import type { Logger } from './logger.js';

/**
 * Minimal worker health endpoint (Phase 0 skeleton).
 * Phase 3 adds queue depth and webhook failure-rate metrics.
 */
export function startHealthServer(port: number, logger: Logger) {
  const startedAt = Date.now();
  const server = createServer((request, response) => {
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
