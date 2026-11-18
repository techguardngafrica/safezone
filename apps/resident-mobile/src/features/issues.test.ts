import { describe, expect, it } from 'vitest';
import { checkIssue } from './issues';

describe('checkIssue', () => {
  it('passes a complete report', () => {
    expect(
      checkIssue({ categoryId: 'c1', title: 'Leaking tap', description: 'Kitchen tap drips' }),
    ).toEqual({});
  });

  it('names each missing field', () => {
    expect(
      Object.keys(checkIssue({ categoryId: null, title: 'ab', description: ' ' })).sort(),
    ).toEqual(['category', 'description', 'title']);
  });
});
