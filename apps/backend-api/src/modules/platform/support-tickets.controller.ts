import { Controller, Get, Patch, Post } from '@nestjs/common';
import {
  createSupportTicketMessageSchema,
  createSupportTicketSchema,
  idParamSchema,
  supportTicketDetailSchema,
  supportTicketListQuerySchema,
  supportTicketMessageSchema,
  supportTicketSchema,
  updateSupportTicketSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import { type AuthContext, Can, CurrentAuth } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { SupportTicketsService } from './support-tickets.service';

@Controller('v1/platform/support-tickets')
export class SupportTicketsController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Get()
  @Can('platform.support_access')
  @Contract({
    summary: 'List platform support tickets (newest first)',
    tags: ['platform'],
    query: supportTicketListQuerySchema,
    response: supportTicketSchema,
    paginated: true,
  })
  list(@ValidQuery() query: z.infer<typeof supportTicketListQuerySchema>) {
    return this.tickets.list(query);
  }

  @Get(':id')
  @Can('platform.support_access')
  @Contract({
    summary: 'Support ticket detail with message thread',
    tags: ['platform'],
    params: idParamSchema,
    response: supportTicketDetailSchema,
    errors: [404],
  })
  get(@ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.tickets.get(params.id);
  }

  @Post()
  @Can('platform.support_access')
  @Contract({
    summary: 'Create a platform support ticket',
    tags: ['platform'],
    body: createSupportTicketSchema,
    response: supportTicketSchema,
    status: 201,
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof createSupportTicketSchema>,
  ) {
    return this.tickets.create(auth.userId, body);
  }

  @Patch(':id')
  @Can('platform.support_access')
  @Contract({
    summary: 'Update ticket status, priority or assignee',
    tags: ['platform'],
    params: idParamSchema,
    body: updateSupportTicketSchema,
    response: supportTicketSchema,
    errors: [404],
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof updateSupportTicketSchema>,
  ) {
    return this.tickets.update(auth.userId, params.id, body);
  }

  @Post(':id/messages')
  @Can('platform.support_access')
  @Contract({
    summary: 'Add a public reply or internal note to a support ticket',
    tags: ['platform'],
    params: idParamSchema,
    body: createSupportTicketMessageSchema,
    response: supportTicketMessageSchema,
    status: 201,
    errors: [404],
  })
  addMessage(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof idParamSchema>,
    @ValidBody() body: z.infer<typeof createSupportTicketMessageSchema>,
  ) {
    return this.tickets.addMessage(auth.userId, params.id, body);
  }
}
