import { describe, expect, it } from 'vitest';
import { matchesVisitor } from './visitor-search';

describe('matchesVisitor', () => {
  const fields = ['Chidi Okafor', 'LAG-123 AB', 'B12'];

  it('matches everything on an empty search', () => {
    expect(matchesVisitor('   ', fields)).toBe(true);
  });

  it('matches a name, plate or unit, ignoring case, spaces and dashes', () => {
    expect(matchesVisitor('chidi', fields)).toBe(true);
    expect(matchesVisitor('lag123ab', fields)).toBe(true);
    expect(matchesVisitor('b12', fields)).toBe(true);
  });

  it('needs every word to match some field', () => {
    expect(matchesVisitor('okafor b12', fields)).toBe(true);
    expect(matchesVisitor('okafor c40', fields)).toBe(false);
  });

  it('skips missing fields', () => {
    expect(matchesVisitor('ada', [null, undefined, 'Ada'])).toBe(true);
    expect(matchesVisitor('ada', [null])).toBe(false);
  });
});
