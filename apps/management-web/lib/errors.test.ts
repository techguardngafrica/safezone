import { ApiClientError } from '@safezone/api-client';
import { describe, expect, it } from 'vitest';
import { errorText } from './errors';

describe('errorText', () => {
  it('names the invalid fields of a validation error', () => {
    const error = new ApiClientError('VALIDATION_FAILED', 'Some fields are invalid', 400, [
      { path: 'body.code', message: 'Too long' },
      { path: 'body.unitType', message: 'Invalid option' },
    ]);
    expect(errorText(error)).toBe(
      'Some details need fixing: code: Too long; unit type: Invalid option',
    );
  });

  it('keeps the API message for other errors', () => {
    expect(errorText(new ApiClientError('CONFLICT_X', 'Already exists', 409))).toBe(
      'Already exists',
    );
  });
});
