/**
 * Long-form public content (public-web.md §9: "content managed in the repo"). Kept as typed data, not MDX,
 * so no new build dependency is needed. English only for now, like the rest of the product.
 */
export interface ContentSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalDocument {
  slug: 'terms' | 'privacy' | 'cookies' | 'ad-policy';
  title: string;
  description: string;
  sections: ContentSection[];
}
