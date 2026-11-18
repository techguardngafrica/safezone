import type { ApiRow } from '@safezone/api-client';
import type { IconName } from '../components/icon';

export type Channel = ApiRow<'/v1/estates/{estateId}/channels', 'get'>;
export type Message = ApiRow<'/v1/estates/{estateId}/channels/{id}/messages', 'get'>;
export type Poll = ApiRow<'/v1/estates/{estateId}/polls', 'get'>;

/**
 * Reactions are stored as short words and drawn with outline icons: the UI rules ban emoji used as
 * icons. A reaction another client sent that is not in this list is shown as its text.
 */
export const REACTIONS: { key: string; icon: IconName; activeIcon: IconName }[] = [
  { key: 'like', icon: 'thumbs-up-outline', activeIcon: 'thumbs-up' },
  { key: 'heart', icon: 'heart-outline', activeIcon: 'heart' },
  { key: 'thanks', icon: 'hand-left-outline', activeIcon: 'hand-left' },
  { key: 'agree', icon: 'checkmark-circle-outline', activeIcon: 'checkmark-circle' },
  { key: 'laugh', icon: 'happy-outline', activeIcon: 'happy' },
];
export const reactionFor = (key: string) => REACTIONS.find((reaction) => reaction.key === key);

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'violence',
  'scam',
  'privacy',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Share of votes per option, rounded so the shown numbers add up to 100 when there are votes. */
export function pollShares(
  poll: Poll,
): { id: string; label: string; votes: number; percent: number }[] {
  const total = poll.options.reduce((sum, option) => sum + (option.votes ?? 0), 0);
  const exact = poll.options.map((option) => ({
    id: option.id,
    label: option.label,
    votes: option.votes ?? 0,
    raw: total > 0 ? ((option.votes ?? 0) * 100) / total : 0,
  }));
  const floors = exact.map((option) => Math.floor(option.raw));
  let remainder = total > 0 ? 100 - floors.reduce((sum, value) => sum + value, 0) : 0;
  const order = exact
    .map((option, index) => ({ index, fraction: option.raw - Math.floor(option.raw) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    remainder -= 1;
  }
  return exact.map((option, index) => ({
    id: option.id,
    label: option.label,
    votes: option.votes,
    percent: floors[index] ?? 0,
  }));
}

/** Messages a member can act on: their own visible messages can be edited and deleted. */
export const isMine = (message: Message, me: string | undefined) =>
  Boolean(me) && message.authorId === me;
