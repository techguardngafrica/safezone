import { describe, expect, it } from 'vitest';
import { type Poll, pollShares, reactionFor } from './community';

const poll = (votes: (number | null)[]) =>
  ({
    options: votes.map((count, index) => ({
      id: String(index),
      label: `Option ${index}`,
      votes: count,
    })),
  }) as Poll;

describe('pollShares', () => {
  it('adds up to 100 percent', () => {
    const shares = pollShares(poll([1, 1, 1]));
    expect(shares.map((share) => share.percent)).toEqual([34, 33, 33]);
  });
  it('is all zero without votes or with hidden counts', () => {
    expect(pollShares(poll([0, 0])).map((share) => share.percent)).toEqual([0, 0]);
    expect(pollShares(poll([null, null])).map((share) => share.votes)).toEqual([0, 0]);
  });
});

describe('reactionFor', () => {
  it('knows the word reactions and ignores others', () => {
    expect(reactionFor('like')?.icon).toBe('thumbs-up-outline');
    expect(reactionFor('party')).toBeUndefined();
  });
});
