import { describe, expect, it, vi } from 'vitest';
import { createMemorySessionStorage } from './index';
import { type AuthApi, SessionController, type SignInResult } from './session-controller';

const future = () => new Date(Date.now() + 15 * 60_000).toISOString();
const user = { id: 'u1', phone: '+2348031234567', fullName: null, mfaEnabled: false };

function fakeApi(overrides: Partial<AuthApi> = {}): AuthApi {
  const signIn: SignInResult = {
    accessToken: 'access-1',
    accessTokenExpiresAt: future(),
    refreshToken: 'refresh-1',
    mfaRequired: false,
    mfaEnrolled: false,
    user,
    isNewUser: true,
  };
  return {
    requestOtp: vi.fn().mockResolvedValue({ resendAfterSeconds: 30 }),
    verifyOtp: vi.fn().mockResolvedValue(signIn),
    refresh: vi.fn().mockResolvedValue({
      accessToken: 'access-2',
      accessTokenExpiresAt: future(),
      refreshToken: 'refresh-2',
      mfaRequired: false,
      mfaEnrolled: false,
    }),
    me: vi.fn().mockResolvedValue(user),
    signOut: vi.fn().mockResolvedValue(undefined),
    verifyMfa: vi.fn().mockResolvedValue(undefined),
    startTotp: vi
      .fn()
      .mockResolvedValue({ factorId: 'f1', secret: 'SECRET', otpauthUri: 'otpauth://x' }),
    confirmTotp: vi.fn().mockResolvedValue({ recoveryCodes: ['AAAAA-BBBBB'] }),
    ...overrides,
  };
}

