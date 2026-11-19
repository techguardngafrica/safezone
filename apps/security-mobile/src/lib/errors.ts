import { ApiClientError, fieldErrors } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';

/** User-facing text for a failed call. Known codes are translated; others use the API's message. */
export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'NETWORK_ERROR') return t('auth.error.NETWORK_ERROR');
    if (error.code === 'VALIDATION_FAILED') return validationText(error);
    const key = `api.error.${error.code}` as MessageKey;
    const translated = t(key);
    if (translated !== key) return translated;
    return error.message || t('common.error');
  }
  return t('common.error');
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'NETWORK_ERROR';
}

/** "phone: Enter a valid…" from `visitors.0.phone`: the last named segment, in plain words. */
function fieldLabel(path: string): string {
  const name =
    path
      .split('.')
      .filter((part) => !/^\d+$/.test(part))
      .pop() ?? path;
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * For forms that do not map errors onto their inputs: names each invalid field, so the user is never
 * left with only "Some fields are invalid".
 */
export function validationText(error: unknown): string {
  const fields = Object.entries(fieldErrors(error));
  if (fields.length === 0) return t('ui.fixFieldsGeneric');
  return t('ui.fixFieldsList', {
    fields: fields.map(([path, message]) => `${fieldLabel(path)}: ${message}`).join('; '),
  });
}
