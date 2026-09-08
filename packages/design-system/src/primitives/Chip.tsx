import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { border, brand, surface } from '../tokens/color';
import { MIN_TAP_TARGET, space } from '../tokens/space';
import { radius } from '../tokens/radius';
import { Text } from './Text';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: ReactNode;
  disabled?: boolean;
};

/**
 * Selectable filter pill — the category row on the customer home feed.
 *
 * Selected state uses the brand green fill with `onBrand` text (5.13:1); unselected
 * uses a bordered surface. Note it does not use accent orange, which cannot carry text.
 */
export function Chip({ label, selected = false, onPress, icon, disabled = false }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.root,
        selected ? styles.selected : styles.unselected,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {icon}
      <Text variant="callout" tone={selected ? 'onBrand' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  selected: {
    backgroundColor: brand.primary,
  },
  unselected: {
    backgroundColor: surface.default,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: border.default,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.45,
  },
});
