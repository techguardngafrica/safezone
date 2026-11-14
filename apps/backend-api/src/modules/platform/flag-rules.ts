import { createHash } from 'node:crypto';
import { z } from 'zod';
import { compareVersions } from '../../common/app-config/compare-versions';

/**
 * Flag targeting (modules/platform.md §2.2). A flag is on when defaultEnabled is true, or when every
 * target given matches and the subject falls inside the rollout percentage.
 */
export const flagRulesSchema = z
  .object({
    estateIds: z.array(z.uuid()).max(500).optional(),
    apps: z.array(z.string().min(1).max(40)).max(10).optional(),
    minAppVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .optional(),
    percent: z.number().int().min(0).max(100).optional(),
  })
  .strict();
export type FlagRules = z.infer<typeof flagRulesSchema>;

export interface FlagSubject {
  estateId?: string | null;
  userId?: string | null;
  app?: string | null;
  appVersion?: string | null;
}

export interface FlagDefinition {
  key: string;
  defaultEnabled: boolean;
  rules: FlagRules;
}

/** Stable 0-99 bucket per flag and subject, so a rollout does not flicker between requests. */
export function rolloutBucket(flagKey: string, subjectId: string): number {
  return createHash('sha256').update(`${flagKey}:${subjectId}`).digest().readUInt32BE(0) % 100;
}

export function isFlagEnabled(flag: FlagDefinition, subject: FlagSubject): boolean {
  if (flag.defaultEnabled) return true;
  const { estateIds, apps, minAppVersion, percent } = flag.rules;
  const hasTargeting =
    estateIds !== undefined ||
    apps !== undefined ||
    minAppVersion !== undefined ||
    percent !== undefined;
  if (!hasTargeting) return false;
  if (estateIds && (!subject.estateId || !estateIds.includes(subject.estateId))) return false;
  if (apps && (!subject.app || !apps.includes(subject.app))) return false;
  if (
    minAppVersion &&
    (!subject.appVersion || compareVersions(subject.appVersion, minAppVersion) < 0)
  )
    return false;
  if (percent !== undefined && percent < 100) {
    const subjectId = subject.estateId ?? subject.userId;
    if (!subjectId) return false;
    return rolloutBucket(flag.key, subjectId) < percent;
  }
  return true;
}
