import { z } from 'zod';
import { phoneE164Schema } from './common';

export const otpChannelSchema = z.enum(['sms', 'whatsapp']);

export const APP_KEYS = [
  'resident-mobile',
  'management-web',
  'management-mobile',
  'security-mobile',
  'super-admin',
  'public-web',
] as const;
export const appKeySchema = z.enum(APP_KEYS);
export type AppKey = z.infer<typeof appKeySchema>;

/** Web apps keep the refresh token in an httpOnly cookie; they never see it. */
export const WEB_APPS: readonly AppKey[] = ['management-web', 'super-admin', 'public-web'];

export const otpRequestSchema = z.object({
  phone: phoneE164Schema,
  channel: otpChannelSchema.default('sms'),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

/** Same response whether or not the number has an account (no enumeration). */
export const otpRequestResponseSchema = z.object({
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
});

export const deviceInfoSchema = z.object({
  app: appKeySchema,
  platform: z.enum(['android', 'ios', 'web']),
  appVersion: z.string().min(1).max(32),
  model: z.string().max(100).optional(),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export const otpVerifySchema = z.object({
  phone: phoneE164Schema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  device: deviceInfoSchema,
});
export type OtpVerify = z.infer<typeof otpVerifySchema>;

export const userProfileSchema = z.object({
  id: z.uuid(),
  phone: z.string(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  locale: z.string(),
  mfaEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  /** Mobile only. Web apps receive it as an httpOnly cookie instead. */
  refreshToken: z.string().optional(),
  /**
   * True when this account must complete MFA before it can do anything else:
   * verify a code (mfaEnrolled) or enrol an authenticator first (!mfaEnrolled).
   */
  mfaRequired: z.boolean(),
  mfaEnrolled: z.boolean(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const signInResponseSchema = tokenPairSchema.extend({
  user: userProfileSchema,
  isNewUser: z.boolean(),
});
export type SignInResponse = z.infer<typeof signInResponseSchema>;

export const refreshRequestSchema = z.object({
  /** Omit on web: the API reads the httpOnly cookie. */
  refreshToken: z.string().min(20).max(200).optional(),
});

export const mfaVerifySchema = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/, 'Enter the 6-digit code')
      .optional(),
    recoveryCode: z
      .string()
      .regex(/^[A-Za-z0-9-]{10,20}$/)
      .optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    message: 'Send either a code or a recovery code',
  });

export const totpEnrolmentSchema = z.object({
  factorId: z.uuid(),
  /** Shown once. The user adds it to an authenticator app. */
  secret: z.string(),
  otpauthUri: z.string(),
});

export const totpConfirmSchema = z.object({
  factorId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const totpConfirmResponseSchema = z.object({
  /** Shown once. Each works one time if the authenticator is lost. */
  recoveryCodes: z.array(z.string()),
});

/** MFA state lives on the session, so the current access token keeps working after verification. */
export const mfaVerifyResponseSchema = z.object({ mfaVerified: z.literal(true) });

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    locale: z.enum(['en']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  app: z.string(),
  platform: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const idParamSchema = z.object({ id: z.uuid() });
