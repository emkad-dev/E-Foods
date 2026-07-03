import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { customerTheme } from '../theme/palette';

export default function AuthLegalFooter() {
  return (
    <View style={styles.footer}>
      <Text style={styles.text}>
        <Link href="/terms" style={styles.link}>
          Terms
        </Link>{' '}
        ·{' '}
        <Link href="/privacy" style={styles.link}>
          Privacy
        </Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: 'center',
    marginTop: 20,
  },
  text: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  link: {
    color: customerTheme.link,
    fontWeight: '800',
  },
});