describe('SessionController', () => {
  it('signs in a resident: phone, code, signed in, refresh token kept on mobile', async () => {
    const storage = createMemorySessionStorage();
    const controller = new SessionController(fakeApi(), storage, true);
    await controller.restore();
    expect(controller.getState().status).toBe('signed_out');

    await controller.requestCode('+2348031234567');
    expect(controller.getState()).toMatchObject({ status: 'code_sent', resendAfterSeconds: 30 });
    await controller.verifyCode('123456');
    expect(controller.getState()).toMatchObject({ status: 'signed_in', user });
    expect(await storage.get()).toMatchObject({ refreshToken: 'refresh-1' });
    expect(await controller.getAccessToken()).toBe('access-1');
  });

  it('never stores a refresh token on web', async () => {
    const storage = createMemorySessionStorage();
    const controller = new SessionController(fakeApi(), storage, false);
    await controller.requestCode('+2348031234567');
    await controller.verifyCode('123456');
    expect((await storage.get())?.refreshToken).toBeUndefined();
  });

  it('sends staff without MFA through enrolment and recovery codes', async () => {
    const api = fakeApi({
      verifyOtp: vi.fn().mockResolvedValue({
        accessToken: 'a',
        accessTokenExpiresAt: future(),
        mfaRequired: true,
        mfaEnrolled: false,
        user,
        isNewUser: false,
      }),
    });
    const controller = new SessionController(api, createMemorySessionStorage(), false);
    await controller.requestCode('+2348031234567');
    await controller.verifyCode('123456');
    expect(controller.getState()).toMatchObject({
      status: 'mfa_enrol',
      enrolment: { factorId: 'f1' },
    });
    await controller.confirmEnrolment('654321');
    expect(controller.getState()).toMatchObject({
      status: 'recovery_codes',
      recoveryCodes: ['AAAAA-BBBBB'],
    });
    controller.finishEnrolment();
    expect(controller.getState().status).toBe('signed_in');
  });

  it('asks enrolled staff for a code and keeps the error code on failure', async () => {
    const api = fakeApi({
      verifyOtp: vi.fn().mockResolvedValue({
        accessToken: 'a',
        accessTokenExpiresAt: future(),
        mfaRequired: true,
        mfaEnrolled: true,
        user,
        isNewUser: false,
      }),
      verifyMfa: vi
        .fn()
        .mockRejectedValueOnce({ code: 'MFA_CODE_INVALID' })
        .mockResolvedValueOnce(undefined),
    });
    const controller = new SessionController(api, createMemorySessionStorage(), false);
    await controller.requestCode('+2348031234567');
    await controller.verifyCode('123456');
    expect(controller.getState().status).toBe('mfa_verify');
    await controller.verifyMfa({ code: '000000' });
    expect(controller.getState()).toMatchObject({
      status: 'mfa_verify',
      errorCode: 'MFA_CODE_INVALID',
      busy: false,
    });
    await controller.verifyMfa({ code: '111111' });
    expect(controller.getState().status).toBe('signed_in');
  });

  it('restores a mobile session with the stored refresh token and signs out cleanly', async () => {
    const storage = createMemorySessionStorage();
    await storage.set({
      accessToken: 'old',
      accessTokenExpiresAt: future(),
      refreshToken: 'refresh-1',
    });
    const api = fakeApi();
    const controller = new SessionController(api, storage, true);
    await controller.restore();
    expect(api.refresh).toHaveBeenCalledWith('refresh-1');
    expect(controller.getState().status).toBe('signed_in');

    await controller.signOut();
    expect(api.signOut).toHaveBeenCalledWith('access-2');
    expect(controller.getState().status).toBe('signed_out');
    expect(await storage.get()).toBeNull();
  });

  it('falls back to signed out when restore fails', async () => {
    const storage = createMemorySessionStorage();
    await storage.set({
      accessToken: 'old',
      accessTokenExpiresAt: future(),
      refreshToken: 'stale',
    });
    const controller = new SessionController(
      fakeApi({ refresh: vi.fn().mockRejectedValue({ code: 'SESSION_INVALID' }) }),
      storage,
      true,
    );
    await controller.restore();
    expect(controller.getState().status).toBe('signed_out');
  });

  it('restores once when restore is called twice at the same time (web, cookie refresh)', async () => {
    const api = fakeApi();
    const controller = new SessionController(api, createMemorySessionStorage(), false);
    await Promise.all([controller.restore(), controller.restore()]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('signed_in');
  });

  it('refreshes an expiring access token once for concurrent callers', async () => {
    const api = fakeApi({
      verifyOtp: vi.fn().mockResolvedValue({
        accessToken: 'a',
        accessTokenExpiresAt: new Date(Date.now() + 10_000).toISOString(),
        refreshToken: 'r',
        mfaRequired: false,
        mfaEnrolled: false,
        user,
        isNewUser: false,
      }),
    });
    const controller = new SessionController(api, createMemorySessionStorage(), true);
    await controller.requestCode('+2348031234567');
    await controller.verifyCode('123456');
    const [first, second] = await Promise.all([
      controller.getAccessToken(),
      controller.getAccessToken(),
    ]);
    expect(first).toBe('access-2');
    expect(second).toBe('access-2');
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });
  it('reopens a fully signed-in mobile session offline and keeps it when a refresh fails offline', async () => {
    const storage = createMemorySessionStorage();
    const online = new SessionController(fakeApi(), storage, true);
    await online.requestCode('+2348031234567');
    await online.verifyCode('123456');
    await vi.waitFor(async () => expect((await storage.get())?.user).toEqual(user));

    const offlineApi = fakeApi({ refresh: vi.fn().mockRejectedValue({ code: 'NETWORK_ERROR' }) });
    const reopened = new SessionController(offlineApi, storage, true);
    await reopened.restore();
    expect(reopened.getState()).toMatchObject({ status: 'signed_in', user });
    expect(await storage.get()).not.toBeNull();
  });

  it('does not reopen offline when MFA was never completed', async () => {
    const storage = createMemorySessionStorage();
    await storage.set({ accessToken: 'a', accessTokenExpiresAt: future(), refreshToken: 'r' });
    const controller = new SessionController(
      fakeApi({ refresh: vi.fn().mockRejectedValue({ code: 'NETWORK_ERROR' }) }),
      storage,
      true,
    );
    await controller.restore();
    expect(controller.getState().status).toBe('signed_out');
  });

  it('keeps the session when a token refresh fails for lack of network', async () => {
    const api = fakeApi({
      verifyOtp: vi.fn().mockResolvedValue({
        accessToken: 'a',
        accessTokenExpiresAt: new Date(Date.now() + 10_000).toISOString(),
        refreshToken: 'r',
        mfaRequired: false,
        mfaEnrolled: false,
        user,
        isNewUser: false,
      }),
      refresh: vi.fn().mockRejectedValue({ code: 'NETWORK_ERROR' }),
    });
    const controller = new SessionController(api, createMemorySessionStorage(), true);
    await controller.requestCode('+2348031234567');
    await controller.verifyCode('123456');
    expect(await controller.getAccessToken()).toBe('a');
    expect(controller.getState().status).toBe('signed_in');
  });
  it('accepts an external sign-in (gate PIN) as signed in', async () => {
    const storage = createMemorySessionStorage();
    const controller = new SessionController(fakeApi(), storage, true);
    await controller.restore();
    await controller.acceptSignIn({
      accessToken: 'gate-a',
      accessTokenExpiresAt: future(),
      refreshToken: 'gate-r',
      mfaRequired: false,
      mfaEnrolled: true,
      user,
      isNewUser: false,
    });
    expect(controller.getState()).toMatchObject({ status: 'signed_in', user, offline: false });
    expect(await controller.getAccessToken()).toBe('gate-a');
    expect(await storage.get()).toMatchObject({ refreshToken: 'gate-r' });
  });

  it('signs in offline without tokens and forgets the previous session', async () => {
    const storage = createMemorySessionStorage();
    await storage.set({
      accessToken: 'old',
      accessTokenExpiresAt: future(),
      refreshToken: 'r',
      user,
    });
    const controller = new SessionController(fakeApi(), storage, true);
    const guard = { ...user, id: 'u2', fullName: 'Musa Bello' };
    await controller.signInOffline(guard);
    expect(controller.getState()).toMatchObject({
      status: 'signed_in',
      user: guard,
      offline: true,
    });
    expect(await controller.getAccessToken()).toBeNull();
    expect(await storage.get()).toBeNull();
    await controller.handleUnauthorized();
    expect(controller.getState().status).toBe('signed_out');
  });
});
