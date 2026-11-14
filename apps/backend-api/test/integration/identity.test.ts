import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { base32Decode, hotp, timeStep } from '../../src/modules/identity/domain/totp';
import {
  countRows,
  MOBILE_DEVICE,
  signIn,
  startTestStack,
  type TestStack,
  WEB_DEVICE,
} from './support/app';

let phoneCounter = 100;
const nextPhone = () => `+23480300${String((phoneCounter += 1)).padStart(5, '0')}`;

describe('identity (phone OTP, sessions, MFA)', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack();
  });
  afterAll(async () => {
    await stack?.stop();
  });
  beforeEach(async () => {
    await stack.resetRateLimits();
  });

  it('signs up a new number and signs in again with the same account', async () => {
    const phone = nextPhone();
    const first = await signIn(stack, phone);
    expect(first.isNewUser).toBe(true);
    expect(first.refreshToken).toBeTypeOf('string');
    expect(first.mfaRequired).toBe(false);

    await stack.resetRateLimits();
    const second = await signIn(stack, phone);
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);

    const me = await stack.http
      .get('/v1/me')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(200);
    expect(me.body.data).toMatchObject({ id: first.user.id, phone });
  });

  it('never stores the OTP in clear and records audited events in the outbox', async () => {
    const phone = nextPhone();
    const result = await signIn(stack, phone);
    const code = /\b(\d{6})\b/.exec(stack.sms.lastTo(phone)?.body ?? '')?.[1] ?? 'none';
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.otp_challenges where code_hash like '%' || $1 || '%'`,
        [code],
      ),
    ).toBe(0);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'identity.user.created' and aggregate_id = $1 and audit is not null`,
        [result.user.id],
      ),
    ).toBe(1);
  });

  it('rejects a wrong code and locks the challenge after 5 attempts', async () => {
    const phone = nextPhone();
    await stack.http.post('/v1/auth/otp/request').send({ phone }).expect(200);
    const code = /\b(\d{6})\b/.exec(stack.sms.lastTo(phone)?.body ?? '')?.[1] ?? '';
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await stack.http
        .post('/v1/auth/otp/verify')
        .send({ phone, code: wrong, device: MOBILE_DEVICE })
        .expect(400);
      expect(response.body.error.code).toBe('OTP_INVALID');
    }
    await stack.http
      .post('/v1/auth/otp/verify')
      .send({ phone, code, device: MOBILE_DEVICE })
      .expect(400);
  });

  it('rate limits OTP requests per phone and sends no SMS beyond the limit', async () => {
    const phone = nextPhone();
    for (let i = 0; i < 5; i += 1) {
      await stack.http.post('/v1/auth/otp/request').send({ phone }).expect(200);
      await stack.redis.del(...(await stack.redis.keys('rl:otp:resend:*')));
    }
    const sentBefore = stack.sms.sent.filter((m) => m.to === phone).length;
    const limited = await stack.http.post('/v1/auth/otp/request').send({ phone }).expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(stack.sms.sent.filter((m) => m.to === phone)).toHaveLength(sentBefore);
  });

  it('validates the phone format', async () => {
    const response = await stack.http
      .post('/v1/auth/otp/request')
      .send({ phone: '0803123' })
      .expect(400);
    expect(response.body.error.details[0].path).toBe('body.phone');
  });

  it('rotates refresh tokens and revokes the session when an old one is reused', async () => {
    const first = await signIn(stack, nextPhone());
    const rotated = await stack.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    const second = rotated.body.data as { accessToken: string; refreshToken: string };
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const reused = await stack.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    expect(reused.body.error.code).toBe('SESSION_INVALID');
    // The whole family is gone: the newest token and the access token stop working too.
    await stack.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(401);
    await stack.http.get('/v1/me').set('Authorization', `Bearer ${second.accessToken}`).expect(401);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'identity.refresh.reuse_detected'`,
      ),
    ).toBeGreaterThan(0);
  });

  it('signs out immediately', async () => {
    const session = await signIn(stack, nextPhone());
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    await stack.http.post('/v1/auth/signout').set(auth).expect(204);
    await stack.http.get('/v1/me').set(auth).expect(401);
  });

  it('lists and revokes other sessions', async () => {
    const phone = nextPhone();
    const phoneSession = await signIn(stack, phone);
    await stack.resetRateLimits();
    const tablet = await signIn(stack, phone);
    const list = await stack.http
      .get('/v1/me/sessions')
      .set('Authorization', `Bearer ${phoneSession.accessToken}`)
      .expect(200);
    expect(list.body.data).toHaveLength(2);
    const other = (list.body.data as { id: string; current: boolean }[]).find((s) => !s.current);
    await stack.http
      .delete(`/v1/me/sessions/${other?.id}`)
      .set('Authorization', `Bearer ${phoneSession.accessToken}`)
      .expect(204);
    await stack.http.get('/v1/me').set('Authorization', `Bearer ${tablet.accessToken}`).expect(401);
  });

  it('rejects missing, malformed and forged tokens', async () => {
    await stack.http.get('/v1/me').expect(401);
    await stack.http.get('/v1/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    const forged = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.`;
    await stack.http.get('/v1/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('web sign-in keeps the refresh token in an httpOnly cookie', async () => {
    const phone = nextPhone();
    await stack.http.post('/v1/auth/otp/request').send({ phone }).expect(200);
    const code = /\b(\d{6})\b/.exec(stack.sms.lastTo(phone)?.body ?? '')?.[1];
    const response = await stack.http
      .post('/v1/auth/otp/verify')
      .send({ phone, code, device: WEB_DEVICE })
      .expect(200);
    expect(response.body.data.refreshToken).toBeUndefined();
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^sz_rt=.+HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const cookiePair = cookie.split(';')[0] ?? '';

    await stack.http.post('/v1/auth/refresh').set('Cookie', cookiePair).send({}).expect(401);
    const refreshed = await stack.http
      .post('/v1/auth/refresh')
      .set('Cookie', cookiePair)
      .set('X-Safezone-App', 'management-web')
      .send({})
      .expect(200);
    expect(refreshed.body.data.refreshToken).toBeUndefined();
    expect(refreshed.headers['set-cookie']?.[0]).toMatch(/^sz_rt=/);
  });

  describe('MFA for staff', () => {
    it('blocks staff until they enrol and verify, and rejects a replayed code', async () => {
      const estateId = await stack.createEstate();
      const phone = nextPhone();
      const userId = await stack.createUser(phone, 'Estate Manager');
      await stack.addMember(estateId, userId, 'estate_manager');

      const session = await signIn(stack, phone);
      expect(session).toMatchObject({ mfaRequired: true, mfaEnrolled: false });
      const auth = { Authorization: `Bearer ${session.accessToken}` };

      const blocked = await stack.http.get(`/v1/estates/${estateId}`).set(auth).expect(403);
      expect(blocked.body.error.code).toBe('MFA_REQUIRED');
      await stack.http.get('/v1/me').set(auth).expect(200);

      const enrolment = await stack.http.post('/v1/me/mfa/totp').set(auth).expect(200);
      const { factorId, secret } = enrolment.body.data as { factorId: string; secret: string };
      const code = hotp(base32Decode(secret), timeStep());
      const confirmed = await stack.http
        .post('/v1/me/mfa/totp/confirm')
        .set(auth)
        .send({ factorId, code })
        .expect(200);
      const recoveryCodes = confirmed.body.data.recoveryCodes as string[];
      expect(recoveryCodes).toHaveLength(10);

      await stack.http.get(`/v1/estates/${estateId}`).set(auth).expect(200);

      // New session: must verify again; the code already used cannot be replayed.
      await stack.resetRateLimits();
      const next = await signIn(stack, phone);
      expect(next).toMatchObject({ mfaRequired: true, mfaEnrolled: true });
      const nextAuth = { Authorization: `Bearer ${next.accessToken}` };
      const replay = await stack.http
        .post('/v1/auth/mfa/verify')
        .set(nextAuth)
        .send({ code })
        .expect(400);
      expect(replay.body.error.code).toBe('MFA_CODE_INVALID');

      await stack.http
        .post('/v1/auth/mfa/verify')
        .set(nextAuth)
        .send({ recoveryCode: recoveryCodes[0] })
        .expect(200);
      await stack.http.get(`/v1/estates/${estateId}`).set(nextAuth).expect(200);
      // Recovery codes work once.
      await stack.resetRateLimits();
      const third = await signIn(stack, phone);
      await stack.http
        .post('/v1/auth/mfa/verify')
        .set({ Authorization: `Bearer ${third.accessToken}` })
        .send({ recoveryCode: recoveryCodes[0] })
        .expect(400);
    });

    it('does not ask residents for MFA', async () => {
      const estateId = await stack.createEstate();
      const phone = nextPhone();
      const userId = await stack.createUser(phone);
      await stack.addMember(estateId, userId, 'tenant');
      const session = await signIn(stack, phone);
      expect(session.mfaRequired).toBe(false);
      await stack.http
        .get(`/v1/estates/${estateId}`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
    });
  });
});
