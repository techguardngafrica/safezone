/**
 * @safezone/i18n — all user-facing strings go through t() (AGENTS.md §7).
 */
import { en, type MessageKey, type Messages } from './locales/en';

export type { MessageKey, Messages };

export const SUPPORTED_LOCALES = ['en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const catalogues: Record<Locale, Messages> = { en };

/** Translate a key, replacing {placeholders}. Falls back to English, then to the key itself. */
export function t(
  key: MessageKey,
  params: Record<string, string | number> = {},
  locale: Locale = DEFAULT_LOCALE,
): string {
  const template = catalogues[locale]?.[key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function createTranslator(locale: Locale) {
  return (key: MessageKey, params?: Record<string, string | number>) => t(key, params, locale);
}
