import type { JobsOptions } from 'bullmq';

/**
 * Queues (backend-api.md §11). `sos` has its own worker pool and nothing else may use it.
 * `audit` receives every event that carries an audit record.
 */
export const QUEUES = {
  sos: 'sos',
  notifications: 'notifications',
  outbox: 'outbox',
  audit: 'audit',
  gate: 'gate',
  billing: 'billing',
  payments: 'payments',
  imports: 'imports',
  exports: 'exports',
  ads: 'ads',
  files: 'files',
  maintenanceJobs: 'maintenance-jobs',
  /** Poll closing and other community housekeeping. */
  community: 'community',
  /** Booking holds, completion, reminders and payment confirmation. */
  facilities: 'facilities',
  /** Daily move-outs and lease reminders. */
  occupancy: 'occupancy',
  /** Estate onboarding: invitation sends. */
  onboarding: 'onboarding',
  /** Prepaid token purchases: paid, vend with retries, refunds, stuck sweep (ADR-0018). */
  utilities: 'utilities',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Retries with exponential backoff; failed jobs are kept (the dead-letter set) for alerting and replay. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: false,
};

/** BullMQ key prefix, so queues never collide with rate-limit or cache keys. */
export const QUEUE_PREFIX = 'sz:q';
