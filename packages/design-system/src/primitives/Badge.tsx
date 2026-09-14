import { StyleSheet, View } from 'react-native';

import { space } from '../tokens/space';
import { radius } from '../tokens/radius';
import { Text } from './Text';
import { BADGE_TONES, type BadgeTone } from './badgeTones';

export type { BadgeTone };

/**
 * Re-exported so the public entry point (`primitives/index.ts`) is unchanged by
 * the move. The table itself lives in `./badgeTones`, which is React-free so the
 * a11y guard in `tokens/color.test.ts` can actually load and assert it.
 */
export { BADGE_TONE_PAIRS } from './badgeTones';

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
};

export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const spec = BADGE_TONES[tone];

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
