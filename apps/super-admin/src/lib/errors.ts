import { ApiClientError, fieldErrors } from '@safezone/api-client';
import { t } from '@safezone/i18n';

export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'VALIDATION_FAILED') {
      const fields = Object.entries(fieldErrors(error));
      if (fields.length > 0) {
        return fields.map(([path, message]) => `${path}: ${message}`).join('; ');
      }
    }
    return error.message || t('common.error');
  }
  if (error instanceof Error && error.message) return error.message;
  return t('common.error');
}
