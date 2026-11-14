import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiSuccessBody, Page } from '@safezone/types';
import { map, type Observable } from 'rxjs';
import { CONTRACT_KEY, type RouteContract } from '../contract/contract';

export const RAW_RESPONSE_KEY = 'safezone:raw-response';
/** Opt out of the envelope (redirects, file streams). Use sparingly. */
export const RawResponse = (): MethodDecorator => SetMetadata(RAW_RESPONSE_KEY, true);

function isPage(value: unknown): value is Page<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    'nextCursor' in value
  );
}

/**
 * Wraps every successful response in `{ success: true, data, meta? }` (AGENTS.md §5.6).
 * When the route has a @Contract response schema, data is parsed with it, so fields not in the schema
 * (password hashes, internal flags) never leave the API. A mismatch is a server bug and becomes a 500.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const handler = context.getHandler();
    if (this.reflector.get<boolean>(RAW_RESPONSE_KEY, handler)) return next.handle();
    const contract = this.reflector.get<RouteContract | undefined>(CONTRACT_KEY, handler);

    return next.handle().pipe(
      map((value: unknown): ApiSuccessBody<unknown> | undefined => {
        if (contract?.status === 204) return undefined;
        if (contract?.paginated || isPage(value)) {
          if (!isPage(value)) throw new Error('Paginated route returned a non-page value');
          const items = contract?.response
            ? value.items.map((item) => contract.response?.parse(item))
            : value.items;
          return { success: true, data: items, meta: { nextCursor: value.nextCursor } };
        }
        const data = contract?.response ? contract.response.parse(value) : (value ?? null);
        return { success: true, data };
      }),
    );
  }
}
