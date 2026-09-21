import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { customerTheme } from '../theme/palette';

/**
 * Terms and Privacy, on every auth screen.
 *
 * The two links used to sit inside one sentence-shaped `Text`, which made them
 * a pair of 12pt words about 30x18 each. `Text` renders `display: inline` under
 * `react-native-web`, so `minHeight` on a link is ignored and `hitSlop` does
 * nothing at all there — vertical padding is the only thing that actually buys
 * a target on both platforms, so that is what the row uses. The middle dot is
 * its own inert `Text` rather than punctuation inside a link, so neither link's
 * tappable box now includes a character that goes nowhere.
 */
export default function AuthLegalFooter() {
  return (
    <View style={styles.footer}>
      <Link href="/terms" style={styles.link}>
        Terms
      </Link>
      <Text style={styles.separator}>·</Text>
      <Link href="/privacy" style={styles.link}>
        Privacy
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  link: {
    color: customerTheme.link,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  separator: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
});
