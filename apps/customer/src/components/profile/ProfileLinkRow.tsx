import type { ComponentProps } from 'react';
import { FontAwesome } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { MIN_TAP_TARGET, Text, border, radius, space, surface } from '@feasty/design-system';
import { customerTheme } from '../../theme/palette';

type ProfileLinkRowProps = {
  icon: ComponentProps<typeof FontAwesome>['name'];
  label: string;
  onPress: () => void;
};

/**
 * A row that NAVIGATES, and only navigates.
 *
 * The chevron is the contract: every row built from this component pushes a
 * route. The screen this replaced mixed chevron rows, read-only value rows and
 * two inline save forms into one card, so the chevron stopped meaning anything.
 * Editing now lives on /profile/edit; nothing here mutates.
 */
export default function ProfileLinkRow({ icon, label, onPress }: ProfileLinkRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.iconWrap}>
        <FontAwesome color={customerTheme.text} name={icon} size={16} />
      </View>
      <Text variant="bodyStrong" numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      <FontAwesome color={customerTheme.textSoft} name="angle-right" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    // On every row, including the first: the first row's divider separates it
    // from the group title above it, which is how the rest of this app's grouped
    // cards read.
    borderTopColor: border.subtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: space.md,
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pressed: {
    backgroundColor: surface.muted,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: surface.strong,
    borderRadius: radius.md,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
});
