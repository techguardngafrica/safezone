import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';

/**
 * Starter gateway. Rooms planned (backend-api.md §12): user:<id>, estate:<id>:security,
 * estate:<id>:sos, estate:<id>:gate:<gateId>, channel:<id>, estate:<id>:dashboard.
 * Before going live: authenticate the access token on connect and authorise every room join
 * with the same policy engine as REST.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  handleConnection(client: Socket): void {
    this.logger.debug(`client connected ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`client disconnected ${client.id}`);
  }

  @SubscribeMessage('ping')
  ping(): { event: 'pong'; data: { at: string } } {
    return { event: 'pong', data: { at: new Date().toISOString() } };
  }
}
