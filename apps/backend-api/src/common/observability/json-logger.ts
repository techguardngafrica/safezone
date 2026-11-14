import type { LoggerService } from '@nestjs/common';
import { requestContext } from '../http/request-context';
import { maskString, redact } from './redact';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON logger for every process. One line per entry with time, level, context and the
 * current request id; all values pass through redact() so PII and secrets never reach the logs.
 */
export class JsonLogger implements LoggerService {
  constructor(
    private readonly minLevel: Level = 'info',
    private readonly service = 'backend-api',
    private readonly write: (line: string) => void = (line) => process.stdout.write(line),
  ) {}

  log(message: unknown, ...params: unknown[]): void {
    this.emit('info', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  /** Nest calls error(message, stack?, context?). */
  error(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }

  private emit(level: Level, message: unknown, params: unknown[]): void {
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const context = typeof params.at(-1) === 'string' ? (params.at(-1) as string) : undefined;
    const rest = context === undefined ? params : params.slice(0, -1);
    const stack = level === 'error' && typeof rest[0] === 'string' ? rest[0] : undefined;
    const store = requestContext.get();

    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      service: this.service,
      ...(context ? { context } : {}),
      ...(store?.requestId ? { requestId: store.requestId } : {}),
      ...(store?.userId ? { userId: store.userId } : {}),
      ...(store?.estateId ? { estateId: store.estateId } : {}),
    };

    if (typeof message === 'object' && message !== null && !(message instanceof Error)) {
      Object.assign(entry, redact(message));
    } else if (message instanceof Error) {
      entry.msg = maskString(message.message);
      entry.err = {
        name: message.name,
        stack: message.stack ? maskString(message.stack) : undefined,
      };
    } else {
      entry.msg = maskString(String(message));
    }
    if (stack) entry.stack = maskString(stack);

    this.write(`${JSON.stringify(entry)}\n`);
  }
}
