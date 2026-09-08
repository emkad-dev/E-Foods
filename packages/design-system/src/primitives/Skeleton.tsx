import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { surface } from '../tokens/color';
import { radius, type RadiusToken } from '../tokens/radius';
import { space } from '../tokens/space';

export type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: RadiusToken;
  style?: StyleProp<ViewStyle>;
};

/**
 * Consolidates the two loading implementations that existed per app (a 3.2KB Skeleton
 * plus an 18.6KB LoadingSkeleton of bespoke per-screen layouts). Screens compose the
 * shapes below instead of hand-writing a skeleton each time.
 *
 * Unlike the previous version this honours the OS reduce-motion setting — a pulsing
 * placeholder is exactly the kind of animation that setting exists to suppress.
 */
export function Skeleton({ width = '100%', height = 14, radius: r = 'sm', style }: SkeletonProps) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.7);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, { borderRadius: radius[r], height, width, opacity: pulse }, style]}
    />
  );
}

/** Wraps a screen's skeleton content and announces a single loading state. */
export function SkeletonScreen({ children }: { children: ReactNode }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={styles.screen}
    >
      {children}
    </View>
  );
}

export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={48} height={48} radius="pill" />
      <View style={styles.rowText}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="45%" height={12} style={styles.gapSm} />
      </View>
    </View>
  );
}

export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton height={140} radius="lg" />
      <Skeleton width="60%" height={16} style={styles.gapMd} />
      <Skeleton width="40%" height={12} style={styles.gapSm} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: surface.muted,
  },
  screen: {
    backgroundColor: surface.canvas,
    flex: 1,
    paddingHorizontal: space.lg,
    paddingTop: space['2xl'],
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: space.xl,
  },
  rowText: {
    flex: 1,
    marginLeft: space.md,
  },
  card: {
    marginBottom: space['2xl'],
  },
  gapSm: {
    marginTop: space.sm,
  },
  gapMd: {
    marginTop: space.md,
  },
});
