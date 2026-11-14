import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiFieldError } from '@safezone/types';
import type { Observable } from 'rxjs';
import type { z } from 'zod';
import { ValidationError } from '../errors/domain-error';
import { CONTRACT_KEY, type RouteContract, type ValidatedRequest } from './contract';

interface RawRequest extends ValidatedRequest {
  params: unknown;
  query: unknown;
  body: unknown;
}

export function zodIssuesToFieldErrors(
  issues: readonly z.core.$ZodIssue[],
  prefix: string,
): ApiFieldError[] {
  return issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

/** Validates params, query and body against the route's @Contract before the handler runs. */
@Injectable()
export class ContractInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const contract = this.reflector.get<RouteContract | undefined>(
      CONTRACT_KEY,
      context.getHandler(),
    );
    if (!contract) return next.handle();

    const request = context.switchToHttp().getRequest<RawRequest>();
    const validated: NonNullable<ValidatedRequest['validated']> = {};
    const errors: ApiFieldError[] = [];

    for (const part of ['params', 'query', 'body'] as const) {
      const schema = contract[part];
      if (!schema) continue;
      const result = schema.safeParse(request[part] ?? (part === 'body' ? undefined : {}));
      if (result.success) validated[part] = result.data;
      else errors.push(...zodIssuesToFieldErrors(result.error.issues, part));
    }

    if (errors.length > 0) throw new ValidationError(errors);
    request.validated = validated;
    return next.handle();
  }
}
