import { z } from 'zod';
import { phoneE164Schema } from './common';

export const otpChannelSchema = z.enum(['sms', 'whatsapp']);

export const otpRequestSchema = z.object({
  phone: phoneE164Schema,
  channel: otpChannelSchema.default('sms'),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const deviceInfoSchema = z.object({
  app: z.enum([
    'resident-mobile',
    'management-web',
    'management-mobile',
    'security-mobile',
    'super-admin',
    'public-web',
  ]),
  platform: z.enum(['android', 'ios', 'web']),
  appVersion: z.string().min(1).max(32),
  model: z.string().max(100).optional(),
});

export const otpVerifySchema = z.object({
  phone: phoneE164Schema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  device: deviceInfoSchema,
});
export type OtpVerify = z.infer<typeof otpVerifySchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  mfaRequired: z.boolean().default(false),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;
