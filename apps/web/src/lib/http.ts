import { randomUUID } from 'node:crypto';
import { ApiError, ApiErrorCode, formatZodIssues } from '@cryptopay/shared';
import { ZodError } from 'zod';
import { logger } from './logger';

export interface RequestContext {
  requestId: string;
  ip: string;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : '127.0.0.1';
}

export function requestIdOf(request: Request): string {
  const incoming = request.headers.get('x-request-id');
  if (incoming && /^[A-Za-z0-9._-]{1,100}$/.test(incoming)) return incoming;
  return `req_${randomUUID()}`;
}

export function jsonOk(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function jsonError(error: ApiError, requestId: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.details ? { details: error.details } : {}),
      },
    }),
    {
      status: error.status,
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    },
  );
}

type Handler<P extends Record<string, string>> = (
  request: Request,
  context: RequestContext,
  params: P,
) => Promise<Response>;

/**
 * Wraps a route handler with request ids, uniform errors and structured logging.
 * Unexpected errors never leak internals to the caller.
 */
export function route<P extends Record<string, string> = Record<string, string>>(
  handler: Handler<P>,
) {
  return async (
    request: Request,
    routeContext?: { params?: Promise<P> },
  ): Promise<Response> => {
    const requestId = requestIdOf(request);
    const context: RequestContext = { requestId, ip: clientIp(request) };
    const startedAt = Date.now();

    try {
      const params = routeContext?.params ? await routeContext.params : ({} as P);
      const response = await handler(request, context, params);
      response.headers.set('x-request-id', requestId);
      logger.info('request', {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      if (error instanceof ApiError) {
        logger.warn('request rejected', {
          requestId,
          code: error.code,
          path: new URL(request.url).pathname,
        });
        return jsonError(error, requestId);
      }
      if (error instanceof ZodError) {
        return jsonError(
          new ApiError(
            ApiErrorCode.ValidationFailed,
            'Request validation failed',
            422,
            formatZodIssues(error),
          ),
          requestId,
        );
      }
      logger.error('unhandled error', {
        requestId,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonError(
        new ApiError(ApiErrorCode.InternalError, 'An unexpected error occurred'),
        requestId,
      );
    }
  };
}

/** Parse and validate a JSON request body. */
export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError(ApiErrorCode.BadRequest, 'Content-Type must be application/json');
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError(ApiErrorCode.BadRequest, 'Request body is not valid JSON');
  }
}

const buckets = new Map<string, number[]>();

/**
 * Fixed-window rate limiter. In-process because the MVP runs a single web instance;
 * Phase 4 moves the buckets to Redis when the web tier is scaled out.
 */
export function checkRateLimit(bucket: string, limit: number, windowMs = 60_000): void {
  const now = Date.now();
  const hits = (buckets.get(bucket) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (hits.length >= limit) {
    const oldest = hits[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    throw new ApiError(
      ApiErrorCode.RateLimited,
      `Rate limit exceeded. Retry in ${retryAfterSeconds}s`,
      429,
    );
  }
  hits.push(now);
  buckets.set(bucket, hits);
}

/** Test helper: clear in-process rate limit state. */
export function resetRateLimits(): void {
  buckets.clear();
}
