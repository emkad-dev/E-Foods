import { FontAwesome } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { MIN_TAP_TARGET } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';

type CustomerHeaderBackButtonProps = {
  href: Href;
  label?: string;
};

export default function CustomerHeaderBackButton({
  href,
  label = 'Back',
}: CustomerHeaderBackButtonProps) {
  const router = useRouter();

  return (
    <TouchableOpacity style={styles.button} onPress={() => router.replace(href)}>
      <FontAwesome name="angle-left" size={18} color={customerTheme.text} />
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    flexDirection: 'row',
    marginLeft: 8,
    // An 18pt icon and a 14pt label with 8pt of padding measured ~34-37pt tall,
    // under the 44pt minimum -- on the only control that leaves five screens.
    // The header is already taller than 44, so this cannot shift the bar.
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  label: {
    color: customerTheme.text,
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 6,
  },
});
