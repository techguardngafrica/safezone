import { ApiClientError } from '@safezone/api-client';
import { describe, expect, it } from 'vitest';
import { validationText } from './errors';
import { formErrors } from './form-errors';

describe('formErrors', () => {
  it('puts known paths on inputs and the rest in the summary', () => {
    const error = new ApiClientError('VALIDATION_FAILED', 'Some fields are invalid', 400, [
      { path: 'body.visitors.0.phone', message: 'Bad phone' },
      { path: 'body.recurrence', message: 'Needs a schedule' },
    ]);
    expect(formErrors(error, { 'visitors.0.phone': 'phone' })).toEqual({
      fields: { phone: 'Bad phone' },
      other: ['Needs a schedule'],
    });
  });

  it('returns nothing for non-validation errors', () => {
    expect(formErrors(new Error('offline'), { a: 'a' })).toEqual({ fields: {}, other: [] });
  });
});

describe('validationText', () => {
  it('names each invalid field in plain words', () => {
    const error = new ApiClientError('VALIDATION_FAILED', 'Some fields are invalid', 400, [
      { path: 'body.visitors.0.vehiclePlate', message: 'Too short' },
    ]);
    expect(validationText(error)).toContain('vehicle plate: Too short');
  });
});
