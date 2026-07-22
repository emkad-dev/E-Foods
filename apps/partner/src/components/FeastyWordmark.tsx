import { Image, StyleSheet, Text, View } from 'react-native';
import { partnerTheme } from '../theme/palette';

export default function FEASTYWordmark({ size = 28 }: { size?: number }) {
  return (
    <View style={styles.row}>
      <Image
        source={require('../../../customer/assets/images/feasty-pizza.png')}
        style={{ height: size * 0.95, width: size * 1.05 }}
        resizeMode="contain"
      />
      <Text style={[styles.wordmark, { fontSize: size }]}>
        <Text style={styles.green}>FEAST</Text>
        <Text style={styles.orange}>Y</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
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
