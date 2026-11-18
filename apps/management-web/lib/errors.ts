import { ApiClientError, fieldErrors } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';

/** User-facing text for a failed call. Known codes are translated; others use the API's message. */
export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'VALIDATION_FAILED') return validationText(error);
    const key = `api.error.${error.code}` as MessageKey;
    const translated = t(key);
    if (translated !== key) return translated;
    return error.message || t('common.error');
  }
  return t('common.error');
}

/** "unit type: Invalid option" from `body.unitType`: the last named segment, in plain words. */
function fieldLabel(path: string): string {
  const name =
    path
      .split('.')
      .filter((part) => !/^\d+$/.test(part))
      .pop() ?? path;
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** Names each invalid field, so a form never shows only "Some fields are invalid". */
export function validationText(error: unknown): string {
  const fields = Object.entries(fieldErrors(error));
  if (fields.length === 0) return t('ui.fixFieldsGeneric');
  return t('ui.fixFieldsList', {
    fields: fields.map(([path, message]) => `${fieldLabel(path)}: ${message}`).join('; '),
  });
}

/**
 * Splits a VALIDATION_FAILED response into per-input messages. `inputs` maps API field paths (as in
 * `amountRule.amount`) to the form's input keys; anything else lands in `other`, for the summary.
 */
export function formErrors<K extends string>(
  error: unknown,
  inputs: Record<string, K>,
): { fields: Partial<Record<K, string>>; other: string[] } {
  const fields: Partial<Record<K, string>> = {};
  const other: string[] = [];
  for (const [path, message] of Object.entries(fieldErrors(error))) {
    const key = inputs[path.replace(/^body\./, '')];
    if (key && !fields[key]) fields[key] = message;
    else if (!key) other.push(`${fieldLabel(path)}: ${message}`);
  }
  return { fields, other };
}
