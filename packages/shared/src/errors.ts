import { ApiErrorCode } from './enums.js';

/** Standard API error body (SRS 6.4). */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | string;
    message: string;
    requestId: string;
    details?: Array<{ path: string; message: string }>;
  };
}

const DEFAULT_STATUS: Record<string, number> = {
  [ApiErrorCode.BadRequest]: 400,
  [ApiErrorCode.Unauthorized]: 401,
  [ApiErrorCode.Forbidden]: 403,
  [ApiErrorCode.NotFound]: 404,
  [ApiErrorCode.Conflict]: 409,
  [ApiErrorCode.ValidationFailed]: 422,
  [ApiErrorCode.RateLimited]: 429,
  [ApiErrorCode.InvoiceNotPayable]: 409,
  [ApiErrorCode.InvoiceExpired]: 409,
  [ApiErrorCode.IdempotencyConflict]: 409,
  [ApiErrorCode.WebhookUrlRejected]: 422,
  [ApiErrorCode.RpcUnavailable]: 503,
  [ApiErrorCode.InternalError]: 500,
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Array<{ path: string; message: string }>;

  constructor(
    code: string,
    message: string,
    status?: number,
    details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code] ?? 500;
    this.details = details;
  }
}

export function toErrorBody(error: ApiError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}
