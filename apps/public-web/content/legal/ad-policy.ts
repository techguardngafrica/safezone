import type { LegalDocument } from '../types';

/** DRAFT for legal review. Rules from docs/architecture/modules/advertising.md and AGENTS.md §6.2. */
export const adPolicy: LegalDocument = {
  slug: 'ad-policy',
  title: 'Advertising Policy',
  description:
    'Where sponsored content can and cannot appear on Safezone, what advertisers can see and which ads are not allowed.',
  sections: [
    {
      heading: 'How advertising works',
      paragraphs: [
        'Advertising on Safezone is a separate service sold by Techguard. Estates do not need to accept advertising to use Safezone, and advertising never affects access to core estate features. All advertising revenue goes to Techguard.',
        'Sponsored content is always labelled as sponsored.',
      ],
    },
    {
      heading: 'Where ads never appear',
      items: [
        'SOS and emergency screens.',
        'Visitor pass and visitor approval screens.',
        'Gate and security workflows, and the whole Security App.',
        'Payment confirmation screens.',
        'Onboarding and sign-up.',
        'Private messages.',
      ],
    },
    {
      heading: 'Privacy',
      paragraphs: [
        'Advertisers never receive residents’ personal data, contact lists or estate records. Reports to advertisers are totals across large groups, never broken down to small groups or individuals. Targeting is by estate, area or context, not by personal profile, unless you have agreed to personalised ads.',
      ],
    },
    {
      heading: 'Approval',
      items: [
        'Every advertiser is verified before a campaign runs.',
        'Every campaign must carry an approval reference from the Advertising Regulatory Council of Nigeria (ARCON) where the law requires one.',
        'Every creative and destination link is reviewed before it goes live.',
      ],
    },
    {
      heading: 'Not allowed',
      items: [
        'Tobacco and vaping products.',
        'Illegal products or services, and misleading or deceptive claims.',
        'Alcohol, gambling and political advertising only where the law allows and Techguard approves.',
      ],
      paragraphs: ['Each estate can also block whole advertising categories for its residents.'],
    },
  ],
};
