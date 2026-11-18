import type { ApiData, ApiRow } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import type { Tone } from '@safezone/mobile-ui';

export type Issue = ApiRow<'/v1/estates/{estateId}/maintenance-requests', 'get'>;
export type IssueDetail = ApiData<'/v1/estates/{estateId}/maintenance-requests/{id}', 'get'>;
export type IssueStatus = Issue['status'];
export type IssueKind = Issue['kind'];

/** UI_GUIDELINES §6.8 maintenance tones; "info requested" is a warning because it waits on the resident. */
export const ISSUE_TONE: Record<IssueStatus, Tone> = {
  submitted: 'neutral',
  under_review: 'info',
  info_requested: 'warning',
  approved: 'info',
  assigned: 'info',
  in_progress: 'info',
  awaiting_materials: 'warning',
  resolved: 'success',
  closed: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
};

export const issueStatusLabel = (status: IssueStatus) =>
  t(`res.issue.status.${status}` as MessageKey);

/** Statuses the resident can still cancel from (maintenance domain `cancel`). */
export const CANCELLABLE: IssueStatus[] = ['submitted', 'under_review', 'info_requested'];
export const isOpen = (issue: Issue) =>
  !['resolved', 'closed', 'rejected', 'cancelled'].includes(issue.status);

export type IssueInput = 'category' | 'title' | 'description' | 'preferredTimes';

/** API field paths mapped to the report form's inputs. */
export const ISSUE_FIELD_PATHS: Record<string, IssueInput> = {
  categoryId: 'category',
  title: 'title',
  description: 'description',
  preferredTimes: 'preferredTimes',
};

/** Same limits as the API (createMaintenanceRequestSchema), with friendly messages. */
export function checkIssue(draft: {
  categoryId: string | null;
  title: string;
  description: string;
}): Partial<Record<IssueInput, string>> {
  const errors: Partial<Record<IssueInput, string>> = {};
  if (!draft.categoryId) errors.category = t('res.issue.categoryRequired');
  if (draft.title.trim().length < 3) errors.title = t('res.issue.titleRequired');
  if (draft.description.trim().length < 3) errors.description = t('res.issue.descriptionRequired');
  return errors;
}
