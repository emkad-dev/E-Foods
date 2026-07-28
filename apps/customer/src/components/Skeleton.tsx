import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { customerTheme } from '../theme/palette';

type SkeletonProps = {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width = '100%', height = 14, radius = 8, style }: SkeletonProps) {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
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
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { borderRadius: radius, height, opacity: pulse, width } as StyleProp<ViewStyle>,
        style,
      ]}
    />
  );
}

export function SkeletonScreen({ children }: { children: React.ReactNode }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading" style={styles.screen}>
      {children}
    </View>
  );
}

export function SkeletonListRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={48} height={48} radius={24} />
      <View style={styles.rowText}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="45%" height={12} style={styles.rowTextGap} />
      </View>
    </View>
  );
}

export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton height={140} radius={14} />
      <Skeleton width="60%" height={16} style={styles.cardTitle} />
      <Skeleton width="40%" height={12} style={styles.cardMeta} />
    </View>
  );
}

export function SkeletonDetail() {
  return (
    <View>
      <Skeleton height={180} radius={16} />
      <Skeleton width="55%" height={20} style={styles.detailTitle} />
      <Skeleton width="35%" height={13} style={styles.detailMeta} />
      <SkeletonListRow />
      <SkeletonListRow />
      <SkeletonListRow />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: customerTheme.surfaceMuted,
  },
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 18,
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
  },
  rowTextGap: {
    marginTop: 8,
  },
  card: {
    marginBottom: 22,
  },
  cardTitle: {
    marginTop: 12,
  },
  cardMeta: {
    marginTop: 8,
  },
  detailTitle: {
    marginTop: 18,
  },
  detailMeta: {
    marginBottom: 24,
    marginTop: 10,
  },
});
