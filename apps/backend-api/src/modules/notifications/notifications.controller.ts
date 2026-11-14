import { Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  idParamSchema,
  notificationItemSchema,
  notificationPreferencesSchema,
  paginationQuerySchema,
  pushTokenSchema,
  registerPushTokenSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, SignedIn } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { DatabaseService } from '../../common/database/database.service';
import { DomainError, NotFoundError } from '../../common/errors/domain-error';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { PushSender } from '../../integrations/push/push-sender';
import { INTENTS } from './domain/intents';

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
const optionalCategories = new Set<string>(
  Object.values(INTENTS)
    .filter((i) => !i.mandatory)
    .map((i) => i.category),
);
const mandatoryCategories = new Set<string>(
  Object.values(INTENTS)
    .filter((i) => i.mandatory)
    .map((i) => i.category),
);

/** Notification centre, push token registration and preferences (notifications.md §7). */
@Controller('v1/me')
export class NotificationsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly push: PushSender,
  ) {}

  @Get('notifications')
  @SignedIn()
  @Contract({
    summary: 'My notifications (newest first)',
    tags: ['notifications'],
    query: paginationQuerySchema,
    response: notificationItemSchema,
    paginated: true,
  })
  async list(
    @CurrentAuth() auth: AuthContext,
    @ValidQuery() query: z.infer<typeof paginationQuerySchema>,
  ) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    const rows = await this.db.withUser(auth.userId, (tx) =>
      tx.notification.findMany({
        where: {
          userId: auth.userId,
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: new Date(after.createdAt) } },
                  { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        estateId: row.estateId,
        intent: row.intentKey,
        priority: row.priority,
        title: row.title,
        body: row.body,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  @Post('notifications/:id/read')
  @SignedIn()
  @HttpCode(204)
  @Contract({
    summary: 'Mark one notification read',
    tags: ['notifications'],
    params: idParamSchema,
    status: 204,
    errors: [404],
  })
  async markRead(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
  ) {
    const updated = await this.db.withUser(auth.userId, (tx) =>
      tx.notification.updateMany({
        where: { id: params.id, userId: auth.userId, readAt: null },
        data: { readAt: new Date() },
      }),
    );
    if (updated.count === 0) {
      const exists = await this.db.withUser(auth.userId, (tx) =>
        tx.notification.count({ where: { id: params.id } }),
      );
      if (exists === 0) throw new NotFoundError('Notification not found');
    }
  }

  @Post('notifications/read-all')
  @SignedIn()
  @HttpCode(204)
  @Contract({ summary: 'Mark all my notifications read', tags: ['notifications'], status: 204 })
  async markAllRead(@CurrentAuth() auth: AuthContext) {
    await this.db.withUser(auth.userId, (tx) =>
      tx.notification.updateMany({
        where: { userId: auth.userId, readAt: null },
        data: { readAt: new Date() },
      }),
    );
  }

  @Post('push-tokens')
  @SignedIn()
  @HttpCode(200)
  @Contract({
    summary: 'Register this device for push (Expo)',
    tags: ['notifications'],
    body: registerPushTokenSchema,
    response: pushTokenSchema,
  })
  async registerPushToken(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof registerPushTokenSchema>,
  ) {
    if (!this.push.isValidToken(body.token))
      throw new DomainError('PUSH_TOKEN_INVALID', 'Not a valid Expo push token', 400);
    return this.db.withContext(
      'notifications',
      async (tx) => {
        const session = await tx.session.findUnique({
          where: { id: auth.sessionId },
          select: { deviceId: true },
        });
        // A token moves with the device: re-registering under a new account reassigns it.
        const token = await tx.pushToken.upsert({
          where: { expoToken: body.token },
          create: {
            userId: auth.userId,
            app: body.app,
            expoToken: body.token,
            deviceId: session?.deviceId ?? null,
          },
          update: {
            userId: auth.userId,
            app: body.app,
            deviceId: session?.deviceId ?? null,
            invalidAt: null,
            lastSeenAt: new Date(),
          },
          select: { id: true },
        });
        return token;
      },
      { userId: auth.userId },
    );
  }

  @Delete('push-tokens/:id')
  @SignedIn()
  @HttpCode(204)
  @Contract({
    summary: 'Stop push on a device',
    tags: ['notifications'],
    params: idParamSchema,
    status: 204,
    errors: [404],
  })
  async removePushToken(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
  ) {
    const removed = await this.db.withContext('notifications', (tx) =>
      tx.pushToken.deleteMany({ where: { id: params.id, userId: auth.userId } }),
    );
    if (removed.count === 0) throw new NotFoundError('Push token not found');
  }

  @Get('notification-preferences')
  @SignedIn()
  @Contract({
    summary: 'My notification preferences',
    tags: ['notifications'],
    response: notificationPreferencesSchema,
  })
  async preferences(@CurrentAuth() auth: AuthContext) {
    const rows = await this.db.withUser(auth.userId, (tx) =>
      tx.notificationPreference.findMany({ where: { userId: auth.userId } }),
    );
    return rows.map(({ category, channel, enabled }) => ({ category, channel, enabled }));
  }

  @Put('notification-preferences')
  @SignedIn()
  @Contract({
    summary: 'Replace my notification preferences (mandatory categories cannot be turned off)',
    tags: ['notifications'],
    body: notificationPreferencesSchema,
    response: notificationPreferencesSchema,
    errors: [422],
  })
  async setPreferences(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof notificationPreferencesSchema>,
  ) {
    for (const preference of body) {
      if (mandatoryCategories.has(preference.category)) {
        throw new DomainError(
          'PREFERENCE_MANDATORY',
          'Safety and security notifications cannot be turned off',
          422,
        );
      }
      if (!optionalCategories.has(preference.category)) {
        throw new DomainError('PREFERENCE_UNKNOWN', 'Unknown notification category', 422);
      }
    }
    await this.db.withUser(auth.userId, async (tx) => {
      await tx.notificationPreference.deleteMany({ where: { userId: auth.userId } });
      await tx.notificationPreference.createMany({
        data: body.map((p) => ({ userId: auth.userId, ...p })),
      });
    });
    return body;
  }
}
