import { Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { t } from '@safezone/i18n';
import {
  estateNotificationIntentParamSchema,
  estateNotificationTemplateSchema,
  estateParamSchema,
  updateEstateNotificationTemplateSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams } from '../../common/contract/contract';
import { DatabaseService } from '../../common/database/database.service';
import { DomainError, NotFoundError } from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import {
  extractPlaceholders,
  type IntentDefinition,
  INTENTS,
  isCustomisableEstateIntent,
  isIntentKey,
} from './domain/intents';

const TAGS = ['notifications'];

/** Platform-only intents excluded from an estate's template list. */
const PLATFORM_ONLY_PREFIXES = ['account.', 'onboarding.', 'platform.'];

function isEstateVisibleIntent(intent: string): boolean {
  return !PLATFORM_ONLY_PREFIXES.some((prefix) => intent.startsWith(prefix));
}

function toTemplateView(
  intent: string,
  def: IntentDefinition,
  override: {
    title: string;
    body: string;
    smsBody: string | null;
    updatedAt: Date;
  } | null,
) {
  const defaultTitle = t(def.title);
  const defaultBody = t(def.body);
  const defaultSms = def.sms ? t(def.sms) : null;
  return {
    intent,
    category: def.category,
    priority: def.priority,
    mandatory: def.mandatory,
    customisable: isCustomisableEstateIntent(intent),
    channels: [...def.channels],
    smsOnlyWithoutPush: def.smsOnlyWithoutPush,
    placeholders: extractPlaceholders(defaultTitle, defaultBody, defaultSms),
    defaultTitle,
    defaultBody,
    defaultSms,
    customTitle: override?.title ?? null,
    customBody: override?.body ?? null,
    customSms: override?.smsBody ?? null,
    updatedAt: override?.updatedAt.toISOString() ?? null,
  };
}

/** Estate notification template catalogue and wording overrides (notifications.md §7, management-web.md §6.13). */
@Controller('v1/estates/:estateId/notification-templates')
export class EstateNotificationTemplatesController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Can('estate.configure')
  @Contract({
    summary: 'Notification templates for this estate with any saved wording overrides',
    tags: TAGS,
    params: estateParamSchema,
    response: z.array(estateNotificationTemplateSchema),
  })
  async list(@CurrentEstate() estate: EstateAccess) {
    const overrides = await this.db.withTenant(estate, (tx) =>
      tx.estateNotificationTemplate.findMany({ where: { estateId: estate.estateId } }),
    );
    const byIntent = new Map(overrides.map((row) => [row.intentKey, row]));
    return Object.entries(INTENTS)
      .filter(([intent]) => isEstateVisibleIntent(intent))
      .map(([intent, def]: [string, IntentDefinition]) =>
        toTemplateView(intent, def, byIntent.get(intent) ?? null),
      );
  }

  @Put(':intent')
  @Can('estate.configure')
  @Contract({
    summary: 'Save a wording override for a customisable estate notification intent',
    tags: TAGS,
    params: estateNotificationIntentParamSchema,
    body: updateEstateNotificationTemplateSchema,
    response: estateNotificationTemplateSchema,
    errors: [404, 422],
  })
  async upsert(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateNotificationIntentParamSchema>,
    @ValidBody() body: z.infer<typeof updateEstateNotificationTemplateSchema>,
  ) {
    if (!isIntentKey(params.intent) || !isEstateVisibleIntent(params.intent)) {
      throw new NotFoundError('Notification intent not found');
    }
    if (!isCustomisableEstateIntent(params.intent)) {
      throw new DomainError(
        'TEMPLATE_NOT_CUSTOMISABLE',
        'Safety and system notification templates cannot be modified',
        422,
      );
    }
    const def: IntentDefinition = INTENTS[params.intent];
    const smsBody = body.sms === undefined ? null : body.sms;
    const saved = await this.db.withTenant(estate, async (tx) => {
      const previous = await tx.estateNotificationTemplate.findUnique({
        where: {
          estateId_intentKey: { estateId: estate.estateId, intentKey: params.intent },
        },
      });
      const row = await tx.estateNotificationTemplate.upsert({
        where: {
          estateId_intentKey: { estateId: estate.estateId, intentKey: params.intent },
        },
        create: {
          id: uuidv7(),
          estateId: estate.estateId,
          intentKey: params.intent,
          title: body.title,
          body: body.body,
          smsBody,
          updatedBy: estate.userId,
        },
        update: {
          title: body.title,
          body: body.body,
          smsBody,
          updatedBy: estate.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'notifications.template.updated',
          estateId: estate.estateId,
          aggregateType: 'notification_template',
          aggregateId: row.id,
          payload: { intent: params.intent },
          audit: {
            actorType: 'user',
            actorId: estate.userId,
            action: 'notifications.template.update',
            resourceType: 'notification_template',
            resourceId: params.intent,
            before: previous
              ? { title: previous.title, body: previous.body, smsBody: previous.smsBody }
              : undefined,
            after: { title: row.title, body: row.body, smsBody: row.smsBody },
          },
        },
      ]);
      return row;
    });
    return toTemplateView(params.intent, def, saved);
  }

  @Delete(':intent')
  @Can('estate.configure')
  @HttpCode(204)
  @Contract({
    summary: 'Reset an estate notification template back to the platform default',
    tags: TAGS,
    params: estateNotificationIntentParamSchema,
    status: 204,
    errors: [404],
  })
  async reset(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateNotificationIntentParamSchema>,
  ) {
    if (!isIntentKey(params.intent) || !isEstateVisibleIntent(params.intent)) {
      throw new NotFoundError('Notification intent not found');
    }
    await this.db.withTenant(estate, async (tx) => {
      const existing = await tx.estateNotificationTemplate.findUnique({
        where: {
          estateId_intentKey: { estateId: estate.estateId, intentKey: params.intent },
        },
      });
      if (!existing) return;
      await tx.estateNotificationTemplate.delete({ where: { id: existing.id } });
      await appendOutboxEvents(tx, [
        {
          type: 'notifications.template.reset',
          estateId: estate.estateId,
          aggregateType: 'notification_template',
          aggregateId: existing.id,
          payload: { intent: params.intent },
          audit: {
            actorType: 'user',
            actorId: estate.userId,
            action: 'notifications.template.reset',
            resourceType: 'notification_template',
            resourceId: params.intent,
            before: { title: existing.title, body: existing.body, smsBody: existing.smsBody },
          },
        },
      ]);
    });
  }
}
