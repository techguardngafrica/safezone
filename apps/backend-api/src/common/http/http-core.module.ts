import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ContractInterceptor } from '../contract/contract.interceptor';
import { ApiExceptionFilter } from '../errors/api-exception.filter';
import { RequestIdMiddleware } from './request-id.middleware';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

/**
 * HTTP cross-cutting behaviour for every REST process: request ids and access logs, request validation
 * from @Contract, the success envelope and the error envelope. Registered as app-level providers so tests
 * that compile AppModule get exactly the production behaviour.
 */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
  ],
})
export class HttpCoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
