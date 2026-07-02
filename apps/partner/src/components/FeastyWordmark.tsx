import { StyleSheet, Text } from 'react-native';
import { partnerTheme } from '../theme/palette';

export default function FeastyWordmark({ size = 28 }: { size?: number }) {
  return (
    <Text style={[styles.wordmark, { fontSize: size }]}>
      <Text style={styles.green}>FEAST</Text>
      <Text style={styles.orange}>Y</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    fontStyle: 'italic',
    fontWeight: '900',
    letterSpacing: -1,
    textTransform: 'uppercase',
  },
  green: {
    color: partnerTheme.brandGreen,
  },
  orange: {
    color: partnerTheme.brandOrange,
  },
});
