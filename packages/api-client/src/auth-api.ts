import type { AuthApi, SessionUser } from '@safezone/auth';
import type { DeviceInfo } from '@safezone/schemas';
import { type SafezoneClient, unwrap } from './index';

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function toUser(user: {
  id: string;
  phone: string;
  fullName: string | null;
  mfaEnabled: boolean;
}): SessionUser {
  return { id: user.id, phone: user.phone, fullName: user.fullName, mfaEnabled: user.mfaEnabled };
}

/**
 * The AuthApi every app shell needs, built on a client created with createSafezoneClient (without
 * getAccessToken: tokens are passed explicitly). Web clients must use credentials: 'include'.
 */
export function createAuthApi(client: SafezoneClient, device: DeviceInfo): AuthApi {
  return {
    async requestOtp(phone) {
      return unwrap(client.POST('/v1/auth/otp/request', { body: { phone, channel: 'sms' } }));
    },
    async verifyOtp(phone, code) {
      const result = await unwrap(
        client.POST('/v1/auth/otp/verify', { body: { phone, code, device } }),
      );
      return { ...result, user: toUser(result.user) };
    },
    async refresh(refreshToken) {
      return unwrap(
        client.POST('/v1/auth/refresh', { body: refreshToken ? { refreshToken } : {} }),
      );
    },
    async me(accessToken) {
      return toUser(await unwrap(client.GET('/v1/me', bearer(accessToken))));
    },
    async signOut(accessToken) {
      await unwrap(client.POST('/v1/auth/signout', bearer(accessToken)));
    },
    async verifyMfa(accessToken, input) {
      await unwrap(client.POST('/v1/auth/mfa/verify', { ...bearer(accessToken), body: input }));
    },
    async startTotp(accessToken) {
      return unwrap(client.POST('/v1/me/mfa/totp', bearer(accessToken)));
    },
    async confirmTotp(accessToken, factorId, code) {
      return unwrap(
        client.POST('/v1/me/mfa/totp/confirm', {
          ...bearer(accessToken),
          body: { factorId, code },
        }),
      );
    },
  };
}
