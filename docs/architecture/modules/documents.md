# Module: Documents and Files

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 0 (file storage service), 3 (document management) · Owner: Backend · Apps: all

## 1. Responsibility

Documents provides two things:

1. A **file service** every module uses: secure uploads and downloads through signed URLs, virus scanning, image processing, size/type validation and retention.
2. **Document management** for estates and residents: categorised documents with permissions, versions, expiry tracking and reminders, and access history.

## 2. Capabilities

### File service (Phase 0)

1. Signed upload URLs (direct to object storage), with type and size limits per purpose.
2. Virus/malware scanning before a file becomes available.
3. Image thumbnails and EXIF stripping (removes location metadata).
4. Video limits (length and size) for maintenance and incidents.
5. Signed, short-lived download URLs; audited downloads for sensitive purposes.
6. SHA-256 hash per file (evidence integrity).
7. Retention and purge per purpose.

### Document management (Phase 3)

8. Folders and categories (estate rules, constitution, AGM minutes, notices, contracts, insurance, property documents, resident documents, vendor documents).
9. Associations: estate, space (unit/building), household, user, vendor.
10. Permissions: managers only, all residents, specific roles, specific units/households, the owner/user.
11. Versioning (new version supersedes, history kept).
12. Expiry dates and reminders (e.g. insurance, vendor licences, tenancy agreements).
13. Access history (who viewed/downloaded).
14. Policy acknowledgements (link to [governance](governance.md)).

## 3. Data model

| Table                 | Key columns                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`               | `id`, `estate_id` (nullable for platform files), `purpose` (avatar, pass_photo, maintenance, incident_evidence, document, kyc, ad_creative, import, export…), `storage_key`, `mime_type`, `size_bytes`, `sha256`, `scan_status` (pending, clean, infected, error), `uploaded_by`, `created_at`, `purge_after` |
| `documents`           | `id`, `estate_id`, `folder_id`, `category`, `title`, `description`, `current_version_id`, `association_type`, `association_id`, `visibility` (jsonb rules), `expires_on`, `status`                                                                                                                            |
| `document_versions`   | `id`, `document_id`, `file_id`, `version`, `uploaded_by`, `created_at`, `notes`                                                                                                                                                                                                                               |
| `document_folders`    | `id`, `estate_id`, `parent_id`, `name`                                                                                                                                                                                                                                                                        |
| `document_access_log` | `id`, `estate_id`, `document_id`, `user_id`, `action` (view, download), `at`                                                                                                                                                                                                                                  |

## 4. Upload limits (defaults)

| Purpose                | Types                     | Max                             |
| ---------------------- | ------------------------- | ------------------------------- |
| Avatar                 | JPG, PNG, WebP            | 5 MB                            |
| Visitor/pass photo     | JPG                       | 2 MB                            |
| Maintenance / incident | JPG, PNG, MP4             | 10 MB image, 50 MB video (60 s) |
| Documents              | PDF, DOCX, XLSX, JPG, PNG | 20 MB                           |
| Imports                | XLSX, CSV                 | 20 MB                           |
| Ad creatives           | JPG, PNG, WebP, MP4       | Per placement spec              |

## 5. Business rules

1. Files are unavailable until scanned clean; infected files are quarantined and the uploader notified.
2. Download URLs expire in 5 minutes.
3. Sensitive purposes (KYC, incident evidence, resident documents) log every download.
4. EXIF location is stripped from all images.
5. Deleting a document hides it and keeps versions until the retention date.
6. Residents see only documents whose visibility rules include them.

## 6. API

| Method       | Path                                             | Purpose                                               |
| ------------ | ------------------------------------------------ | ----------------------------------------------------- |
| POST         | `/v1/files/upload-url`                           | Get signed upload URL (purpose, type, size, estateId) |
| POST         | `/v1/files/:id/complete`                         | Confirm upload, trigger scan                          |
| GET          | `/v1/files/:id/download-url`                     | Signed download URL (permission-checked)              |
| GET/POST     | `/v1/estates/:estateId/documents`                | List / create                                         |
| POST         | `/v1/estates/:estateId/documents/:id/versions`   | New version                                           |
| PATCH/DELETE | `/v1/estates/:estateId/documents/:id`            | Update / delete                                       |
| GET          | `/v1/estates/:estateId/documents/:id/access-log` | Access history                                        |
| GET/POST     | `/v1/estates/:estateId/document-folders`         | Folders                                               |

## 7. Events and jobs

Events: `documents.file.scanned`, `documents.document.created`, `documents.document.expiring`, `documents.document.accessed`.
Jobs: `files.scan`, `files.thumbnails`, `documents.expiry.remind` (daily: 30, 7, 1 days), `files.purge` (daily).

## 8. Acceptance criteria

- An uploaded image has no GPS EXIF data when downloaded.
- A resident cannot obtain a download URL for a managers-only document.
- Expiry reminders are sent at 30, 7 and 1 days before `expires_on`.
