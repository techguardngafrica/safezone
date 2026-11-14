import { ApiClientError } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';

/** User-facing text for a failed call. Known codes are translated; others use the API's message. */
export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    const key = `api.error.${error.code}` as MessageKey;
    const translated = t(key);
    if (translated !== key) return translated;
    return error.message || t('common.error');
  }
  return t('common.error');
}
