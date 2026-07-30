import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { border, surface } from '../tokens/color';
import { radius, type RadiusToken } from '../tokens/radius';
import { space, type SpaceToken } from '../tokens/space';
import type { ElevationToken } from '../tokens/elevation';
import { elevation } from './elevation';

export type CardProps = {
  children: ReactNode;
  elevation?: ElevationToken;
  radius?: RadiusToken;
  padding?: SpaceToken | 'none';
  /** Adds press feedback and a button role when provided. */
  onPress?: () => void;
  /** Hairline border instead of a shadow — for dense lists where shadows get noisy. */
  bordered?: boolean;
  style?: ViewStyle;
};

export function Card({
  children,
  elevation: elevationToken = 'sm',
  radius: radiusToken = 'lg',
  padding = 'lg',
  onPress,
  bordered = false,
  style,
}: CardProps) {
  const base: ViewStyle = {
    backgroundColor: surface.default,
    borderRadius: radius[radiusToken],
    padding: padding === 'none' ? 0 : space[padding],
    ...(bordered
      ? { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: border.subtle }
      : elevation[elevationToken]),
  };

  if (!onPress) {
    return <View style={[base, style]}>{children}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [base, pressed ? styles.pressed : null, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.995 }],
  },
});
