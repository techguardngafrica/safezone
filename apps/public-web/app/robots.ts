import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../src/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/p/',
          '/account',
          '/status',
          '/vendor/',
          '/vendor$',
          '/advertiser/',
          '/advertiser$',
        ],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
