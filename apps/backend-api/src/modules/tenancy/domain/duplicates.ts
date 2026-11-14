/** Duplicate check for new estates (tenancy.md §7.1): similar names, or similar names within 500 m. */
export const DUPLICATE_RADIUS_METRES = 500;

const STOP_WORDS = new Set([
  'estate',
  'estates',
  'the',
  'phase',
  'gardens',
  'garden',
  'court',
  'homes',
]);

export function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

/** Jaccard similarity of significant name tokens, 0 to 1. */
export function nameSimilarity(a: string, b: string): number {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.size === 0 || right.size === 0) {
    return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  }
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Great-circle distance in metres (haversine). */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface DuplicateCandidate {
  kind: 'estate' | 'application';
  id: string;
  name: string;
  state: string | null;
  location: GeoPoint | null;
}

export interface DuplicateMatch {
  kind: 'estate' | 'application';
  id: string;
  name: string;
  reason: 'same_name' | 'similar_name_nearby';
  distanceMetres: number | null;
}

/**
 * Flags candidates for the reviewer. It never blocks an application: names need not be unique.
 * - same_name: near-identical names in the same state.
 * - similar_name_nearby: partly matching names within 500 m.
 */
export function findDuplicates(
  subject: { name: string; state: string; location: GeoPoint | null },
  candidates: readonly DuplicateCandidate[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const candidate of candidates) {
    const similarity = nameSimilarity(subject.name, candidate.name);
    const distance =
      subject.location && candidate.location
        ? distanceMetres(subject.location, candidate.location)
        : null;
    const sameState = candidate.state?.trim().toLowerCase() === subject.state.trim().toLowerCase();
    if (similarity >= 0.8 && sameState) {
      matches.push({
        kind: candidate.kind,
        id: candidate.id,
        name: candidate.name,
        reason: 'same_name',
        distanceMetres: distance,
      });
    } else if (similarity >= 0.3 && distance !== null && distance <= DUPLICATE_RADIUS_METRES) {
      matches.push({
        kind: candidate.kind,
        id: candidate.id,
        name: candidate.name,
        reason: 'similar_name_nearby',
        distanceMetres: distance,
      });
    }
  }
  return matches;
}
