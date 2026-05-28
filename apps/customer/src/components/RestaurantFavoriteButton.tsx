import { FontAwesome } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, StyleProp, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { useFavorites } from '../contexts/FavoritesContext';
import { customerTheme } from '../theme/palette';

type RestaurantFavoriteButtonProps = {
  restaurantId: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export default function RestaurantFavoriteButton({
  restaurantId,
  size = 17,
  style,
}: RestaurantFavoriteButtonProps) {
  const { isFavoriteRestaurant, toggleFavorite } = useFavorites();
  const [saving, setSaving] = useState(false);
  const isFavorite = isFavoriteRestaurant(restaurantId);

  const handlePress = async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    try {
      await toggleFavorite(restaurantId, !isFavorite);
    } catch (error: any) {
      Alert.alert('Favorite failed', error.message ?? 'Unable to update favorites right now.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <TouchableOpacity
      accessibilityLabel={isFavorite ? 'Remove favorite' : 'Add favorite'}
      activeOpacity={0.82}
      disabled={saving}
      onPress={handlePress}
      style={[styles.button, isFavorite ? styles.buttonActive : null, saving ? styles.buttonSaving : null, style]}
    >
      <FontAwesome
        name={isFavorite ? 'heart' : 'heart-o'}
        size={size}
        color={isFavorite ? '#ffffff' : customerTheme.accentStrong}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  buttonActive: {
    backgroundColor: customerTheme.accentStrong,
  },
  buttonSaving: {
    opacity: 0.62,
  },
});
