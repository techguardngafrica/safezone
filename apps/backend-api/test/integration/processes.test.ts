import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportsConsumer } from '../../src/modules/imports/imports.consumer';
import { EventsGateway } from '../../src/realtime/events.gateway';
import { RealtimeModule } from '../../src/realtime/realtime.module';
import { WorkerModule } from '../../src/worker/worker.module';
import { startTestStack, type TestStack } from './support/app';

/**
 * The worker and realtime processes have their own root modules. Compiling them proves every provider
 * they declare can be constructed (dependency wiring), without starting queue consumers or sockets.
 */
describe('process root modules', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack(); // sets DATABASE_URL / REDIS_URL for the modules below
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('wires the worker, including the imports consumer', async () => {
    const worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(worker.get(ImportsConsumer)).toBeInstanceOf(ImportsConsumer);
    await worker.close();
  });

  it('wires the realtime gateway', async () => {
    const realtime = await Test.createTestingModule({ imports: [RealtimeModule] }).compile();
    expect(realtime.get(EventsGateway)).toBeInstanceOf(EventsGateway);
    await realtime.close();
  });
});
