import { FontAwesome } from '@expo/vector-icons';
import { MIN_TAP_TARGET, radius, useAuthPrompt } from '@feasty/design-system';
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
  /**
   * Applied to the drawn circle, not to the pressable — see the touch-target
   * note in the component body.
   */
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_BUTTON_SIZE = 38;

// A caller can hand us a percentage or 'auto' for height/width; only a real
// number can be measured against MIN_TAP_TARGET, and anything else falls back
// to the drawn default rather than producing a NaN inset.
const toMeasuredSize = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_BUTTON_SIZE;

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

  // Every card draws this heart under the 44pt minimum -- 30pt on home's shelf,
  // 34pt on favorites, 38pt here by default -- and shrinking the DRAWN circle is
  // the calling screen's design decision, not this component's to overrule. So
  // the touch box and the drawn circle are separated: the pressable is padded
  // out to MIN_TAP_TARGET and pulled back in by the same amount in margin, which
  // leaves its laid-out footprint exactly the size the caller asked for. Nothing
  // moves on screen; the finger simply gets 44pt to land in.
  //
  // hitSlop is the usual answer to this and is the wrong one HERE: in
  // react-native-web 0.21 only the legacy Touchable mixin reads hitSlop --
  // TouchableOpacity forwards it to a View that ignores it -- so the web build,
  // which is the live customer app, would have kept its 30pt target while only
  // native grew to 44.
  const drawnStyle = StyleSheet.flatten<ViewStyle>([styles.button, style]);
  const verticalInset = Math.max(0, (MIN_TAP_TARGET - toMeasuredSize(drawnStyle.height)) / 2);
  const horizontalInset = Math.max(0, (MIN_TAP_TARGET - toMeasuredSize(drawnStyle.width)) / 2);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        accessibilityLabel={isFavorite ? 'Remove favorite' : 'Add favorite'}
        activeOpacity={0.82}
        disabled={saving}
        onPress={handlePress}
        style={{
          marginHorizontal: -horizontalInset,
          marginVertical: -verticalInset,
          paddingHorizontal: horizontalInset,
          paddingVertical: verticalInset,
        }}
      >
        {/* `style` stays LAST here, exactly where it was when this array lived
            on the pressable, so a caller's override still wins over
            buttonActive/buttonSaving and the rendered circle is unchanged. */}
        <View
          style={[styles.button, isFavorite ? styles.buttonActive : null, saving ? styles.buttonSaving : null, style]}
        >
          <FontAwesome
            name={isFavorite ? 'heart' : 'heart-o'}
            size={size}
            color={isFavorite ? customerTheme.textOnBrand : customerTheme.accentStrong}
          />
        </View>
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
    // surfaceMuted, not surface: all three call sites overrode it to exactly
    // this, and because a caller's `style` lands last it also beat
    // buttonActive -- so a FAVOURITED heart drew white on #edf3f1 at 1.12:1
    // and vanished on tap, while the un-favourited outline sat at 7.00:1.
    // Owning the resting fill here lets buttonActive win (7.87:1) and makes
    // the `surface` default, which nothing used, stop lying about the default.
    backgroundColor: customerTheme.surfaceMuted,
    borderRadius: radius.pill,
    height: DEFAULT_BUTTON_SIZE,
    justifyContent: 'center',
    width: DEFAULT_BUTTON_SIZE,
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
