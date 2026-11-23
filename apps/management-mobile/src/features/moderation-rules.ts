export type ModerationTargetType = 'message' | 'channel' | 'user';

export type ModerationActionKind =
  'remove_message' | 'warn' | 'mute' | 'remove_from_channel' | 'suspend_channel' | 'dismiss_report';

export const MUTE_DURATIONS = [1, 6, 24, 72, 168] as const;

const ACTIONS_BY_TARGET: Record<ModerationTargetType, readonly ModerationActionKind[]> = {
  message: ['remove_message', 'warn', 'mute', 'dismiss_report'],
  channel: ['suspend_channel', 'warn', 'dismiss_report'],
  user: ['warn', 'mute', 'remove_from_channel', 'dismiss_report'],
};

/** Valid moderation actions for a reported item target type. */
export function moderationActionsFor(
  targetType: ModerationTargetType,
): readonly ModerationActionKind[] {
  return ACTIONS_BY_TARGET[targetType];
}

/** True when the action is destructive (red confirm button). */
export function isDestructiveModeration(action: ModerationActionKind): boolean {
  return action !== 'dismiss_report' && action !== 'warn';
}

/** Validates moderation reason (3+ chars) and optional mute duration. */
export function moderationInputValid(
  action: ModerationActionKind,
  reason: string,
  durationHours?: number,
): boolean {
  if (reason.trim().length < 3) return false;
  if (action === 'mute') return typeof durationHours === 'number' && durationHours >= 1;
  return true;
}
