import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PollsService } from '../../src/modules/community/polls.service';
import { signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('community channels, moderation and polls', () => {
  let stack: TestStack;
  let estateId: string;
  let manager: string;
  let admin: string;
  let ada: string;
  let adaId: string;
  let bola: string;
  let bolaId: string;
  let unitB2: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  async function resident(spaceId: string, phone: string, name: string) {
    await stack.http
      .post(url('/occupancies'))
      .set(as(manager))
      .send({ spaceId, type: 'tenant', head: { fullName: name, phone } })
      .expect(201);
    const session = await signIn(stack, phone);
    await stack.http
      .post(url('/community/guidelines/accept'))
      .set(as(session.accessToken))
      .expect(200);
    return session;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Talk Estate');
    for (const [phone, role] of [
      ['+2348030800001', 'estate_manager'],
      ['+2348030800002', 'estate_administrator'],
    ] as const) {
      await stack.addMember(estateId, await stack.createUser(phone), role);
    }
    manager = (await signIn(stack, '+2348030800001', WEB_DEVICE)).accessToken;
    admin = (await signIn(stack, '+2348030800002', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(`update platform.sessions set mfa_verified_at = now()`);
    for (const token of [manager, admin])
      await stack.http.post(url('/community/guidelines/accept')).set(as(token)).expect(200);
    const block = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'block', code: 'B', name: 'Block B' })
        .expect(201)
    ).body.data.id;
    const b1 = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ parentId: block, type: 'unit', code: 'B-1' })
        .expect(201)
    ).body.data.id;
    unitB2 = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ parentId: block, type: 'unit', code: 'B-2' })
        .expect(201)
    ).body.data.id;
    const a = await resident(b1, '+2348030800010', 'Ada');
    ada = a.accessToken;
    adaId = a.user.id;
    const outside = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'unit', code: 'Q-1' })
        .expect(201)
    ).body.data.id;
    const b = await resident(outside, '+2348030800011', 'Bola');
    bola = b.accessToken;
    bolaId = b.user.id;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  let buildingChannel: string;
  let general: string;

  it('derives building membership from occupancy and hides history from before a resident moved in', async () => {
    const adaChannels = (await stack.http.get(url('/channels')).set(as(ada)).expect(200)).body.data;
    buildingChannel = adaChannels.find((c: { type: string }) => c.type === 'building').id;
    general = adaChannels.find((c: { name: string }) => c.name === 'General').id;
    expect(adaChannels.filter((c: { type: string }) => c.type === 'estate')).toHaveLength(7);
    const bolaChannels = (await stack.http.get(url('/channels')).set(as(bola)).expect(200)).body
      .data;
    expect(bolaChannels.some((c: { type: string }) => c.type === 'building')).toBe(false);
    await stack.http
      .get(url(`/channels/${buildingChannel}/messages`))
      .set(as(bola))
      .expect(404);

    await stack.http
      .post(url(`/channels/${buildingChannel}/messages`))
      .set(as(ada))
      .send({ body: 'Water pressure is low on B today' })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const late = await resident(unitB2, '+2348030800012', 'Chidi');
    const history = await stack.http
      .get(url(`/channels/${buildingChannel}/messages`))
      .set(as(late.accessToken))
      .expect(200);
    expect(history.body.data).toEqual([]);
    await stack.http
      .post(url(`/channels/${buildingChannel}/messages`))
      .set(as(late.accessToken))
      .send({ body: 'Hello neighbours' })
      .expect(201);
    const adaView = await stack.http
      .get(url(`/channels/${buildingChannel}/messages`))
      .set(as(ada))
      .expect(200);
    expect(adaView.body.data.map((m: { body: string }) => m.body)).toEqual([
      'Hello neighbours',
      'Water pressure is low on B today',
    ]);
    expect(adaView.body.data[0]).toMatchObject({ authorName: 'Chidi' });
    expect(JSON.stringify(adaView.body.data)).not.toContain('+234');
  });

  it('requires guidelines, keeps staff-only channels for management and gates resident channels', async () => {
    const management = (
      await stack.http.get(url('/channels')).set(as(ada)).expect(200)
    ).body.data.find((c: { name: string }) => c.name === 'Management Announcements').id;
    await stack.http
      .post(url(`/channels/${management}/messages`))
      .set(as(ada))
      .send({ body: 'hi' })
      .expect(403);
    await stack.http
      .post(url(`/channels/${management}/messages`))
      .set(as(manager))
      .send({ body: 'Gate closes at 11pm' })
      .expect(201);

    const club = await stack.http
      .post(url('/channels'))
      .set(as(ada))
      .send({ name: 'Book club', privacy: 'public' })
      .expect(201);
    expect(club.body.data).toMatchObject({ status: 'pending_approval', myRole: 'owner' });
    await stack.http
      .post(url(`/channels/${club.body.data.id}/join`))
      .set(as(bola))
      .expect(409);
    await stack.http
      .post(url(`/channels/${club.body.data.id}/approve`))
      .set(as(manager))
      .expect(200);
    const joined = await stack.http
      .post(url(`/channels/${club.body.data.id}/join`))
      .set(as(bola))
      .expect(200);
    expect(joined.body.data.myStatus).toBe('active');
  });

  it('keeps private messaging off until enabled and honours blocks', async () => {
    const off = await stack.http
      .post(url('/direct-channels'))
      .set(as(ada))
      .send({ userId: bolaId })
      .expect(403);
    expect(off.body.error.code).toBe('FEATURE_NOT_ENABLED');
    await stack.http
      .patch(`/v1/estates/${estateId}/settings`)
      .set(as(admin))
      .send({ 'community.private_messaging': true })
      .expect(200);
    const dm = await stack.http
      .post(url('/direct-channels'))
      .set(as(ada))
      .send({ userId: bolaId })
      .expect(201);
    await stack.http
      .post(url(`/channels/${dm.body.data.id}/messages`))
      .set(as(bola))
      .send({ body: 'Hi Ada' })
      .expect(201);
    await stack.http.post(url('/blocks')).set(as(ada)).send({ userId: bolaId }).expect(204);
    const blocked = await stack.http
      .post(url(`/channels/${dm.body.data.id}/messages`))
      .set(as(bola))
      .send({ body: 'Hello?' })
      .expect(403);
    expect(blocked.body.error.code).toBe('USER_BLOCKED');
  });

  it('removes a reported message in one action, audits it, and restores it on an overturned appeal', async () => {
    const message = await stack.http
      .post(url(`/channels/${general}/messages`))
      .set(as(bola))
      .send({ body: 'Buy cheap gold, DM me' })
      .expect(201);
    const report = await stack.http
      .post(url('/reports'))
      .set(as(ada))
      .send({ targetType: 'message', targetId: message.body.data.id, reason: 'scam' })
      .expect(201);
    await stack.http.get(url('/moderation/queue')).set(as(ada)).expect(403);
    const queue = await stack.http.get(url('/moderation/queue')).set(as(manager)).expect(200);
    expect(queue.body.data[0]).toMatchObject({
      id: report.body.data.id,
      preview: 'Buy cheap gold, DM me',
    });
    const action = await stack.http
      .post(url('/moderation/actions'))
      .set(as(manager))
      .send({
        action: 'remove_message',
        targetType: 'message',
        targetId: message.body.data.id,
        reason: 'Scam',
        reportId: report.body.data.id,
      })
      .expect(201);
    const history = await stack.http
      .get(url(`/channels/${general}/messages`))
      .set(as(ada))
      .expect(200);
    expect(
      history.body.data.find((m: { id: string }) => m.id === message.body.data.id),
    ).toMatchObject({ state: 'removed', body: null });
    expect(
      (await stack.http.get(url('/moderation/queue')).set(as(manager)).expect(200)).body.data,
    ).toEqual([]);
    expect(
      (await stack.http.get(url('/moderation/actions')).set(as(manager)).expect(200)).body.data,
    ).toHaveLength(1);

    await stack.http
      .post(url(`/moderation/actions/${action.body.data.id}/appeal`))
      .set(as(bola))
      .send({ statement: 'It was a joke' })
      .expect(200);
    await stack.http
      .post(url(`/moderation/actions/${action.body.data.id}/decide`))
      .set(as(manager))
      .send({ decision: 'overturned' })
      .expect(403);
    await stack.http
      .post(url(`/moderation/actions/${action.body.data.id}/decide`))
      .set(as(admin))
      .send({ decision: 'overturned' })
      .expect(200);
    const restored = await stack.http
      .get(url(`/channels/${general}/messages`))
      .set(as(ada))
      .expect(200);
    expect(
      restored.body.data.find((m: { id: string }) => m.id === message.body.data.id).state,
    ).toBe('visible');

    await stack.http
      .post(url('/moderation/actions'))
      .set(as(manager))
      .send({
        action: 'mute',
        targetType: 'user',
        targetId: bolaId,
        reason: 'Cool off',
        durationHours: 2,
      })
      .expect(201);
    const muted = await stack.http
      .post(url(`/channels/${general}/messages`))
      .set(as(bola))
      .send({ body: 'Still here' })
      .expect(403);
    expect(muted.body.error.code).toBe('MEMBER_MUTED');
    void adaId;
  });

  it('runs a household poll with results after voting', async () => {
    const poll = await stack.http
      .post(url('/polls'))
      .set(as(manager))
      .send({
        question: 'Should we extend gate hours?',
        options: ['Yes', 'No'],
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
        votePer: 'household',
        audience: { type: 'estate' },
      })
      .expect(201);
    const before = await stack.http
      .get(url(`/polls/${poll.body.data.id}`))
      .set(as(ada))
      .expect(200);
    expect(before.body.data.options[0].votes).toBeNull();
    const voted = await stack.http
      .post(url(`/polls/${poll.body.data.id}/votes`))
      .set(as(ada))
      .send({ optionId: before.body.data.options[0].id })
      .expect(201);
    expect(voted.body.data).toMatchObject({
      totalVotes: 1,
      myVoteOptionId: before.body.data.options[0].id,
    });
    await stack.http
      .post(url(`/polls/${poll.body.data.id}/votes`))
      .set(as(ada))
      .send({ optionId: before.body.data.options[1].id })
      .expect(409);
    const voters = await stack.http
      .get(url(`/polls/${poll.body.data.id}/voters`))
      .set(as(manager))
      .expect(200);
    expect(voters.body.data).toHaveLength(1);
    expect(
      await stack.app.get(PollsService).closeDue(estateId, new Date(Date.now() + 2 * 86_400_000)),
    ).toBe(1);
  });
});
