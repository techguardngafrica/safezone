import type { LegalDocument } from '../types';

/**
 * DRAFT for legal review. Written from what the product actually does (AGENTS.md §6, docs/architecture).
 * Company details come from src/site.ts. Do not publish as final without review against NDPA 2023 and
 * GAID 2025.
 */
export const privacy: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy Policy',
  description:
    'What personal data Safezone collects, why, who it is shared with, how long it is kept and your rights under the Nigeria Data Protection Act 2023.',
  sections: [
    {
      heading: 'Who we are',
      paragraphs: [
        'Safezone is an estate management and security platform operated by Techguard. It is used by residential estates, their residents, staff and security teams.',
        'For your account and for advertising, Techguard decides how your data is used. For records your estate keeps about you (your unit, household, visitors, bills and security records), your estate decides how that data is used and Techguard processes it on the estate’s behalf under a data processing agreement.',
      ],
    },
    {
      heading: 'What we collect',
      items: [
        'Account details: your phone number (verified by SMS code), name, and optionally an email address and photo.',
        'Estate records: the estates you belong to, your unit, household members, domestic staff and vehicles you register.',
        'Visitor details you enter when you invite someone: their name and, if you add them, phone number and vehicle plate.',
        'Gate records: entries and exits of visitors and vehicles, recorded by estate security.',
        'Emergency data: SOS alerts you raise and the emergency contacts you add. Your location is collected only while an SOS alert is active.',
        'Payments: amounts, references and status of payments you make. Card details are entered on the payment provider’s page and never reach Safezone.',
        'Requests and content: maintenance requests, incident reports, photos you upload, community messages and documents.',
        'Technical data: device type, app version, push notification token, IP address and sign-in history, used to keep your account secure.',
      ],
    },
    {
      heading: 'Why we use it',
      items: [
        'To run your estate’s services: visitor passes, gate checks, SOS response, billing, maintenance, bookings and announcements.',
        'To keep accounts secure: sign-in codes, two-step verification for staff, detecting misuse.',
        'To send you notifications you need, by push, SMS or email.',
        'To meet legal and accounting duties, for example keeping financial and audit records.',
      ],
      paragraphs: [
        'We do not sell personal data. Advertisers never receive personal data, contact lists or estate records; they only see totals across large groups of users.',
      ],
    },
    {
      heading: 'Who can see it',
      items: [
        'Your estate’s management and staff, limited by their role. Security guards see only what they need at the gate: a visitor’s name, the unit and the vehicle.',
        'Other residents only see what you share in community channels and messages.',
        'Service providers that help us run Safezone: hosting, SMS delivery, push notifications (Expo), email (Zoho) and payment processing (Paystack, Flutterwave). They act on our instructions.',
        'Authorities, when the law requires it.',
      ],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        'We keep data while your account or your estate membership is active and for as long as the law or your estate’s records require after that. Financial and audit records are kept for at least six years. Security and emergency records may be kept longer where they are needed for an investigation. Other data is deleted or anonymised under a retention schedule.',
      ],
    },
    {
      heading: 'Your rights',
      items: [
        'Ask for a copy of your data.',
        'Ask us to correct data that is wrong.',
        'Ask us to delete your data, where we are not required to keep it.',
        'Object to or restrict some uses, and withdraw consent you gave.',
        'Complain to the Nigeria Data Protection Commission.',
      ],
      paragraphs: [
        'We respond to requests within 30 days. Requests about estate records may be passed to your estate, which decides on them.',
      ],
    },
    {
      heading: 'Security',
      paragraphs: [
        'Data is encrypted in transit, access is limited by role and every sensitive action is recorded in an audit log. Staff accounts use two-step verification. We report personal data breaches as the law requires.',
      ],
    },
    {
      heading: 'Changes',
      paragraphs: [
        'We will update this page when our practices change and tell you in the app about important changes.',
      ],
    },
  ],
};
