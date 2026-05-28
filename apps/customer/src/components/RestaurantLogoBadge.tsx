import { Image, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { customerTheme } from '../theme/palette';

type RestaurantLogoBadgeProps = {
  logoImage?: string | null;
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export default function RestaurantLogoBadge({ logoImage, name, size = 46, style }: RestaurantLogoBadgeProps) {
  const initial = name.trim().slice(0, 1).toUpperCase() || 'R';

  return (
    <View style={[styles.badge, { borderRadius: size / 2, height: size, width: size }, style]}>
      {logoImage ? (
        <Image source={{ uri: logoImage }} style={styles.image} />
      ) : (
        <Text style={[styles.initial, { fontSize: Math.max(14, size * 0.36) }]}>{initial}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: 'rgba(255,255,255,0.78)',
    borderWidth: 2,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  initial: {
    color: customerTheme.accentStrong,
    fontWeight: '800',
  },
});
