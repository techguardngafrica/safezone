import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  castVoteSchema,
  committeeMemberSchema,
  createActionItemSchema,
  createCommitteeMemberSchema,
  createGovernanceDisputeSchema,
  createMeetingSchema,
  createMotionSchema,
  createPolicySchema,
  estateParamSchema,
  governanceDisputeSchema,
  meetingSchema,
  motionResultsSchema,
  motionSchema,
  policySchema,
  policyVersionSchema,
  publishPolicyVersionSchema,
  recordAttendanceSchema,
  updateGovernanceDisputeSchema,
  upsertMinutesSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams } from '../../common/contract/contract';
import { GovernanceService } from './governance.service';

const itemParamSchema = estateParamSchema.extend({ id: z.uuid() });

@Controller('v1/estates/:estateId')
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  // ---- Policies ---------------------------------------------------------------------------------

  @Get('policies')
  @Can('governance.policy.ack', 'governance.manage')
  @Contract({
    summary: 'List estate policies',
    tags: ['governance'],
    params: estateParamSchema,
    response: z.array(policySchema),
  })
  listPolicies(@CurrentEstate() estate: EstateAccess) {
    return this.governance.listPolicies(estate);
  }

  @Get('policies/pending-ack')
  @Can('governance.policy.ack')
  @Contract({
    summary: 'List published mandatory policies not yet acknowledged by the caller',
    tags: ['governance'],
    params: estateParamSchema,
    response: z.array(policySchema),
  })
  pendingPolicyAcknowledgements(@CurrentEstate() estate: EstateAccess) {
    return this.governance.pendingPolicyAcknowledgements(estate);
  }

  @Post('policies')
  @Can('governance.manage')
  @Contract({
    summary: 'Create a draft estate policy',
    tags: ['governance'],
    params: estateParamSchema,
    body: createPolicySchema,
    response: policySchema,
    status: 201,
  })
  createPolicy(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createPolicySchema>,
  ) {
    return this.governance.createPolicy(estate, body);
  }

  @Post('policies/:id/versions')
  @Can('governance.manage')
  @Contract({
    summary: 'Publish a new version of an estate policy',
    tags: ['governance'],
    params: itemParamSchema,
    body: publishPolicyVersionSchema,
    response: policyVersionSchema,
    status: 201,
    errors: [404],
  })
  publishPolicyVersion(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof publishPolicyVersionSchema>,
  ) {
    return this.governance.publishPolicyVersion(estate, params.id, body);
  }

  @Post('policy-versions/:id/acknowledge')
  @Can('governance.policy.ack')
  @HttpCode(200)
  @Contract({
    summary: 'Acknowledge a published policy version',
    tags: ['governance'],
    params: itemParamSchema,
    response: z.object({ acknowledged: z.literal(true), policyVersionId: z.uuid() }),
    errors: [404],
  })
  acknowledgePolicyVersion(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
  ) {
    return this.governance.acknowledgePolicyVersion(estate, params.id);
  }

  // ---- Committee --------------------------------------------------------------------------------

  @Get('committee')
  @Can('governance.policy.ack', 'governance.manage')
  @Contract({
    summary: 'List estate management committee members',
    tags: ['governance'],
    params: estateParamSchema,
    response: z.array(committeeMemberSchema),
  })
  listCommittee(@CurrentEstate() estate: EstateAccess) {
    return this.governance.listCommittee(estate);
  }

  @Post('committee')
  @Can('governance.manage')
  @Contract({
    summary: 'Add a management committee member',
    tags: ['governance'],
    params: estateParamSchema,
    body: createCommitteeMemberSchema,
    response: committeeMemberSchema,
    status: 201,
  })
  addCommitteeMember(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createCommitteeMemberSchema>,
  ) {
    return this.governance.addCommitteeMember(estate, body);
  }

  // ---- Meetings & Minutes -----------------------------------------------------------------------

  @Get('meetings')
  @Can('governance.policy.ack', 'governance.manage')
  @Contract({
    summary: 'List estate governance meetings (draft minutes hidden from residents)',
    tags: ['governance'],
    params: estateParamSchema,
    response: z.array(meetingSchema),
  })
  listMeetings(@CurrentEstate() estate: EstateAccess) {
    return this.governance.listMeetings(estate);
  }

  @Post('meetings')
  @Can('governance.manage')
  @Contract({
    summary: 'Schedule an AGM, EGM, committee or town hall meeting',
    tags: ['governance'],
    params: estateParamSchema,
    body: createMeetingSchema,
    response: meetingSchema,
    status: 201,
  })
  createMeeting(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createMeetingSchema>,
  ) {
    return this.governance.createMeeting(estate, body);
  }

  @Post('meetings/:id/notice')
  @Can('governance.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Send official notice for a meeting',
    tags: ['governance'],
    params: itemParamSchema,
    response: meetingSchema,
    errors: [404],
  })
  sendMeetingNotice(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
  ) {
    return this.governance.sendMeetingNotice(estate, params.id);
  }

  @Post('meetings/:id/attendance')
  @Can('governance.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Record meeting attendance or proxy',
    tags: ['governance'],
    params: itemParamSchema,
    body: recordAttendanceSchema,
    response: meetingSchema,
    errors: [404],
  })
  recordMeetingAttendance(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof recordAttendanceSchema>,
  ) {
    return this.governance.recordMeetingAttendance(estate, params.id, body);
  }

  @Post('meetings/:id/minutes')
  @Can('governance.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Save, approve or publish meeting minutes',
    tags: ['governance'],
    params: itemParamSchema,
    body: upsertMinutesSchema,
    response: meetingSchema,
    errors: [404],
  })
  upsertMinutes(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof upsertMinutesSchema>,
  ) {
    return this.governance.upsertMinutes(estate, params.id, body);
  }

  @Post('meetings/:id/action-items')
  @Can('governance.manage')
  @Contract({
    summary: 'Add an action item to a meeting',
    tags: ['governance'],
    params: itemParamSchema,
    body: createActionItemSchema,
    response: meetingSchema,
    status: 201,
    errors: [404],
  })
  addActionItem(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof createActionItemSchema>,
  ) {
    return this.governance.addActionItem(estate, params.id, body);
  }

  // ---- Motions & Voting -------------------------------------------------------------------------

  @Get('motions')
  @Can('governance.vote', 'governance.manage')
  @Contract({
    summary: 'List governance motions',
    tags: ['governance'],
    params: estateParamSchema,
    response: z.array(motionSchema),
  })
  listMotions(@CurrentEstate() estate: EstateAccess) {
    return this.governance.listMotions(estate);
  }

  @Post('motions')
  @Can('governance.manage')
  @Contract({
    summary: 'Create and open a governance motion for voting',
    tags: ['governance'],
    params: estateParamSchema,
    body: createMotionSchema,
    response: motionSchema,
    status: 201,
  })
  createMotion(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createMotionSchema>,
  ) {
    return this.governance.createMotion(estate, body);
  }

  @Post('motions/:id/votes')
  @Can('governance.vote')
  @Contract({
    summary: 'Cast a vote on an open motion (secret ballots store no voter link)',
    tags: ['governance'],
    params: itemParamSchema,
    body: castVoteSchema,
    response: z.object({ recorded: z.literal(true), motionId: z.uuid() }),
    status: 201,
    errors: [404, 409, 422],
  })
  castVote(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof castVoteSchema>,
  ) {
    return this.governance.castVote(estate, params.id, body);
  }

  @Post('motions/:id/close')
  @Can('governance.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Close a motion, evaluate quorum/threshold and adopt resolution if passed',
    tags: ['governance'],
    params: itemParamSchema,
    response: motionResultsSchema,
    errors: [404, 409],
  })
  closeMotion(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
  ) {
    return this.governance.closeMotion(estate, params.id);
  }

  @Get('motions/:id/results')
  @Can('governance.vote', 'governance.manage')
  @Contract({
    summary: 'View motion results (secret ballots hidden until closed)',
    tags: ['governance'],
    params: itemParamSchema,
    response: motionResultsSchema,
    errors: [403, 404],
  })
  motionResults(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
  ) {
    return this.governance.motionResults(estate, params.id);
  }

  // ---- Disputes ---------------------------------------------------------------------------------

  @Get('disputes')
  @Can('governance.policy.ack', 'governance.dispute.manage')
  @Contract({
    summary: 'List governance disputes (visible only to involved parties and handlers)',
    tags: ['governance'],
    params: estateParamSchema,
    response: z.array(governanceDisputeSchema),
  })
  listDisputes(@CurrentEstate() estate: EstateAccess) {
    return this.governance.listDisputes(estate);
  }

  @Post('disputes')
  @Can('governance.policy.ack', 'governance.dispute.manage')
  @Contract({
    summary: 'Log a governance dispute',
    tags: ['governance'],
    params: estateParamSchema,
    body: createGovernanceDisputeSchema,
    response: governanceDisputeSchema,
    status: 201,
  })
  createDispute(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createGovernanceDisputeSchema>,
  ) {
    return this.governance.createDispute(estate, body);
  }

  @Patch('disputes/:id')
  @Can('governance.dispute.manage')
  @Contract({
    summary: 'Update dispute status, handler, mediation notes or outcome',
    tags: ['governance'],
    params: itemParamSchema,
    body: updateGovernanceDisputeSchema,
    response: governanceDisputeSchema,
    errors: [404],
  })
  updateDispute(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof updateGovernanceDisputeSchema>,
  ) {
    return this.governance.updateDispute(estate, params.id, body);
  }
}
