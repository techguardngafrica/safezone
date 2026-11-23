import { describe, expect, it } from 'vitest';
import { buildVoterKey, evaluateMotionResult } from './governance';

describe('governance domain rules', () => {
  it('enforces per_unit vs per_resident voter keys', () => {
    expect(buildVoterKey('per_unit', 'u1', 'unit-42')).toBe('unit:unit-42');
    expect(buildVoterKey('per_resident', 'u1', 'unit-42')).toBe('user:u1');
    expect(buildVoterKey('per_owner', 'u1', null, 'owner-9')).toBe('user:owner-9');
    expect(() => buildVoterKey('per_unit', 'u1')).toThrow();
  });

  it('evaluates quorum, simple majority and two-thirds thresholds', () => {
    const voidRes = evaluateMotionResult({
      options: ['Yes', 'No'],
      voteOptions: ['Yes'],
      quorumCount: 5,
      threshold: 'simple',
    });
    expect(voidRes.status).toBe('void');
    expect(voidRes.quorumMet).toBe(false);

    const passSimple = evaluateMotionResult({
      options: ['Yes', 'No'],
      voteOptions: ['Yes', 'Yes', 'No'],
      quorumCount: 3,
      threshold: 'simple',
    });
    expect(passSimple.status).toBe('passed');
    expect(passSimple.winningOption).toBe('Yes');

    const failTwoThirds = evaluateMotionResult({
      options: ['Yes', 'No'],
      voteOptions: ['Yes', 'Yes', 'No', 'No', 'Yes'],
      quorumCount: 3,
      threshold: 'two_thirds',
    });
    expect(failTwoThirds.status).toBe('failed');
  });
});
