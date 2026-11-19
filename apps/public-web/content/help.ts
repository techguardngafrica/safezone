/** Help centre articles (public-web.md §3 /help), grouped by who they are for. Facts only, no promises. */
export interface HelpArticle {
  id: string;
  question: string;
  answer: string[];
}

export interface HelpGroup {
  id: 'residents' | 'managers' | 'guards';
  title: string;
  articles: HelpArticle[];
}

export const helpGroups: HelpGroup[] = [
  {
    id: 'residents',
    title: 'For residents',
    articles: [
      {
        id: 'join',
        question: 'How do I join my estate?',
        answer: [
          'Install the Safezone Resident app and sign in with your phone number. Enter the join code your estate manager gave you, choose your unit and send the request.',
          'Your estate approves the request. For a rented unit, the owner may be asked to approve first.',
        ],
      },
      {
        id: 'passes',
        question: 'How do visitor passes work?',
        answer: [
          'In the Visitors tab, create a pass for your guest. They get a link with a QR code and a 6-digit PIN. Security checks the pass at the gate, even when the gate phone is offline.',
          'You can cancel a pass at any time. A cancelled pass is refused at the gate.',
        ],
      },
      {
        id: 'walkin',
        question: 'Someone arrived without a pass. What happens?',
        answer: [
          'The guard sends you a request in the app. You have a few minutes to let them in or turn them away. If you do not answer, the guard will contact you another way or refuse entry.',
        ],
      },
      {
        id: 'sos',
        question: 'What happens when I press SOS?',
        answer: [
          'After a short countdown, your estate’s security team and managers are alerted with your unit. Your location is shared only while the alert is active. If you have no internet, the app offers to send the alert by SMS.',
          'SOS reaches your estate team, not the police or ambulance. In a life-threatening emergency also call 112.',
        ],
      },
      {
        id: 'pay',
        question: 'How do I pay estate charges?',
        answer: [
          'Open the Pay tab to see your bills and pay by card or bank transfer. Payments go directly to your estate’s account. A payment shows as paid only after the payment provider confirms it.',
        ],
      },
    ],
  },
  {
    id: 'managers',
    title: 'For estate managers',
    articles: [
      {
        id: 'register',
        question: 'How does an estate start using Safezone?',
        answer: [
          'Apply online with your estate’s details. Techguard reviews the application, then your workspace opens and you complete a short setup: gates, units and the people who manage the estate.',
          'If you prefer, ask us to set it up with you through the contact page.',
        ],
      },
      {
        id: 'cost',
        question: 'What does it cost?',
        answer: ['Core estate features are free for every estate.'],
      },
      {
        id: 'money',
        question: 'Does Safezone hold our estate’s money?',
        answer: [
          'No. Residents’ payments for estate charges settle directly to the estate’s account through the payment provider.',
        ],
      },
      {
        id: 'gate-phone',
        question: 'How do we set up a phone at the gate?',
        answer: [
          'A security supervisor signs in on the gate phone in the Safezone Security app and registers it to a gate. Guards then sign in with their own 6-digit PIN. A lost phone can be deregistered from the Gate devices page in the management web app, which signs everyone out of it.',
        ],
      },
    ],
  },
  {
    id: 'guards',
    title: 'For security officers',
    articles: [
      {
        id: 'pin',
        question: 'How do I get my gate PIN?',
        answer: [
          'Sign in once with your phone number in the Safezone Security app, open Gate settings and choose Set my gate PIN. If your PIN is locked, ask your supervisor to reset it.',
        ],
      },
      {
        id: 'offline',
        question: 'What if the gate phone has no internet?',
        answer: [
          'Passes are still checked on the phone and entries are saved, then sent when the connection returns. Walk-in requests need a connection, so call the host instead.',
        ],
      },
    ],
  },
];
