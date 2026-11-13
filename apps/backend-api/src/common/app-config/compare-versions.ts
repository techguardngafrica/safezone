/** Compares two x.y.z versions. Returns -1, 0 or 1. Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const x = pa.at(i) ?? 0;
    const y = pb.at(i) ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
