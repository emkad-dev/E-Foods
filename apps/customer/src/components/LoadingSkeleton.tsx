import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { customerTheme } from '../theme/palette';

type LoadingSkeletonMode =
  | 'auth-login'
  | 'auth-register'
  | 'auth-recovery'
  | 'auth-onboarding'
  | 'home'
  | 'orders'
  | 'cart'
  | 'profile'
  | 'support';

type LoadingSkeletonProps = {
  mode?: LoadingSkeletonMode;
};

function SkeletonLine({
  opacity,
  style,
}: {
  opacity: Animated.AnimatedInterpolation<number>;
  style?: any;
}) {
  return <Animated.View style={[styles.skeleton, { opacity }, style]} />;
}

function SectionCard({
  children,
  compact,
}: {
  children: ReactNode;
  compact: boolean;
}) {
  return <View style={[styles.sectionCard, compact ? styles.sectionCardCompact : null]}>{children}</View>;
}

function Row({
  opacity,
  titleWidth,
  subtitleWidth,
  badgeWidth,
}: {
  opacity: Animated.AnimatedInterpolation<number>;
  titleWidth: string;
  subtitleWidth: string;
  badgeWidth?: number;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowAvatar} />
      <View style={styles.rowCopy}>
        <SkeletonLine opacity={opacity} style={[styles.rowTitle, { width: titleWidth }]} />
        <SkeletonLine opacity={opacity} style={[styles.rowSubtitle, { width: subtitleWidth }]} />
      </View>
      <SkeletonLine opacity={opacity} style={[styles.rowBadge, badgeWidth ? { width: badgeWidth } : null]} />
    </View>
  );
}

