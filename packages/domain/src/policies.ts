export type PolicyApp = 'customer' | 'partner' | 'dispatch';

export type PolicyAcceptancePayload = {
  accepted: boolean;
  app: PolicyApp;
  privacyVersion: string;
  source: string;
  termsVersion: string;
};

export type PolicySection = {
  bullets: string[];
  title: string;
};

export const CURRENT_TERMS_VERSION = '2026-05-31-v1';
export const CURRENT_PRIVACY_VERSION = '2026-05-31-v1';

export const buildPolicyAcceptancePayload = (app: PolicyApp, source: string): PolicyAcceptancePayload => ({
  accepted: true,
  app,
  privacyVersion: CURRENT_PRIVACY_VERSION,
  source,
  termsVersion: CURRENT_TERMS_VERSION,
});

const sharedTerms: PolicySection[] = [
  {
    title: 'Account responsibility',
    bullets: [
      'Use accurate signup details and keep your account secure.',
      'Do not share accounts, impersonate others, or misuse platform tools.',
      'FEASTy may restrict accounts that create safety, fraud, or abuse risks.',
    ],
  },
  {
    title: 'Orders and payments',
    bullets: [
      'Prices, fees, delivery timing, and availability can change before checkout is confirmed.',
      'Online payments must be confirmed before prepaid orders move forward.',
      'Refunds, cancellations, and disputes are reviewed using order status and platform records.',
    ],
  },
  {
    title: 'Safety and communication',
    bullets: [
      'Use in-app contact details only for active orders or delivery support.',
      'Do not harass customers, riders, restaurants, or operations staff.',
      'Report unsafe, suspicious, or incorrect activity quickly.',
    ],
  },
];

const sharedPrivacy: PolicySection[] = [
  {
    title: 'Data protection',
    bullets: [
      'We collect only the account, order, payment, and operational data needed to run the service.',
      'Sensitive operational access is limited by role and protected by authenticated backend checks.',
      'We keep records needed for safety, fraud prevention, support, accounting, and legal compliance.',
    ],
  },
  {
    title: 'Location and device data',
    bullets: [
      'Location data is used for delivery, dispatch assignment, service coverage, and support.',
      'Push tokens and device session data help deliver notifications and protect account access.',
      'You can deny optional location permissions, but some delivery features may be less accurate.',
    ],
  },
  {
    title: 'Policy updates',
    bullets: [
      'We may update these policies as the platform changes.',
      'Important changes can require accepting a new policy version before continuing.',
      'This in-app policy text is a practical platform notice and should be legally reviewed before public launch.',
    ],
  },
];

export const policyCopy: Record<PolicyApp, { privacy: PolicySection[]; terms: PolicySection[] }> = {
  customer: {
    terms: [
      ...sharedTerms,
      {
        title: 'Customer use',
        bullets: [
          'Place orders with correct contact details and delivery instructions.',
          'Use rider contact buttons only for the assigned active delivery.',
          'Do not make false orders, false disputes, or unsafe delivery requests.',
        ],
      },
    ],
    privacy: [
      ...sharedPrivacy,
      {
        title: 'Customer data',
        bullets: [
          'Restaurants and assigned riders see only the order details needed to prepare or deliver your order.',
          'Payment references and order records are used to verify checkout and support disputes.',
        ],
      },
    ],
  },
  partner: {
    terms: [
      ...sharedTerms,
      {
        title: 'Restaurant responsibility',
        bullets: [
          'Keep restaurant profile, menu, prices, availability, and preparation status accurate.',
          'Only upload images and content you own or have permission to use.',
          'Prepare accepted orders safely and update order status on time.',
        ],
      },
    ],
    privacy: [
      ...sharedPrivacy,
      {
        title: 'Partner data',
        bullets: [
          'Restaurant profile data, logos, menus, and order performance are used for customer discovery and operations.',
          'Admin reviewers can access application and restaurant records for approval and support.',
        ],
      },
    ],
  },
  dispatch: {
    terms: [
      ...sharedTerms,
      {
        title: 'Dispatch responsibility',
        bullets: [
          'Keep rider profile, phone number, vehicle, and active delivery status accurate.',
          'Use customer phone access only for assigned deliveries.',
          'Handle food safely and follow lawful road and delivery practices.',
        ],
      },
    ],
    privacy: [
      ...sharedPrivacy,
      {
        title: 'Dispatch data',
        bullets: [
          'Delivery assignments, location, contact, and weekly earnings records are used for operations and support.',
          'Customer contact details are shown only when needed for assigned delivery work.',
        ],
      },
    ],
  },
};
