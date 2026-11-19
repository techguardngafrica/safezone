/**
 * Public site facts in one place. Values set to null are not known yet: pages say so plainly instead of
 * inventing them. Fill these in before launch (legal review: content/legal/*).
 */
export const site = {
  name: 'Safezone',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  operator: {
    /** Trading name used across the product. */
    brand: 'Techguard',
    /** Registered company name and RC number (CAC). Not confirmed yet. */
    legalName: null as string | null,
    registrationNumber: null as string | null,
    /** Registered office address. Not confirmed yet. */
    address: null as string | null,
  },
  contact: {
    support: 'support@safezone.ng',
    /** Data protection contact under NDPA 2023. Not confirmed yet. */
    privacy: null as string | null,
  },
  /** App store links, set when each app is published. */
  stores: {
    resident: { googlePlay: null as string | null, appStore: null as string | null },
    management: { googlePlay: null as string | null, appStore: null as string | null },
    security: { googlePlay: null as string | null, appStore: null as string | null },
  },
  /** Date shown on the legal drafts; replace when the reviewed versions are published. */
  legalUpdated: '2026-11-20',
} as const;

export function absoluteUrl(path: string): string {
  return new URL(path, site.url).toString();
}
