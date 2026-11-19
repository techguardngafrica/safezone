import type { LegalDocument } from '../types';

/** DRAFT for legal review. Company details come from src/site.ts. */
export const terms: LegalDocument = {
  slug: 'terms',
  title: 'Terms and Conditions',
  description:
    'The terms for using Safezone: accounts, your estate’s role, payments, community content, SOS and advertising.',
  sections: [
    {
      heading: 'About these terms',
      paragraphs: [
        'These terms apply when you use Safezone, operated by Techguard, through the apps or the website. By creating an account or using the service you agree to them. If you use Safezone on behalf of an estate, you confirm you may accept them for that estate.',
      ],
    },
    {
      heading: 'Your account',
      items: [
        'You sign in with a phone number you control. Keep your phone and sign-in codes to yourself.',
        'Staff accounts must use two-step verification.',
        'Give accurate details. Your estate may decline or remove your membership.',
        'Tell us at once if you think someone else has used your account.',
      ],
    },
    {
      heading: 'Your estate',
      paragraphs: [
        'Each estate runs its own space on Safezone. The estate sets its rules, charges, approvals and security procedures, and decides who may join. Disputes about estate charges, access or rules are between you and your estate.',
        'Core estate features are free for estates. Techguard may offer optional paid features or services later; using them will need your agreement.',
      ],
    },
    {
      heading: 'Payments',
      paragraphs: [
        'Payments for estate charges go directly to your estate through licensed payment providers (Paystack or Flutterwave). Safezone records the payment and confirms it only after the provider has verified it. Refunds of estate charges are decided by your estate.',
        'Where Safezone sells a service directly, such as prepaid electricity tokens, the price, fees and refund terms are shown before you pay.',
      ],
    },
    {
      heading: 'SOS and safety features',
      paragraphs: [
        'SOS alerts notify your estate’s security team and the contacts you choose. They depend on your phone, network coverage and the people who receive them. Safezone is not an emergency service. In a life-threatening emergency, also call the public emergency number 112.',
      ],
    },
    {
      heading: 'Acceptable use',
      items: [
        'Do not harass, threaten or impersonate anyone, or post unlawful content.',
        'Do not share other people’s personal data without a lawful reason.',
        'Do not misuse visitor passes, SOS alerts or gate features.',
        'Do not try to break into, disrupt or copy the service.',
      ],
      paragraphs: [
        'Estates and Techguard may remove content and suspend accounts that break these rules. Community content is moderated by your estate first.',
      ],
    },
    {
      heading: 'Advertising',
      paragraphs: [
        'Safezone may show clearly labelled sponsored content in some places. It never appears on SOS, visitor pass, gate, payment confirmation, onboarding or private message screens, or anywhere in the Security App. See the Advertising Policy.',
      ],
    },
    {
      heading: 'Availability and liability',
      paragraphs: [
        'We work to keep Safezone available and secure but cannot promise it will always be uninterrupted or error-free. To the extent the law allows, Techguard is not liable for indirect losses or for losses caused by events outside its reasonable control. Nothing in these terms limits liability that cannot be limited by law.',
      ],
    },
    {
      heading: 'Ending your use',
      paragraphs: [
        'You can stop using Safezone and ask for your account to be deleted at any time. Some records are kept after that as the Privacy Policy explains.',
      ],
    },
    {
      heading: 'Law',
      paragraphs: ['These terms are governed by the laws of the Federal Republic of Nigeria.'],
    },
  ],
};
