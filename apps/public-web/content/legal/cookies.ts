import type { LegalDocument } from '../types';

/**
 * DRAFT for legal review. Accurate as built: the web apps set one essential cookie (the refresh token,
 * httpOnly, path /v1/auth, ADR-0007) and no analytics or advertising cookies.
 */
export const cookies: LegalDocument = {
  slug: 'cookies',
  title: 'Cookie Policy',
  description: 'The cookies Safezone websites use and why.',
  sections: [
    {
      heading: 'What we use',
      paragraphs: [
        'Safezone websites use only cookies that are needed for the service to work. When you sign in to a Safezone website, one secure cookie keeps you signed in. It cannot be read by scripts on the page, is only sent to our sign-in service, and is removed when you sign out or it expires.',
        'This public website does not use analytics or advertising cookies.',
      ],
    },
    {
      heading: 'Your choices',
      paragraphs: [
        'You can block or delete cookies in your browser. If you block the sign-in cookie, you will not stay signed in to Safezone websites.',
        'If we ever add optional cookies, we will ask for your consent first and update this page.',
      ],
    },
  ],
};
