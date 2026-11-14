import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { ApiErrorBody, ApiFieldError } from '@safezone/types';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { requestContext } from '../http/request-context';
import { maskString } from '../observability/redact';
import { DomainError, RateLimitedError } from './domain-error';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

const SAFE_MESSAGES: Record<number, string> = {
  400: 'The request is not valid',
  401: 'Sign in to continue',
  403: 'You do not have permission to do this',
  404: 'Not found',
  405: 'Method not allowed',
  413: 'The request is too large',
  415: 'Unsupported content type',
  429: 'Too many attempts. Try again later.',
  503: 'The service is temporarily unavailable',
};

interface Mapped {
  statusCode: number;
  code: string;
  message: string;
  details?: readonly ApiFieldError[];
}

/**
 * The one place errors become responses: `{ success: false, error: { code, message, statusCode } }`.
 * Unknown errors are logged (masked) and reported to Sentry, and the client gets a generic 500:
 * no stack traces or internal details in any environment.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = this.map(exception);

    if (mapped.statusCode >= 500 && mapped.statusCode !== 503) {
      // Masked before it reaches any logger (the default Nest logger in tests does not mask).
      const stack =
        exception instanceof Error && exception.stack ? maskString(exception.stack) : undefined;
      this.logger.error(
        maskString(exception instanceof Error ? exception.message : String(exception)),
        stack,
      );
      Sentry.captureException(exception);
    }
    if (exception instanceof RateLimitedError) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }

    const requestId = requestContext.get()?.requestId;
    const body: ApiErrorBody = {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        statusCode: mapped.statusCode,
        ...(requestId ? { requestId } : {}),
        ...(mapped.details ? { details: mapped.details } : {}),
      },
    };
    response.status(mapped.statusCode).json(body);
  }

  private map(exception: unknown): Mapped {
    if (exception instanceof DomainError) {
      return {
        statusCode: exception.statusCode,
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      if (statusCode >= 500 && statusCode !== 503) return this.internal();
      const body = exception.getResponse();
      const ownMessage =
        typeof body === 'object' &&
        body !== null &&
        typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : undefined;
      // Nest's own 404 says "Cannot GET /path"; keep messages generic for framework errors.
      const message =
        statusCode === 404 || statusCode === 400
          ? (SAFE_MESSAGES[statusCode] ?? 'Request failed')
          : (ownMessage ?? SAFE_MESSAGES[statusCode] ?? 'Request failed');
      return {
        statusCode,
        code: STATUS_CODES[statusCode] ?? HttpStatus[statusCode] ?? 'HTTP_ERROR',
        message,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { statusCode: 409, code: 'CONFLICT', message: 'This record already exists' };
      }
      if (exception.code === 'P2025') {
        return { statusCode: 404, code: 'NOT_FOUND', message: 'Not found' };
      }
    }
    if (isBodyParserError(exception)) {
      return {
        statusCode: exception.status,
        code: STATUS_CODES[exception.status] ?? 'BAD_REQUEST',
        message: SAFE_MESSAGES[exception.status] ?? 'The request is not valid',
      };
    }
    return this.internal();
  }

  private internal(): Mapped {
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.' };
  }
}

function isBodyParserError(value: unknown): value is { status: number; type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { status?: unknown }).status === 'number' &&
    (value as { status: number }).status >= 400 &&
    (value as { status: number }).status < 500
  );
}
