import type { Permission } from '@safezone/permissions';

const MB = 1024 * 1024;

export interface PurposeRule {
  /** estate: stored under an estate, visible by estate rules. user: the uploader's own file. */
  scope: 'estate' | 'user';
  mimeTypes: Readonly<Record<string, number>>;
  /** Extra permission needed to upload, beyond estate membership. */
  uploadPermission?: Permission;
  /**
   * Who else may download (the uploader always may). Until document visibility rules arrive (Phase 3),
   * estate files are limited to the staff who handle them.
   */
  downloadPermissions?: readonly Permission[];
  /** Every download is audited (documents.md §5.3). */
  sensitive: boolean;
}

const IMAGE_10MB = { 'image/jpeg': 10 * MB, 'image/png': 10 * MB };

/** Upload limits per purpose (documents.md §4). Ad creatives arrive with the advertising module. */
export const FILE_PURPOSES = {
  avatar: {
    scope: 'user',
    mimeTypes: { 'image/jpeg': 5 * MB, 'image/png': 5 * MB, 'image/webp': 5 * MB },
    sensitive: false,
  },
  estate_application: {
    scope: 'user',
    mimeTypes: { 'application/pdf': 20 * MB, 'image/jpeg': 20 * MB, 'image/png': 20 * MB },
    sensitive: true,
  },
  pass_photo: {
    scope: 'estate',
    mimeTypes: { 'image/jpeg': 2 * MB },
    downloadPermissions: ['gate.verify', 'visitor.log.read'],
    sensitive: false,
  },
  maintenance: {
    scope: 'estate',
    mimeTypes: { ...IMAGE_10MB, 'video/mp4': 50 * MB },
    downloadPermissions: ['maintenance.assign'],
    sensitive: false,
  },
  incident_evidence: {
    scope: 'estate',
    mimeTypes: { ...IMAGE_10MB, 'video/mp4': 50 * MB },
    downloadPermissions: ['incident.manage'],
    sensitive: true,
  },
  document: {
    scope: 'estate',
    mimeTypes: {
      'application/pdf': 20 * MB,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 20 * MB,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 20 * MB,
      'image/jpeg': 20 * MB,
      'image/png': 20 * MB,
    },
    uploadPermission: 'document.manage',
    downloadPermissions: ['document.manage'],
    sensitive: true,
  },
  import: {
    scope: 'estate',
    mimeTypes: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 20 * MB,
      'text/csv': 20 * MB,
    },
    uploadPermission: 'import.run',
    downloadPermissions: ['import.run'],
    sensitive: false,
  },
} as const satisfies Record<string, PurposeRule>;

export type FilePurpose = keyof typeof FILE_PURPOSES;
export const FILE_PURPOSE_KEYS = Object.keys(FILE_PURPOSES) as FilePurpose[];
export const MAX_FILE_BYTES = 50 * MB;

/** Returns the size limit for this purpose and type, or null when the type is not allowed. */
export function maxBytesFor(purpose: FilePurpose, mimeType: string): number | null {
  const limits: Readonly<Record<string, number>> = FILE_PURPOSES[purpose].mimeTypes;
  return limits[mimeType] ?? null;
}
