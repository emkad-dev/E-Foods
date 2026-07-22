import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { policyCopy } from '../../../../packages/domain/src';
import { useAuth } from '../../src/contexts/AuthContext';
import { customerTheme } from '../../src/theme/palette';

function PolicyAccordion({
  title,
  expanded,
  onToggle,
  sections,
  linkHref,
  linkLabel,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  sections: { title: string; bullets: string[] }[];
  linkHref: '/terms' | '/privacy';
  linkLabel: string;
}) {
  return (
    <>
      <Pressable style={[styles.sectionButton, expanded ? styles.sectionButtonActive : null]} onPress={onToggle}>
        <Text style={styles.sectionButtonText}>{title}</Text>
        <Text style={styles.sectionButtonChevron}>{expanded ? '-' : '+'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.expandedCard}>
          {sections.map((section) => (
            <View key={section.title} style={styles.policySection}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.bullets.map((bullet) => (
                <Text key={bullet} style={styles.bullet}>
                  - {bullet}
                </Text>
              ))}
            </View>
          ))}
          <Link href={linkHref} style={styles.fullLink}>
            {linkLabel}
          </Link>
        </View>
      ) : null}
    </>
  );
}

export default function AcceptPolicyScreen() {
  const { acceptCurrentPolicies, policyLoading, user } = useAuth();
  const [expandedSection, setExpandedSection] = useState<'terms' | 'privacy' | null>('terms');
  const policySections = useMemo(
    () => ({
      terms: policyCopy.customer.terms,
      privacy: policyCopy.customer.privacy,
    }),
    []
  );

  const handleAccept = async () => {
    try {
      await acceptCurrentPolicies('customer_policy_gate');
      router.replace((user?.phoneNumber ? '/home' : '/complete-profile') as never);
    } catch (error: any) {
      Alert.alert('Policy acceptance failed', error.message ?? 'Unable to save your acceptance right now.');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>FEASTY</Text>
        <Text style={styles.title}>Accept Terms</Text>
        <Text style={styles.copy}>
          Review and accept the current Terms and Privacy Policy before using the customer app.
        </Text>
        <View style={styles.sectionList}>
          <PolicyAccordion
            title="Terms"
            expanded={expandedSection === 'terms'}
            onToggle={() => setExpandedSection((current) => (current === 'terms' ? null : 'terms'))}
            sections={policySections.terms}
            linkHref="/terms"
            linkLabel="Open full Terms page"
          />
          <PolicyAccordion
            title="Privacy"
            expanded={expandedSection === 'privacy'}
            onToggle={() => setExpandedSection((current) => (current === 'privacy' ? null : 'privacy'))}
            sections={policySections.privacy}
            linkHref="/privacy"
            linkLabel="Open full Privacy page"
          />
        </View>
        <Pressable style={styles.button} onPress={handleAccept} disabled={policyLoading}>
          <Text style={styles.buttonText}>{policyLoading ? 'Saving...' : 'I agree'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.background, flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
  },
  eyebrow: { color: customerTheme.brandGreen, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  title: { color: customerTheme.text, fontSize: 28, fontWeight: '900', marginTop: 8 },
  copy: { color: customerTheme.textMuted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  sectionList: { gap: 10, marginTop: 16 },
  sectionButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionButtonActive: {
    borderColor: customerTheme.accent,
    backgroundColor: '#f7fcf6',
  },
  sectionButtonText: { color: customerTheme.text, fontSize: 15, fontWeight: '800' },
  sectionButtonChevron: { color: customerTheme.brandGreen, fontSize: 18, fontWeight: '900' },
  expandedCard: {
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  policySection: { marginTop: 8 },
  sectionTitle: { color: customerTheme.text, fontSize: 15, fontWeight: '800', marginBottom: 6 },
  bullet: { color: customerTheme.textMuted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  fullLink: { color: customerTheme.link, fontSize: 14, fontWeight: '800', marginTop: 12 },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 14,
    marginTop: 18,
    paddingVertical: 15,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
