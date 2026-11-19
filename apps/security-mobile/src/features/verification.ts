import { type MessageKey, t } from '@safezone/i18n';
import type { VerifyResult } from '../offline/verify';

/**
 * The last check, handed from the scan or PIN screen to the result screen in memory (never in the URL:
 * it holds the visitor's name). A result older than two minutes is not acted on.
 */
export interface Verification {
  result: VerifyResult;
  direction: 'in' | 'out';
  checkedAt: number;
}

const MAX_AGE_MS = 2 * 60_000;
let current: Verification | null = null;

export function setVerification(value: Verification): void {
  current = value;
}

export function takeVerification(): Verification | null {
  if (!current || Date.now() - current.checkedAt > MAX_AGE_MS) return null;
  return current;
}

export function clearVerification(): void {
  current = null;
}

/** Plain words for an API or offline reason code. */
export function reasonText(code: string): string {
  const key = `sec.reason.${code}` as MessageKey;
  const text = t(key);
  return text === key ? t('sec.reason.unknown') : text;
}

export function passTypeText(type: string): string {
  const key = `passes.type.${type}` as MessageKey;
  const text = t(key);
  return text === key ? type : text;
}
