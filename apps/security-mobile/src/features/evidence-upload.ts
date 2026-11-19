import { unwrap } from '@safezone/api-client';
import { api } from '../lib/session';

/**
 * Uploads one photo as incident evidence: signed URL, PUT the bytes, then confirm (the API hashes the
 * stored file for chain of custody, security.md §4.6). Returns the file id to attach.
 */
export async function uploadEvidencePhoto(estateId: string, uri: string): Promise<string> {
  const local = await fetch(uri);
  const blob = await local.blob();
  const ticket = await unwrap(
    api.POST('/v1/estates/{estateId}/files/upload-url', {
      params: { path: { estateId } },
      body: { purpose: 'incident_evidence', mimeType: 'image/jpeg', sizeBytes: blob.size },
    }),
  );
  const put = await fetch(ticket.uploadUrl, {
    method: ticket.method,
    headers: ticket.headers,
    body: blob,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  await unwrap(
    api.POST('/v1/estates/{estateId}/files/{id}/complete', {
      params: { path: { estateId, id: ticket.fileId } },
    }),
  );
  return ticket.fileId;
}
