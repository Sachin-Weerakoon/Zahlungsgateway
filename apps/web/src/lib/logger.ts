/** Structured JSON logging for the web app. Never log secrets, keys or full bodies. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? 'info') as Level;
  return LEVEL_ORDER[configured] ?? LEVEL_ORDER.info;
}

function write(level: Level, message: string, context: Record<string, unknown> = {}): void {
  if (LEVEL_ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: 'web',
    message,
    ...context,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
};