export default function LoadingSkeleton({ mode = 'home' }: LoadingSkeletonProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  const { width } = useWindowDimensions();
  const compact = width < 390;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.44, 1],
  });

  const copyLines = compact ? ['82%', '70%'] : ['88%', '74%'];

  if (mode === 'auth-login' || mode === 'auth-register' || mode === 'auth-recovery' || mode === 'auth-onboarding') {
    return (
      <View style={styles.screen}>
        <View style={[styles.authCard, compact ? styles.authCardCompact : null]}>
          <View style={styles.authHeader}>
            <View style={[styles.brandMark, compact ? styles.brandMarkCompact : null]} />
            <View style={styles.brandCopy}>
              <SkeletonLine opacity={opacity} style={[styles.eyebrow, { width: compact ? '42%' : '34%' }]} />
              <SkeletonLine opacity={opacity} style={[styles.title, { width: compact ? '72%' : '66%' }]} />
            </View>
          </View>

          <SkeletonLine opacity={opacity} style={[styles.copy, { width: copyLines[0] }]} />
          {!compact ? <SkeletonLine opacity={opacity} style={[styles.copy, { width: copyLines[1] }]} /> : null}

          {mode === 'auth-login' ? (
            <View style={styles.formStack}>
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.button} />
              <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? '54%' : '46%' }]} />
              <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? '42%' : '38%' }]} />
            </View>
          ) : null}

          {mode === 'auth-register' ? (
            <View style={styles.formStack}>
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <View style={styles.policyRow}>
                <SkeletonLine opacity={opacity} style={styles.checkbox} />
                <View style={styles.policyCopy}>
                  <SkeletonLine opacity={opacity} style={[styles.policyLine, { width: '88%' }]} />
                  <SkeletonLine opacity={opacity} style={[styles.policyLine, { width: compact ? '64%' : '58%' }]} />
                </View>
              </View>
              <SkeletonLine opacity={opacity} style={styles.button} />
            </View>
          ) : null}

          {mode === 'auth-recovery' ? (
            <View style={styles.formStack}>
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.button} />
              <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? '60%' : '48%' }]} />
            </View>
          ) : null}

          {mode === 'auth-onboarding' ? (
            <View style={styles.formStack}>
              <View style={styles.onboardingCard}>
                <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '48%' }]} />
                <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '88%' : '92%' }]} />
                <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '74%' : '84%' }]} />
              </View>
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.button} />
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  if (mode === 'orders') {
    return (
      <View style={styles.screen}>
        <View style={styles.shell}>
          <View style={styles.topRow}>
            <View style={styles.topText}>
              <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '44%' }]} />
              <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '66%' : '54%' }]} />
            </View>
            <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? 76 : 90 }]} />
          </View>

          <View style={styles.chipRow}>
            {Array.from({ length: compact ? 3 : 4 }).map((_, index) => (
              <SkeletonLine key={index} opacity={opacity} style={[styles.chip, compact ? styles.chipCompact : null]} />
            ))}
          </View>

          <View style={styles.metricsRow}>
            <SkeletonLine opacity={opacity} style={[styles.metricCard, compact ? styles.metricCardCompact : null]} />
            <SkeletonLine opacity={opacity} style={[styles.metricCard, compact ? styles.metricCardCompact : null]} />
          </View>

          <SectionCard compact={compact}>
            <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '38%' }]} />
            {Array.from({ length: compact ? 3 : 4 }).map((_, index) => (
              <Row
                key={index}
                opacity={opacity}
                titleWidth={compact ? '54%' : '62%'}
                subtitleWidth={compact ? '72%' : '84%'}
                badgeWidth={compact ? 52 : 62}
              />
            ))}
          </SectionCard>
        </View>
      </View>
    );
  }

  if (mode === 'cart') {
    return (
      <View style={styles.screen}>
        <View style={styles.shell}>
          <View style={styles.topRow}>
            <View style={styles.topText}>
              <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '34%' }]} />
              <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '72%' : '58%' }]} />
            </View>
            <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? 70 : 84 }]} />
          </View>

          <SectionCard compact={compact}>
            <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '44%' }]} />
            {Array.from({ length: compact ? 2 : 3 }).map((_, index) => (
              <Row
                key={index}
                opacity={opacity}
                titleWidth={compact ? '50%' : '58%'}
                subtitleWidth={compact ? '68%' : '80%'}
                badgeWidth={compact ? 50 : 58}
              />
            ))}
          </SectionCard>

          <View style={styles.metricsRow}>
            <SkeletonLine opacity={opacity} style={[styles.metricCard, compact ? styles.metricCardCompact : null]} />
            <SkeletonLine opacity={opacity} style={[styles.metricCard, compact ? styles.metricCardCompact : null]} />
          </View>

          <SkeletonLine opacity={opacity} style={[styles.button, { marginTop: 14 }]} />
        </View>
      </View>
    );
  }

  if (mode === 'profile') {
    return (
      <View style={styles.screen}>
        <View style={styles.shell}>
          <SectionCard compact={compact}>
            <View style={styles.profileHeader}>
              <View style={[styles.avatarLarge, compact ? styles.avatarLargeCompact : null]} />
              <View style={styles.profileCopy}>
                <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '50%' }]} />
                <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '66%' : '58%' }]} />
              </View>
            </View>
            <View style={styles.profileSection}>
              {Array.from({ length: compact ? 3 : 4 }).map((_, index) => (
                <SkeletonLine key={index} opacity={opacity} style={styles.settingRow} />
              ))}
            </View>
          </SectionCard>

          <View style={styles.metricsRow}>
            <SkeletonLine opacity={opacity} style={[styles.metricCard, compact ? styles.metricCardCompact : null]} />
            <SkeletonLine opacity={opacity} style={[styles.metricCard, compact ? styles.metricCardCompact : null]} />
          </View>
        </View>
      </View>
    );
  }

  if (mode === 'support') {
    return (
      <View style={styles.screen}>
        <View style={styles.shell}>
          <SectionCard compact={compact}>
            <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '46%' }]} />
            <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '88%' : '80%' }]} />
            <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '70%' : '64%' }]} />
            <SkeletonLine opacity={opacity} style={styles.button} />
          </SectionCard>

          <SectionCard compact={compact}>
            <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '34%' }]} />
            {Array.from({ length: compact ? 2 : 3 }).map((_, index) => (
              <Row
                key={index}
                opacity={opacity}
                titleWidth={compact ? '60%' : '66%'}
                subtitleWidth={compact ? '74%' : '84%'}
                badgeWidth={compact ? 48 : 58}
              />
            ))}
          </SectionCard>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.shell}>
        <View style={styles.topRow}>
          <View style={styles.topText}>
            <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '42%' }]} />
            <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '72%' : '60%' }]} />
          </View>
          <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? 72 : 88 }]} />
        </View>

        <SectionCard compact={compact}>
          <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '54%' }]} />
          <View style={styles.searchBar}>
            <SkeletonLine opacity={opacity} style={[styles.searchIcon, compact ? styles.searchIconCompact : null]} />
            <SkeletonLine opacity={opacity} style={[styles.searchCopy, { width: compact ? '64%' : '56%' }]} />
          </View>
          <View style={styles.featureRow}>
            <SkeletonLine opacity={opacity} style={[styles.featureCard, compact ? styles.featureCardCompact : null]} />
            <SkeletonLine opacity={opacity} style={[styles.featureCard, compact ? styles.featureCardCompact : null]} />
          </View>
        </SectionCard>

        <View style={styles.metricsRow}>
          <SkeletonLine opacity={opacity} style={[styles.metricCard, compact ? styles.metricCardCompact : null]} />
          <SkeletonLine opacity={opacity} style={[styles.metricCard, compact ? styles.metricCardCompact : null]} />
        </View>

        <SectionCard compact={compact}>
          <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '40%' }]} />
          {Array.from({ length: compact ? 2 : 3 }).map((_, index) => (
            <Row
              key={index}
              opacity={opacity}
              titleWidth={compact ? '58%' : '66%'}
              subtitleWidth={compact ? '74%' : '84%'}
              badgeWidth={compact ? 50 : 60}
            />
          ))}
        </SectionCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: customerTheme.launchBackground,
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  shell: {
    maxWidth: 540,
    width: '100%',
  },
  authCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    width: '100%',
  },
  authCardCompact: {
    padding: 16,
  },
  authHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 16,
  },
  brandMark: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 18,
    height: 52,
    marginRight: 12,
    width: 52,
  },
  brandMarkCompact: {
    height: 44,
    width: 44,
  },
  brandCopy: {
    flex: 1,
    gap: 8,
  },
  eyebrow: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 10,
  },
  title: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 20,
  },
  copy: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 12,
    marginTop: 10,
  },
  formStack: {
    gap: 12,
    marginTop: 18,
  },
  input: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 14,
    height: 50,
  },
  button: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 14,
    height: 50,
    marginTop: 2,
  },
  linkPill: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 28,
    marginTop: 6,
  },
  policyRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    marginTop: 2,
  },
  checkbox: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 8,
    height: 24,
    width: 24,
  },
  policyCopy: {
    flex: 1,
    gap: 8,
    paddingTop: 2,
  },
  policyLine: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 12,
  },
  onboardingCard: {
    backgroundColor: customerTheme.backgroundAlt,
    borderColor: customerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  sectionCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  sectionCardCompact: {
    padding: 16,
  },
  sectionTitle: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 16,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topText: {
    flex: 1,
    gap: 8,
    paddingRight: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  chip: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 32,
    width: 74,
  },
  chipCompact: {
    width: 66,
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceMuted,
    borderRadius: 18,
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    padding: 14,
  },
  searchIcon: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 18,
    width: 18,
  },
  searchIconCompact: {
    height: 14,
    width: 14,
  },
  searchCopy: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 12,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  featureCard: {
    backgroundColor: customerTheme.surfaceMuted,
    borderRadius: 18,
    height: 96,
    flex: 1,
  },
  featureCardCompact: {
    height: 82,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  metricCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    height: 92,
  },
  metricCardCompact: {
    height: 82,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 12,
  },
  rowAvatar: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 16,
    height: 32,
    marginRight: 12,
    width: 32,
  },
  rowCopy: {
    flex: 1,
    gap: 8,
  },
  rowTitle: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 14,
  },
  rowSubtitle: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 12,
  },
  rowBadge: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    height: 24,
    marginLeft: 12,
    width: 60,
  },
  profileHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  avatarLarge: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 20,
    height: 56,
    width: 56,
  },
  avatarLargeCompact: {
    height: 48,
    width: 48,
  },
  profileCopy: {
    flex: 1,
    gap: 8,
  },
  profileSection: {
    marginTop: 18,
  },
  settingRow: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 16,
    height: 46,
    marginTop: 10,
  },
  skeleton: {
    backgroundColor: customerTheme.surfaceStrong,
  },
});
