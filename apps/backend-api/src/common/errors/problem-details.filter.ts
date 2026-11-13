import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ProblemDetails } from '@safezone/types';
import type { Request, Response } from 'express';

/**
 * Maps every error to RFC 9457 application/problem+json (backend-api.md §6.3).
 * Domain errors should extend DomainError so they carry a stable `code`.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY,
  ) {
    super(message);
  }
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = request.header('x-request-id') ?? undefined;

    let problem: ProblemDetails;
    if (exception instanceof DomainError) {
      problem = this.build(exception.status, exception.code, exception.message, requestId);
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      problem = this.build(
        status,
        HttpStatus[status] ?? 'HTTP_ERROR',
        exception.message,
        requestId,
      );
    } else {
      // Never leak internals; log the error (without request bodies, which may hold PII).
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      problem = this.build(500, 'INTERNAL_ERROR', 'Something went wrong', requestId);
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private build(status: number, code: string, detail: string, requestId?: string): ProblemDetails {
    const slug = code.toLowerCase().replace(/_/g, '-');
    return {
      type: `https://docs.safezone.ng/errors/${slug}`,
      title: detail,
      status,
      code,
      ...(requestId ? { requestId } : {}),
    };
  }
}
