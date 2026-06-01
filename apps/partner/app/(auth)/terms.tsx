import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { policyCopy } from '../../../../packages/domain/src';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerTermsScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Terms</Text>
      <Text style={styles.note}>Platform policy draft. Legal review is required before public launch.</Text>
      {policyCopy.partner.terms.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.bullets.map((bullet) => (
            <Text key={bullet} style={styles.bullet}>• {bullet}</Text>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: partnerTheme.background, flex: 1 },
  content: { padding: 20, paddingBottom: 36 },
  title: { color: partnerTheme.text, fontSize: 28, fontWeight: '800' },
  note: { color: partnerTheme.textMuted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  section: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  sectionTitle: { color: partnerTheme.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  bullet: { color: partnerTheme.textMuted, fontSize: 14, lineHeight: 21, marginTop: 4 },
});
