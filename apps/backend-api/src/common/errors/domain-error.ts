import type { ApiFieldError } from '@safezone/types';

/**
 * Typed domain error. Services throw these; ApiExceptionFilter maps them to the error envelope.
 * `code` is stable UPPER_SNAKE (catalogued in docs/api/error-codes.md); `message` is shown to users,
 * so it must never contain personal data, secrets or internal details.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number = 422,
    readonly details?: readonly ApiFieldError[],
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Not found', code = 'NOT_FOUND') {
    super(code, message, 404);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to do this', code = 'FORBIDDEN') {
    super(code, message, 403);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Sign in to continue', code = 'UNAUTHORIZED') {
    super(code, message, 401);
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

export class ValidationError extends DomainError {
  constructor(details: readonly ApiFieldError[], message = 'Some fields are invalid') {
    super('VALIDATION_FAILED', message, 400, details);
  }
}

export class RateLimitedError extends DomainError {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'Too many attempts. Try again later.',
  ) {
    super('RATE_LIMITED', message, 429);
  }
}
