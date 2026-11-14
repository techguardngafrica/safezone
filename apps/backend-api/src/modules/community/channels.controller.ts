import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  appealDecisionSchema,
  appealSchema,
  blockUserSchema,
  channelListQuerySchema,
  channelMemberParamsSchema,
  channelPreferencesSchema,
  channelReasonSchema,
  channelSchema,
  createChannelSchema,
  createModerationActionSchema,
  createPollSchema,
  createReportSchema,
  editMessageSchema,
  estateItemParamsSchema,
  estateParamSchema,
  inviteMemberSchema,
  messageListQuerySchema,
  messageSchema,
  moderationActionParamsSchema,
  moderationActionSchema,
  moderationQueueQuerySchema,
  pollSchema,
  pollVoterSchema,
  postMessageSchema,
  reactionSchema,
  reportSchema,
  startDirectSchema,
  votePollSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { ChannelsService } from './channels.service';
import { ModerationService } from './moderation.service';
import { PollsService } from './polls.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;
const guidelinesSchema = z.object({ text: z.string(), acceptedAt: z.iso.datetime().nullable() });
const userParamsSchema = z.object({ estateId: z.uuid(), userId: z.uuid() });

/** Channels and messages (community.md §6). */
@Controller('v1/estates/:estateId')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get('community/guidelines')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Community guidelines and whether I accepted them',
    tags: ['community'],
    params: estateParamSchema,
    response: guidelinesSchema,
  })
  guidelines(@CurrentEstate() estate: EstateAccess) {
    return this.channels.guidelines(estate);
  }

  @Post('community/guidelines/accept')
  @Member()
  @RequiresFeature('community')
  @HttpCode(200)
  @Contract({
    summary: 'Accept the guidelines (needed before posting)',
    tags: ['community'],
    params: estateParamSchema,
    response: guidelinesSchema,
  })
  accept(@CurrentEstate() estate: EstateAccess) {
    return this.channels.acceptGuidelines(estate);
  }

  @Get('channels')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'My channels (building, estate, joined), or public channels to join',
    tags: ['community'],
    params: estateParamSchema,
    query: channelListQuerySchema,
    response: z.array(channelSchema),
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof channelListQuerySchema>,
  ) {
    return this.channels.list(estate, query);
  }

  @Post('channels')
  @Can('community.channel.create')
  @RequiresFeature('community')
  @Contract({
    summary: 'Create a resident channel (may need approval)',
    tags: ['community'],
    params: estateParamSchema,
    body: createChannelSchema,
    response: channelSchema,
    status: 201,
    errors: [403, 422],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createChannelSchema>,
  ) {
    return this.channels.create(estate, body);
  }

  @Post('channels/:id/approve')
  @Can('community.moderate')
  @RequiresFeature('community')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a resident channel',
    tags: ['community'],
    params: estateItemParamsSchema,
    response: channelSchema,
    errors: [403, 404, 409],
  })
  approve(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.channels.decide(estate, params.id, 'approve', null);
  }

  @Post('channels/:id/suspend')
  @Can('community.moderate')
  @RequiresFeature('community')
  @HttpCode(200)
  @Contract({
    summary: 'Suspend a channel',
    tags: ['community'],
    params: estateItemParamsSchema,
    body: channelReasonSchema,
    response: channelSchema,
    errors: [403, 404, 409],
  })
  suspend(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof channelReasonSchema>,
  ) {
    return this.channels.decide(estate, params.id, 'suspend', body.reason);
  }

  @Post('channels/:id/archive')
  @Can('community.moderate')
  @RequiresFeature('community')
  @HttpCode(200)
  @Contract({
    summary: 'Archive a channel',
    tags: ['community'],
    params: estateItemParamsSchema,
    body: channelReasonSchema,
    response: channelSchema,
    errors: [403, 404, 409],
  })
  archive(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof channelReasonSchema>,
  ) {
    return this.channels.decide(estate, params.id, 'archive', body.reason);
  }

  @Post('channels/:id/join')
  @Member()
  @RequiresFeature('community')
  @HttpCode(200)
  @Contract({
    summary: 'Join (public) or ask to join (restricted)',
    tags: ['community'],
    params: estateItemParamsSchema,
    response: channelSchema,
    errors: [403, 404, 409, 422],
  })
  join(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.channels.join(estate, params.id);
  }

  @Post('channels/:id/members')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Invite someone or accept their request (owner or moderator)',
    tags: ['community'],
    params: estateItemParamsSchema,
    body: inviteMemberSchema,
    response: channelSchema,
    status: 201,
    errors: [403, 404],
  })
  invite(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof inviteMemberSchema>,
  ) {
    return this.channels.invite(estate, params.id, body.userId);
  }

  @Delete('channels/:id/members/:userId')
  @Member()
  @RequiresFeature('community')
  @HttpCode(204)
  @Contract({
    summary: 'Leave, or remove a member',
    tags: ['community'],
    params: channelMemberParamsSchema,
    errors: [403, 404, 409],
  })
  async removeMember(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof channelMemberParamsSchema>,
  ) {
    await this.channels.removeMember(estate, params.id, params.userId);
  }

  @Put('channels/:id/preferences')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Notifications for this channel: all, mentions or none',
    tags: ['community'],
    params: estateItemParamsSchema,
    body: channelPreferencesSchema,
    response: channelSchema,
    errors: [404],
  })
  preferences(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof channelPreferencesSchema>,
  ) {
    return this.channels.setPreferences(estate, params.id, body.notify);
  }

  @Get('channels/:id/messages')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Message history, newest first (search with q)',
    tags: ['community'],
    params: estateItemParamsSchema,
    query: messageListQuerySchema,
    response: messageSchema,
    paginated: true,
    errors: [404],
  })
  messages(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidQuery() query: z.infer<typeof messageListQuerySchema>,
  ) {
    return this.channels.messages(estate, params.id, query);
  }

  @Post('channels/:id/messages')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Post a message',
    tags: ['community'],
    params: estateItemParamsSchema,
    body: postMessageSchema,
    response: messageSchema,
    status: 201,
    errors: [403, 404, 409, 422],
  })
  post(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof postMessageSchema>,
  ) {
    return this.channels.post(estate, params.id, body);
  }

  @Patch('messages/:id')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Edit my message (within 15 minutes)',
    tags: ['community'],
    params: estateItemParamsSchema,
    body: editMessageSchema,
    response: messageSchema,
    errors: [404, 409],
  })
  edit(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof editMessageSchema>,
  ) {
    return this.channels.edit(estate, params.id, body);
  }

  @Delete('messages/:id')
  @Member()
  @RequiresFeature('community')
  @HttpCode(204)
  @Contract({
    summary: 'Delete my message',
    tags: ['community'],
    params: estateItemParamsSchema,
    errors: [404],
  })
  async remove(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    await this.channels.deleteOwn(estate, params.id);
  }

  @Post('messages/:id/reactions')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'React to a message',
    tags: ['community'],
    params: estateItemParamsSchema,
    body: reactionSchema,
    response: messageSchema,
    status: 201,
    errors: [404],
  })
  react(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof reactionSchema>,
  ) {
    return this.channels.react(estate, params.id, body.emoji, true);
  }

  @Post('messages/:id/reactions/remove')
  @Member()
  @RequiresFeature('community')
  @HttpCode(200)
  @Contract({
    summary: 'Remove my reaction',
    tags: ['community'],
    params: estateItemParamsSchema,
    body: reactionSchema,
    response: messageSchema,
    errors: [404],
  })
  unreact(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof reactionSchema>,
  ) {
    return this.channels.react(estate, params.id, body.emoji, false);
  }

  @Post('direct-channels')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Start a private conversation (if the estate allows)',
    tags: ['community'],
    params: estateParamSchema,
    body: startDirectSchema,
    response: channelSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  direct(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof startDirectSchema>,
  ) {
    return this.channels.startDirect(estate, body.userId);
  }

  @Post('blocks')
  @Member()
  @RequiresFeature('community')
  @HttpCode(204)
  @Contract({
    summary: 'Block someone from messaging me',
    tags: ['community'],
    params: estateParamSchema,
    body: blockUserSchema,
  })
  async block(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof blockUserSchema>,
  ) {
    await this.channels.block(estate, body.userId);
  }

  @Delete('blocks/:userId')
  @Member()
  @RequiresFeature('community')
  @HttpCode(204)
  @Contract({ summary: 'Unblock someone', tags: ['community'], params: userParamsSchema })
  async unblock(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof userParamsSchema>,
  ) {
    await this.channels.unblock(estate, params.userId);
  }
}

