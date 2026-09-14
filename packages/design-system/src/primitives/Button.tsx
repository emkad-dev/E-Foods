import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import { brand, status, surface, text as textColor, border } from '../tokens/color';
import { MIN_TAP_TARGET, space } from '../tokens/space';
import { radius } from '../tokens/radius';
import { Text, type TextTone } from './Text';
import type { TypeVariant } from '../tokens/type';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructiveQuiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  /** Rendered before the label. */
  icon?: ReactNode;
  style?: ViewStyle;
};

type VariantSpec = {
  background: string;
  backgroundPressed: string;
  tone: TextTone;
  borderColor?: string;
};

const VARIANTS: Record<ButtonVariant, VariantSpec> = {
  primary: {
    background: brand.primary,
    backgroundPressed: brand.primaryStrong,
    tone: 'onBrand',
  },
  secondary: {
    background: surface.default,
    backgroundPressed: surface.muted,
    tone: 'primary',
    borderColor: border.default,
  },
  ghost: {
    background: 'transparent',
    backgroundPressed: surface.muted,
    tone: 'primary',
  },
  destructive: {
    background: status.danger,
    /**
     * Was the literal #a83b35 sitting right here — the only place in the repo
     * that knew a legible dark red existed, which is exactly why red *text*
     * elsewhere had nothing accessible to reach for and used the fill red.
     * Same value, now named once in the token layer.
     */
    backgroundPressed: status.dangerText,
    tone: 'onBrand',
  },
  /**
   * Transparent like `ghost`, but with a `text.danger` label.
   *
   * The obvious question is why not just use `destructive`. Because a solid red
   * slab is the right weight for the confirm button *inside* a confirmation
   * dialog and the wrong weight for the control that opens one. An action a
   * person takes once, if ever — delete this account, close this restaurant —
   * must be unmistakably dangerous, but making it the heaviest element on its
   * screen puts the most irreversible control exactly where the eye lands first,
   * above whatever the screen is actually for. This keeps the danger signal and
   * drops the shout; the weight belongs in the dialog, which already has it.
   * `destructive` stays correct wherever the destructive act *is* the point of
   * the surface.
   *
   * It could not exist before `text.danger` did: the only red on offer was the
   * fill red, which fails AA as text on seven of eight light surfaces, so a
   * quiet red label was an accessibility defect by construction.
   */
  destructiveQuiet: {
    background: 'transparent',
    backgroundPressed: surface.muted,
    tone: 'danger',
  },
};

/**
 * Existing variants keep the spinner they shipped with. Only the quiet
 * destructive needs its own: a green spinner inside a red-labelled button reads,
 * mid-press, as a different button entirely.
 */
const spinnerColor = (tone: TextTone): string => {
  if (tone === 'onBrand') return textColor.onBrand;
  if (tone === 'danger') return textColor.danger;
  return brand.primary;
};

/**
 * Height is driven by MIN_TAP_TARGET so every size stays accessible — `sm` is visually
 * compact via horizontal padding and type size, never by shrinking below 44pt.
 */
const SIZES: Record<ButtonSize, { minHeight: number; paddingH: number; variant: TypeVariant }> = {
  sm: { minHeight: MIN_TAP_TARGET, paddingH: space.md, variant: 'callout' },
  md: { minHeight: 48, paddingH: space.lg, variant: 'bodyStrong' },
  lg: { minHeight: 56, paddingH: space.xl, variant: 'bodyStrong' },
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const spec = VARIANTS[variant];
  const sizing = SIZES[size];
  const isInert = Boolean(disabled) || loading;

  const base = useMemo<ViewStyle>(
    () => ({
      minHeight: sizing.minHeight,
      paddingHorizontal: sizing.paddingH,
      borderRadius: radius.md,
      borderWidth: spec.borderColor ? StyleSheet.hairlineWidth * 2 : 0,
      borderColor: spec.borderColor,
      alignSelf: fullWidth ? 'stretch' : 'flex-start',
    }),
    [sizing, spec, fullWidth],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isInert, busy: loading }}
      accessibilityLabel={label}
      disabled={isInert}
      style={({ pressed }) => [
        styles.root,
        base,
        { backgroundColor: pressed && !isInert ? spec.backgroundPressed : spec.background },
        isInert ? styles.inert : null,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor(spec.tone)} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text variant={sizing.variant} tone={isInert ? 'disabled' : spec.tone}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  inert: {
    opacity: 0.5,
  },
});
