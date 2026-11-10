import pino from 'pino';

/** Structured JSON logger. Never log secrets, API keys or full webhook bodies. */
export function createLogger(level: string, service: string) {
  return pino({
    level,
    base: { service },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.secret',
        '*.apiKey',
        '*.signature',
        '*.body',
      ],
      censor: '[redacted]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
