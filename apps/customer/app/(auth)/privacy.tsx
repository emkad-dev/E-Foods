import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { customerTheme } from '../../src/theme/palette';

const privacySections = [
  {
    title: 'Who We Are',
    paragraphs: ['FEASTY is a food delivery service operated by FEASTY.'],
  },
  {
    title: 'Scope',
    paragraphs: ['Our service is currently intended for users in Nigeria only.'],
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
    note: 'We do not sell your personal information.',
  },
  {
    title: 'Data Retention',
    paragraphs: [
      'We keep personal information only as long as needed for account management, order fulfillment, legal obligations, dispute resolution, and support.',
    ],
  },
  {
    title: 'Your Choices and Rights',
    bullets: [
      'Access and update your account information in the app',
      'Request deletion of your account in the app',
      'Contact us for help with account or privacy issues',
    ],
    note:
      'If you request deletion, we will remove or deactivate your account subject to legal, security, and operational retention needs.',
  },
  {
    title: "Children's Privacy",
    paragraphs: ['FEASTY is not intended for children under 13.'],
  },
  {
    title: 'Changes to This Policy',
    paragraphs: [
      'We may update this policy from time to time. If we make material changes, we will update the date above and publish the revised policy.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: ['For privacy questions, email feastyfooders@gmail.com.'],
  },
];

export default function CustomerPrivacyScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Legal Notice</Text>
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.note}>
          This policy explains how FEASTY collects, uses, shares, and protects personal information for users in Nigeria.
        </Text>
        <View style={styles.metaRow}>
          <MetaPill label="Last updated" value="June 23, 2026" />
          <MetaPill label="Contact" value="feastyfooders@gmail.com" />
        </View>
      </View>

      {privacySections.map((section) => (
        <Section key={section.title} title={section.title}>
          {section.paragraphs?.map((item) => (
            <Paragraph key={item}>{item}</Paragraph>
          ))}
          {section.bullets?.map((item) => (
            <Bullet key={item}>{item}</Bullet>
          ))}
          {section.note ? <Paragraph>{section.note}</Paragraph> : null}
        </Section>
      ))}
    </ScrollView>
  );
}

function Section({ title, children }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Paragraph({ children }: { children: ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

function Bullet({ children }: { children: ReactNode }) {
  return <Text style={styles.bullet}>- {children}</Text>;
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaPill}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.background, flex: 1 },
  content: { padding: 20, paddingBottom: 36 },
  hero: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
  },
  eyebrow: {
    color: customerTheme.brandGreen,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: { color: customerTheme.text, fontSize: 30, fontWeight: '800', marginTop: 8 },
  note: { color: customerTheme.textMuted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  metaPill: {
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metaLabel: { color: customerTheme.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  metaValue: { color: customerTheme.text, fontSize: 13, fontWeight: '700', marginTop: 3 },
  section: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  sectionTitle: { color: customerTheme.text, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  paragraph: { color: customerTheme.textMuted, fontSize: 14, lineHeight: 22, marginTop: 8 },
  bullet: { color: customerTheme.textMuted, fontSize: 14, lineHeight: 21, marginTop: 6 },
});
