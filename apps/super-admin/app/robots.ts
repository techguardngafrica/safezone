import type { MetadataRoute } from 'next';

/** Super Admin is strictly internal and must never be crawled or indexed (AGENTS.md §7.2). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
