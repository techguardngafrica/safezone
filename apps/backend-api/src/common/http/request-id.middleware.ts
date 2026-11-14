import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from '../ids/uuidv7';
import { requestContext } from './request-context';

const INCOMING_ID = /^[A-Za-z0-9_-]{8,128}$/;
const APP_HEADER = /^[a-z-]{3,40}$/;

/**
 * Assigns a request id (or keeps a well-formed incoming X-Request-Id), echoes it in the response,
 * opens the request context and writes one access log line per request.
 * The log line has the route path only: query strings can carry tokens.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Http');

  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.header('x-request-id');
    const requestId = incoming && INCOMING_ID.test(incoming) ? incoming : uuidv7();
    const app = request.header('x-safezone-app');
    response.setHeader('X-Request-Id', requestId);

    const started = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      this.logger.log({
        msg: 'request',
        method: request.method,
        path: request.baseUrl + request.path,
        status: response.statusCode,
        durationMs: Math.round(durationMs),
      });
    });

    requestContext.run({ requestId, ...(app && APP_HEADER.test(app) ? { app } : {}) }, () =>
      next(),
    );
  }
}
