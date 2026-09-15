import { FontAwesome } from '@expo/vector-icons';
import { useAuthPrompt } from '@feasty/design-system';
import { usePathname } from 'expo-router';
import { useState } from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useFavorites } from '../contexts/FavoritesContext';
import { customerTheme } from '../theme/palette';
import { resolveAuthRedirectTo } from '../utils/authPrompt';

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
  const { user } = useAuth();
  const pathname = usePathname();
  const { promptForAuth, authPromptDialog } = useAuthPrompt();
  const { isFavoriteRestaurant, toggleFavorite } = useFavorites();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFavorite = isFavoriteRestaurant(restaurantId);

  const handlePress = async () => {
    if (saving) {
      return;
    }

    // Signed-out visitors browse freely and the heart stays live for them, but
    // the favorite RPC is a signed-in call: firing it here used to surface
    // backendRpc's "Your session expired. Please sign in again." — wrong for
    // someone who never signed in, and invisible on web because it was shown
    // through Alert. Prompt instead, carrying the screen the visitor is on so
    // signing in returns them to this restaurant.
    if (!user) {
      promptForAuth({
        title: 'Sign in to save favorites',
        message: 'Keep the places you love one tap away. Browsing stays open either way.',
        redirectTo: resolveAuthRedirectTo(pathname),
      });
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await toggleFavorite(restaurantId, !isFavorite);
    } catch (nextError) {
      // Inline, never Alert — Alert is a no-op on the web build, which is what
      // made this failure silent in the first place.
      setError(nextError instanceof Error ? nextError.message : 'Unable to update favorites right now.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
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
          color={isFavorite ? customerTheme.textOnBrand : customerTheme.accentStrong}
        />
      </TouchableOpacity>
      {error ? (
        <Text accessibilityLiveRegion="polite" role="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {authPromptDialog}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
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
  error: {
    color: customerTheme.dangerText,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 4,
    maxWidth: 140,
    textAlign: 'center',
  },
});
