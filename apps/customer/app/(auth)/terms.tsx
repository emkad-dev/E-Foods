import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { customerTheme } from '../../src/theme/palette';

const termsSections = [
  {
    title: 'Who We Are',
    paragraphs: ['FEASTY is a food delivery service operated by FEASTY.'],
  },
  {
    title: 'Scope',
    paragraphs: ['Our service is currently intended for users in Nigeria only.'],
  },
  {
    title: 'Acceptance of These Terms',
    paragraphs: ['By using FEASTY, you agree to these terms. If you do not agree, do not use the service.'],
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
    paragraphs: [
      'You agree not to misuse FEASTY, attempt fraud, abuse staff or couriers, submit false information, or interfere with the service.',
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
    paragraphs: [
      'The FEASTY name, branding, app design, and related content belong to us or our licensors and may not be used without permission.',
    ],
  },
  {
    title: 'Limitation of Liability',
    paragraphs: [
      'To the fullest extent allowed by law, FEASTY is not liable for indirect, incidental, or consequential damages arising from use of the service.',
    ],
  },
  {
    title: 'Changes to These Terms',
    paragraphs: ['We may update these terms from time to time. The revised version will apply once published.'],
  },
  {
    title: 'Contact',
    paragraphs: ['For terms questions, email feastyfooders@gmail.com.'],
  },
];

export default function CustomerTermsScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Legal Notice</Text>
        <Text style={styles.title}>Terms of Service</Text>
        <Text style={styles.note}>
          These terms govern use of FEASTY for users in Nigeria and explain how orders, payments, cancellations, and
          account responsibility work.
        </Text>
        <View style={styles.metaRow}>
          <MetaPill label="Last updated" value="June 23, 2026" />
          <MetaPill label="Contact" value="feastyfooders@gmail.com" />
        </View>
      </View>

      {termsSections.map((section) => (
        <Section key={section.title} title={section.title}>
          {section.paragraphs?.map((item) => (
            <Paragraph key={item}>{item}</Paragraph>
          ))}
          {section.bullets?.map((item) => (
            <Bullet key={item}>{item}</Bullet>
          ))}
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

function Bullet({ children }: { children: ReactNode }) {
  return <Text style={styles.bullet}>- {children}</Text>;
}

function Paragraph({ children }: { children: ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
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
