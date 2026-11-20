import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { RedisService } from '../redis/redis.module';

export const REALTIME_REDIS_CHANNEL = 'safezone:realtime:emit';

export interface RealtimeMessage {
  room: string;
  event: string;
  data: Record<string, unknown>;
}

/** Maps domain outbox events to Socket.IO rooms so every process fans out consistently. */
export function realtimeTargetsForOutbox(event: {
  type: string;
  estateId: string | null;
  aggregateId: string;
  payload: unknown;
  occurredAt: string;
}): RealtimeMessage[] {
  const payload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : {};
  // Envelope fields last, so a payload can never overwrite the event type or estate.
  const data = {
    ...payload,
    type: event.type,
    estateId: event.estateId,
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt,
  };

  if (event.type.startsWith('emergency.alert.') && event.estateId) {
    return [
      { room: `estate:${event.estateId}:sos`, event: 'sos:update', data },
      { room: `estate:${event.estateId}:dashboard`, event: 'sos:update', data },
    ];
  }

  if (
    (event.type.startsWith('visitor.gate.') || event.type.startsWith('visitor.walkin.')) &&
    event.estateId
  ) {
    const out: RealtimeMessage[] = [
      { room: `estate:${event.estateId}:security`, event: 'gate:update', data },
    ];
    if (typeof payload.gateId === 'string') {
      out.push({
        room: `estate:${event.estateId}:gate:${payload.gateId}`,
        event: 'gate:update',
        data,
      });
    }
    return out;
  }

  if (
    event.type === 'community.message.created' &&
    event.estateId &&
    typeof payload.channelId === 'string'
  ) {
    return [
      {
        room: `estate:${event.estateId}:channel:${payload.channelId}`,
        event: 'channel:message',
        data,
      },
    ];
  }

  return [];
}

/**
 * Publishes realtime events over Redis Pub/Sub to the Socket.IO realtime gateway process.
 * Best-effort: never throws so critical paths (SOS, gate events) are never blocked.
 */
@Injectable()
export class RealtimePublisherService {
  private readonly logger = new Logger(RealtimePublisherService.name);

  constructor(private readonly redis: RedisService) {}

  async publish(message: RealtimeMessage): Promise<void> {
    try {
      await this.redis.client.publish(REALTIME_REDIS_CHANNEL, JSON.stringify(message));
    } catch (error) {
      this.logger.warn({
        msg: 'realtime publish failed',
        room: message.room,
        event: message.event,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  async publishMany(messages: readonly RealtimeMessage[]): Promise<void> {
    for (const message of messages) {
      await this.publish(message);
    }
  }
}

@Global()
@Module({
  providers: [RealtimePublisherService],
  exports: [RealtimePublisherService],
})
export class RealtimePublisherModule {}
