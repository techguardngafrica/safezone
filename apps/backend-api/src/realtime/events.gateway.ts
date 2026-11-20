import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { DatabaseService } from '../common/database/database.service';
import {
  REALTIME_REDIS_CHANNEL,
  type RealtimeMessage,
} from '../common/realtime/realtime-publisher.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthzService } from '../modules/authz/authz.service';
import { TokenService } from '../modules/identity/token.service';
import { parseRoom } from './room-auth';

interface SocketData {
  userId?: string;
}

function extractToken(client: Socket): string | null {
  const auth = client.handshake.auth as Record<string, unknown> | undefined;
  if (typeof auth?.token === 'string' && auth.token.length > 0) return auth.token;
  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || null;
  }
  return null;
}

/**
 * Authenticated Socket.IO gateway (backend-api.md §12).
 * Verifies the JWT access token on connect, authorises every room join via AuthzService, and forwards
 * Redis Pub/Sub realtime messages to local sockets (preventing duplicate emits across scaled pods).
 */
@WebSocketGateway()
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EventsGateway.name);
  private subscriber: Redis | undefined;

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokenService,
    private readonly authz: AuthzService,
    private readonly db: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = new Redis(this.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      connectionName: 'safezone-realtime-events',
    });
    this.subscriber.on('error', (error: Error) =>
      this.logger.warn({ msg: 'realtime subscriber error', error: error.name }),
    );
    this.subscriber.on('message', (_channel: string, raw: string) => {
      try {
        const message = JSON.parse(raw) as RealtimeMessage;
        if (message.room && message.event) {
          this.server.local.to(message.room).emit(message.event, message.data);
        }
      } catch {
        this.logger.warn({ msg: 'malformed realtime message dropped' });
      }
    });
    await this.subscriber.subscribe(REALTIME_REDIS_CHANNEL);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber && this.subscriber.status !== 'end') {
      await this.subscriber.quit();
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = extractToken(client);
    const claims = token ? this.tokens.verifyAccessToken(token) : null;
    if (!claims) {
      client.emit('auth:error', { code: 'UNAUTHORIZED' });
      client.disconnect(true);
      return;
    }
    (client.data as SocketData).userId = claims.sub;
    await client.join(`user:${claims.sub}`);
    this.logger.debug(`client connected ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`client disconnected ${client.id}`);
  }

  @SubscribeMessage('ping')
  ping(): { event: 'pong'; data: { at: string } } {
    return { event: 'pong', data: { at: new Date().toISOString() } };
  }

  @SubscribeMessage('room:join')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: string },
  ): Promise<{ ok: boolean; room?: string; error?: string }> {
    const userId = (client.data as SocketData).userId;
    if (!userId) return { ok: false, error: 'UNAUTHORIZED' };
    const room = typeof body?.room === 'string' ? body.room : '';
    const parsed = parseRoom(room);
    if (!parsed) return { ok: false, error: 'INVALID_ROOM' };

    const allowed = await this.canJoin(userId, parsed);
    if (!allowed) return { ok: false, error: 'FORBIDDEN' };

    await client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('room:leave')
  async leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: string },
  ): Promise<{ ok: boolean; room?: string }> {
    const room = typeof body?.room === 'string' ? body.room : '';
    if (room) await client.leave(room);
    return { ok: true, room };
  }

  private async canJoin(
    userId: string,
    room: NonNullable<ReturnType<typeof parseRoom>>,
  ): Promise<boolean> {
    if (room.kind === 'channel') {
      return this.db.withTenant({ estateId: room.estateId, userId }, async (tx) => {
        const member = await tx.channelMember.findFirst({
          where: {
            estateId: room.estateId,
            channelId: room.channelId,
            userId,
            status: 'active',
          },
          select: { userId: true },
        });
        return Boolean(member);
      });
    }

    const assignments = await this.authz.activeAssignments(userId);
    const grant = this.authz.grantIn(assignments, room.estateId);
    if (grant.roles.length === 0) return false;

    if (room.kind === 'sos') return grant.permissions.has('sos.respond');
    if (room.kind === 'security' || room.kind === 'gate') {
      return grant.permissions.has('visitor.log.read') || grant.permissions.has('gate.verify');
    }
    return true;
  }
}