/** Reports, moderation and appeals (community.md §2.13–2.18). */
@Controller('v1/estates/:estateId')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post('reports')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Report a message, channel or person',
    tags: ['community'],
    params: estateParamSchema,
    body: createReportSchema,
    response: reportSchema,
    status: 201,
    errors: [404],
  })
  report(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createReportSchema>,
  ) {
    return this.moderation.report(estate, body);
  }

  @Get('moderation/queue')
  @Can('community.moderate')
  @RequiresFeature('community')
  @Contract({
    summary: 'Reports to review',
    tags: ['community'],
    params: estateParamSchema,
    query: moderationQueueQuerySchema,
    response: z.array(reportSchema),
  })
  queue(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof moderationQueueQuerySchema>,
  ) {
    return this.moderation.queue(estate, query.status);
  }

  @Post('moderation/actions')
  @Can('community.moderate')
  @RequiresFeature('community')
  @Contract({
    summary: 'Remove, warn, mute, remove from channel, suspend, ban or dismiss',
    tags: ['community'],
    params: estateParamSchema,
    body: createModerationActionSchema,
    response: moderationActionSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  act(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createModerationActionSchema>,
  ) {
    return this.moderation.act(estate, body);
  }

  @Get('moderation/actions')
  @Can('community.moderate')
  @RequiresFeature('community')
  @Contract({
    summary: 'Moderation audit log',
    tags: ['community'],
    params: estateParamSchema,
    response: z.array(moderationActionSchema),
  })
  actions(@CurrentEstate() estate: EstateAccess) {
    return this.moderation.actions(estate);
  }

  @Post('moderation/actions/:id/appeal')
  @Member()
  @RequiresFeature('community')
  @HttpCode(200)
  @Contract({
    summary: 'Appeal an action taken against me',
    tags: ['community'],
    params: moderationActionParamsSchema,
    body: appealSchema,
    response: moderationActionSchema,
    errors: [404, 409],
  })
  appeal(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof moderationActionParamsSchema>,
    @ValidBody() body: z.infer<typeof appealSchema>,
  ) {
    return this.moderation.appeal(estate, params.id, body.statement);
  }

  @Post('moderation/actions/:id/decide')
  @Can('community.moderate')
  @RequiresFeature('community')
  @HttpCode(200)
  @Contract({
    summary: 'Decide an appeal (another moderator)',
    tags: ['community'],
    params: moderationActionParamsSchema,
    body: appealDecisionSchema,
    response: moderationActionSchema,
    errors: [403, 404, 409],
  })
  decide(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof moderationActionParamsSchema>,
    @ValidBody() body: z.infer<typeof appealDecisionSchema>,
  ) {
    return this.moderation.decideAppeal(estate, params.id, body);
  }
}

/** Official polls (community.md §2.12). */
@Controller('v1/estates/:estateId')
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Post('polls')
  @Can('announcement.publish')
  @RequiresFeature('community')
  @Contract({
    summary: 'Create an official poll',
    tags: ['community'],
    params: estateParamSchema,
    body: createPollSchema,
    response: pollSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createPollSchema>,
  ) {
    return this.polls.create(estate, body);
  }

  @Get('polls')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Polls for me',
    tags: ['community'],
    params: estateParamSchema,
    response: z.array(pollSchema),
  })
  list(@CurrentEstate() estate: EstateAccess) {
    return this.polls.list(estate);
  }

  @Get('polls/:id')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Poll (results after voting or closing)',
    tags: ['community'],
    params: estateItemParamsSchema,
    response: pollSchema,
    errors: [404],
  })
  get(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.polls.get(estate, params.id);
  }

  @Post('polls/:id/votes')
  @Member()
  @RequiresFeature('community')
  @Contract({
    summary: 'Vote',
    tags: ['community'],
    params: estateItemParamsSchema,
    body: votePollSchema,
    response: pollSchema,
    status: 201,
    errors: [404, 409, 422],
  })
  vote(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof votePollSchema>,
  ) {
    return this.polls.vote(estate, params.id, body.optionId);
  }

  @Get('polls/:id/voters')
  @Can('announcement.publish')
  @RequiresFeature('community')
  @Contract({
    summary: 'Who voted for what (named polls only)',
    tags: ['community'],
    params: estateItemParamsSchema,
    response: z.array(pollVoterSchema),
    errors: [403, 404, 409],
  })
  voters(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.polls.voters(estate, params.id);
  }
}
