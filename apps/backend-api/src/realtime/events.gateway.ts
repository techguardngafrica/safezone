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
import {
  REALTIME_REDIS_CHANNEL,
  type RealtimeMessage,
} from '../common/realtime/realtime-publisher.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthzService } from '../modules/authz/authz.service';
import { ChannelMembershipReader } from '../modules/community/channel-membership.service';
import { TokenService } from '../modules/identity/token.service';
import { TenancyService } from '../modules/tenancy/tenancy.service';
import { canonicalRoom, parseRoom, staffMayJoin } from './room-auth';

interface SocketData {
  userId?: string;
  expiryTimer?: NodeJS.Timeout;
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
    private readonly tenancy: TenancyService,
    private readonly channels: ChannelMembershipReader,
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
    const data = client.data as SocketData;
    data.userId = claims.sub;
    // Authorisation is decided at join time; disconnecting when the access token expires makes the
    // client reconnect with a fresh token, which re-checks every room against current roles.
    if (claims.exp !== undefined) {
      const remainingMs = claims.exp * 1000 - Date.now();
      if (remainingMs <= 0) {
        client.emit('auth:error', { code: 'TOKEN_EXPIRED' });
        client.disconnect(true);
        return;
      }
      data.expiryTimer = setTimeout(() => {
        client.emit('auth:error', { code: 'TOKEN_EXPIRED' });
        client.disconnect(true);
      }, remainingMs);
    }
    await client.join(`user:${claims.sub}`);
    this.logger.debug(`client connected ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const timer = (client.data as SocketData).expiryTimer;
    if (timer) clearTimeout(timer);
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

    const canonical = canonicalRoom(parsed);
    await client.join(canonical);
    return { ok: true, room: canonical };
  }

  @SubscribeMessage('room:leave')
  async leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: string },
  ): Promise<{ ok: boolean; room?: string }> {
    const parsed = typeof body?.room === 'string' ? parseRoom(body.room) : null;
    if (!parsed) return { ok: true };
    const room = canonicalRoom(parsed);
    await client.leave(room);
    return { ok: true, room };
  }

  private async canJoin(
    userId: string,
    room: NonNullable<ReturnType<typeof parseRoom>>,
  ): Promise<boolean> {
    // Same rule as REST: suspended or departed members see nothing of the estate.
    const membership = await this.tenancy.activeMembership(userId, room.estateId);
    if (!membership) return false;
    if (room.kind === 'channel') {
      return this.channels.isActiveMember(room.estateId, room.channelId, userId);
    }

    const assignments = await this.authz.activeAssignments(userId);
    const grant = this.authz.grantIn(assignments, room.estateId);
    return staffMayJoin(room.kind, grant.staffPermissions);
  }
}
