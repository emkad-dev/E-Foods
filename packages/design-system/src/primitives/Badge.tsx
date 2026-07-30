import { StyleSheet, View } from 'react-native';

import { brand, status, surface, text as textColor } from '../tokens/color';
import { space } from '../tokens/space';
import { radius } from '../tokens/radius';
import { Text, type TextTone } from './Text';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
};

/**
 * Small status pill — order state, "New", promo flags.
 *
 * The `warning` and `accent` tones deliberately use a soft fill with dark text rather
 * than orange text, because orange cannot clear AA as a text color. `accent` uses the
 * full-strength orange fill paired with `onAccent` ink (6.77:1) for genuine emphasis.
 */
const TONES: Record<BadgeTone, { background: string; tone: TextTone }> = {
  neutral: { background: surface.strong, tone: 'secondary' },
  success: { background: status.successSoft, tone: 'primary' },
  warning: { background: status.warningSoft, tone: 'primary' },
  danger: { background: status.dangerSoft, tone: 'primary' },
  accent: { background: brand.accent, tone: 'onAccent' },
};

export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const spec = TONES[tone];

  return (
    <View style={[styles.root, { backgroundColor: spec.background }]}>
      <Text variant="caption" tone={spec.tone}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
});

/** Exported for the a11y test — every badge tone must be a legal fill/text pairing. */
export const BADGE_TONE_PAIRS = Object.entries(TONES).map(([name, spec]) => ({
  name: `badge.${name}`,
  bg: spec.background,
  fg: textColor[spec.tone],
}));
