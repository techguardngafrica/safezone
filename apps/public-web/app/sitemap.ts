import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../src/site';

/** Public, indexable pages only. Pass pages, accounts and the status page are left out (public-web.md §9). */
const PAGES = [
  '/',
  '/estates',
  '/register',
  '/contact',
  '/download',
  '/help',
  '/legal/terms',
  '/legal/privacy',
  '/legal/cookies',
  '/legal/ad-policy',
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path.startsWith('/legal') ? 'yearly' : 'monthly',
    priority: path === '/' ? 1 : 0.6,
  }));
}
