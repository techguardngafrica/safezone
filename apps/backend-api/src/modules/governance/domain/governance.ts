/**
 * Governance voting, quorum and threshold rules (governance.md §4, ADR-0026).
 */

export type MotionEligibility = 'per_unit' | 'per_owner' | 'per_resident';
export type MotionThreshold = 'simple' | 'two_thirds' | 'custom';

/** Deduplication key enforcing one vote per eligible unit, owner or resident. */
export function buildVoterKey(
  eligibility: MotionEligibility,
  userId: string,
  unitId?: string | null,
  proxyForUserId?: string | null,
): string {
  if (eligibility === 'per_unit') {
    if (!unitId) throw new Error('unitId is required for per_unit motions');
    return `unit:${unitId}`;
  }
  return `user:${proxyForUserId ?? userId}`;
}

/** Evaluates tallies, quorum and threshold at motion close. */
export function evaluateMotionResult(input: {
  options: readonly string[];
  voteOptions: readonly string[];
  quorumCount: number;
  threshold: MotionThreshold;
  customThresholdPercent?: number | null;
}) {
  const counts = new Map<string, number>(input.options.map((o) => [o, 0]));
  for (const opt of input.voteOptions) {
    if (counts.has(opt)) counts.set(opt, (counts.get(opt) ?? 0) + 1);
  }
  const totalVotes = input.voteOptions.length;
  const quorumMet = totalVotes >= input.quorumCount;
  const tallies = input.options.map((option) => {
    const votes = counts.get(option) ?? 0;
    const percent = totalVotes > 0 ? Math.round((votes / totalVotes) * 10_000) / 100 : 0;
    return { option, votes, percent };
  });

  if (!quorumMet || totalVotes === 0) {
    return {
      totalVotes,
      quorumMet,
      status: 'void' as const,
      winningOption: null,
      tallies,
    };
  }

  const sorted = [...tallies].sort((a, b) => b.votes - a.votes);
  const top = sorted[0]!;
  const second = sorted[1];
  const isTie = second !== undefined && top.votes === second.votes;
  const requiredPercent =
    input.threshold === 'two_thirds'
      ? 66.67
      : input.threshold === 'custom'
        ? (input.customThresholdPercent ?? 50)
        : 50.01;

  const passed = !isTie && top.percent >= requiredPercent;
  return {
    totalVotes,
    quorumMet,
    status: passed ? ('passed' as const) : ('failed' as const),
    winningOption: passed ? top.option : null,
    tallies,
  };
}
