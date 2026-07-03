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
      {
        title: 'Who We Are',
        bullets: ['FEASTy is a food delivery service operated by Feasty.'],
      },
      {
        title: 'Scope',
        bullets: ['Our service is currently intended for users in Nigeria only.'],
      },
      {
        title: 'Acceptance of These Terms',
        bullets: ['By using FEASTy, you agree to these terms. If you do not agree, do not use the service.'],
      },
      {
        title: 'Accounts',
        bullets: [
          'You are responsible for your account activity and for keeping your information accurate.',
          'You must keep your login credentials secure.',
          'You may request account deletion in the app.',
        ],
      },
      {
        title: 'Orders and Payments',
        bullets: [
          'Orders may require payment verification before they are processed.',
          'Payments are handled through Paystack.',
          'Prices, availability, and delivery times may change based on restaurant and dispatch conditions.',
        ],
      },
      {
        title: 'Cancellations and Refunds',
        bullets: [
          'You may cancel an order before it is processed by the restaurant.',
          'If an order has been delivered, we generally do not allow cancellation.',
          'If a delivered order cannot be reached or handed over, refund or reversal decisions are handled case by case through support and applicable law.',
        ],
      },
      {
        title: 'Acceptable Use',
        bullets: [
          'You agree not to misuse FEASTy, attempt fraud, abuse staff or couriers, submit false information, or interfere with the service.',
        ],
      },
      {
        title: 'Service Availability',
        bullets: [
          'We may update, suspend, or discontinue any part of the service at any time.',
          'We may also change features, routes, or access rules as needed to keep the service operating safely.',
        ],
      },
      {
        title: 'Intellectual Property',
        bullets: [
          'The FEASTy name, branding, app design, and related content belong to us or our licensors and may not be used without permission.',
        ],
      },
      {
        title: 'Limitation of Liability',
        bullets: [
          'To the fullest extent allowed by law, FEASTy is not liable for indirect, incidental, or consequential damages arising from use of the service.',
        ],
      },
      {
        title: 'Changes to These Terms',
        bullets: ['We may update these terms from time to time. The revised version will apply once published.'],
      },
      {
        title: 'Contact',
        bullets: ['For terms questions, email feastyfooders@gmail.com.'],
      },
    ],
    privacy: [
      {
        title: 'Who We Are',
        bullets: ['FEASTy is a food delivery service operated by Feasty.'],
      },
      {
        title: 'Scope',
        bullets: ['Our service is currently intended for users in Nigeria only.'],
      },
      {
        title: 'Information We Collect',
        bullets: [
          'Account information such as name, email address, phone number, and password',
          'Delivery information such as saved addresses and delivery location',
          'Order history and support requests',
          'Payment and transaction metadata handled through Paystack',
          'Device and session information needed to run the service securely',
        ],
      },
      {
        title: 'How We Use Information',
        bullets: [
          'Create and manage your account',
          'Process, fulfill, and track orders',
          'Verify payments and prevent fraud',
          'Provide customer support',
          'Send service-related notices about your account or orders',
        ],
      },
      {
        title: 'How We Share Information',
        bullets: [
          'Paystack, for payment processing',
          'Restaurants, for order preparation and fulfillment',
          'Delivery partners and dispatch users, for delivery completion',
          'Service providers that help us operate the apps and backend',
        ],
      },
      {
        title: 'Data Retention',
        bullets: [
          'We keep personal information only as long as needed for account management, order fulfillment, legal obligations, dispute resolution, and support.',
        ],
      },
      {
        title: 'Your Choices and Rights',
        bullets: [
          'Access and update your account information in the app',
          'Request deletion of your account in the app',
          'Contact us for help with account or privacy issues',
          'If you request deletion, we will remove or deactivate your account subject to legal, security, and operational retention needs.',
        ],
      },
      {
        title: "Children's Privacy",
        bullets: ['FEASTy is not intended for children under 18.'],
      },
      {
        title: 'Changes to This Policy',
        bullets: [
          'We may update this policy from time to time. If we make material changes, we will update the date above and publish the revised policy.',
        ],
      },
      {
        title: 'Contact',
        bullets: ['For privacy questions, email feastyfooders@gmail.com.'],
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
          'Pickup orders routed from customers to restaurants keep 10% of the food subtotal on completed orders.',
          'Delivery orders keep 15% of the food subtotal on completed orders.',
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
