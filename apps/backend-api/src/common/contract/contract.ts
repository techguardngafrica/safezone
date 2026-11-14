import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  HttpCode,
  SetMetadata,
} from '@nestjs/common';
import type { z } from 'zod';

/**
 * Route contract: one place that declares a route's request and response schemas (from @safezone/schemas).
 * - ContractInterceptor validates params/query/body with it and exposes the parsed values.
 * - ResponseEnvelopeInterceptor strips the response to the declared shape (no accidental field leaks).
 * - The OpenAPI generator (scripts/generate-openapi.ts) reads it to document the route.
 */
export interface RouteContract {
  summary: string;
  tags?: readonly string[];
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** Schema of `data`. With `paginated`, the schema of one item. */
  response?: z.ZodType;
  paginated?: boolean;
  /** Success status; defaults to Nest's (200, or 201 for POST). */
  status?: number;
  /** Error statuses worth documenting beyond 400/401/500. */
  errors?: readonly number[];
}

export const CONTRACT_KEY = 'safezone:contract';

export function Contract(contract: RouteContract): MethodDecorator {
  const decorators: MethodDecorator[] = [SetMetadata(CONTRACT_KEY, contract)];
  if (contract.status !== undefined) decorators.push(HttpCode(contract.status));
  return applyDecorators(...decorators);
}

export interface ValidatedRequest {
  validated?: { params?: unknown; query?: unknown; body?: unknown };
}

function validatedPart(part: 'params' | 'query' | 'body') {
  return createParamDecorator((_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<ValidatedRequest>();
    if (!request.validated || !(part in request.validated)) {
      throw new Error(`@Valid${part} used on a route without a @Contract ${part} schema`);
    }
    return request.validated[part];
  })();
}

/** Parsed body from the route's @Contract({ body }). */
export const ValidBody = (): ParameterDecorator => validatedPart('body');
/** Parsed query from the route's @Contract({ query }). */
export const ValidQuery = (): ParameterDecorator => validatedPart('query');
/** Parsed path params from the route's @Contract({ params }). */
export const ValidParams = (): ParameterDecorator => validatedPart('params');
