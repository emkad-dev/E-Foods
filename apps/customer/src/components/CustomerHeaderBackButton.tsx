import { FontAwesome } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
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
