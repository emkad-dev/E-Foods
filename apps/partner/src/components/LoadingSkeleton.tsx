import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { partnerTheme } from '../theme/palette';

type LoadingSkeletonMode =
  | 'auth-login'
  | 'auth-register'
  | 'auth-recovery'
  | 'dashboard'
  | 'orders'
  | 'menu'
  | 'profile'
  | 'setup';

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

export default function LoadingSkeleton({ mode = 'dashboard' }: LoadingSkeletonProps) {
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

  const copyWidth = compact ? '80%' : '86%';

  if (mode === 'auth-login' || mode === 'auth-register' || mode === 'auth-recovery') {
    return (
      <View style={styles.screen}>
        <View style={[styles.authCard, compact ? styles.authCardCompact : null]}>
          <View style={styles.authHeader}>
            <View style={[styles.brandMark, compact ? styles.brandMarkCompact : null]} />
            <View style={styles.brandCopy}>
              <SkeletonLine opacity={opacity} style={[styles.eyebrow, { width: compact ? '40%' : '34%' }]} />
              <SkeletonLine opacity={opacity} style={[styles.title, { width: compact ? '72%' : '66%' }]} />
            </View>
          </View>

          <SkeletonLine opacity={opacity} style={[styles.copy, { width: copyWidth }]} />
          {!compact ? <SkeletonLine opacity={opacity} style={[styles.copy, { width: '72%' }]} /> : null}

          {mode === 'auth-login' ? (
            <View style={styles.formStack}>
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.button} />
              <View style={styles.linkStack}>
                <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? '56%' : '48%' }]} />
                <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? '44%' : '38%' }]} />
              </View>
            </View>
          ) : null}

          {mode === 'auth-register' ? (
            <View style={styles.formStack}>
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <View style={styles.policyRow}>
                <SkeletonLine opacity={opacity} style={styles.checkbox} />
                <View style={styles.policyCopy}>
                  <SkeletonLine opacity={opacity} style={[styles.policyLine, { width: '90%' }]} />
                  <SkeletonLine opacity={opacity} style={[styles.policyLine, { width: compact ? '62%' : '56%' }]} />
                </View>
              </View>
              <SkeletonLine opacity={opacity} style={styles.button} />
            </View>
          ) : null}

          {mode === 'auth-recovery' ? (
            <View style={styles.formStack}>
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.button} />
              <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? '56%' : '44%' }]} />
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
              <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '38%' }]} />
              <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '68%' : '54%' }]} />
            </View>
            <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? 78 : 96 }]} />
          </View>

          <View style={styles.chipRow}>
            {Array.from({ length: compact ? 3 : 4 }).map((_, index) => (
              <SkeletonLine key={index} opacity={opacity} style={[styles.chip, compact ? styles.chipCompact : null]} />
            ))}
          </View>

          <SectionCard compact={compact}>
            <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '44%' }]} />
            {Array.from({ length: compact ? 3 : 4 }).map((_, index) => (
              <Row
                key={index}
                opacity={opacity}
                titleWidth={compact ? '56%' : '64%'}
                subtitleWidth={compact ? '72%' : '84%'}
                badgeWidth={compact ? 52 : 62}
              />
            ))}
          </SectionCard>
        </View>
      </View>
    );
  }

  if (mode === 'menu') {
    return (
      <View style={styles.screen}>
        <View style={styles.shell}>
          <View style={styles.topRow}>
            <View style={styles.topText}>
              <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '34%' }]} />
              <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '66%' : '52%' }]} />
            </View>
            <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? 68 : 84 }]} />
          </View>

          <View style={styles.chipRow}>
            {Array.from({ length: compact ? 3 : 5 }).map((_, index) => (
              <SkeletonLine key={index} opacity={opacity} style={[styles.chip, compact ? styles.chipCompact : null]} />
            ))}
          </View>

          <SectionCard compact={compact}>
            <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '40%' }]} />
            {Array.from({ length: compact ? 3 : 4 }).map((_, index) => (
              <View key={index} style={styles.menuRow}>
                <View style={styles.menuThumb} />
                <View style={styles.menuCopy}>
                  <SkeletonLine opacity={opacity} style={[styles.rowTitle, { width: compact ? '60%' : '66%' }]} />
                  <SkeletonLine opacity={opacity} style={[styles.rowSubtitle, { width: compact ? '74%' : '84%' }]} />
                </View>
                <SkeletonLine opacity={opacity} style={styles.togglePill} />
              </View>
            ))}
          </SectionCard>
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
                <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '48%' }]} />
                <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '68%' : '60%' }]} />
              </View>
            </View>
            <View style={styles.profileSection}>
              {Array.from({ length: compact ? 3 : 4 }).map((_, index) => (
                <SkeletonLine key={index} opacity={opacity} style={styles.settingRow} />
              ))}
            </View>
          </SectionCard>
        </View>
      </View>
    );
  }

  if (mode === 'setup') {
    return (
      <View style={styles.screen}>
        <View style={styles.shell}>
          <SectionCard compact={compact}>
            <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '46%' }]} />
            <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '84%' : '78%' }]} />
            <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '72%' : '68%' }]} />

            <View style={styles.formStack}>
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.input} />
              <SkeletonLine opacity={opacity} style={styles.button} />
            </View>
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
            <SkeletonLine opacity={opacity} style={[styles.copy, { width: compact ? '68%' : '54%' }]} />
          </View>
          <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? 78 : 92 }]} />
        </View>

        <View style={styles.chipRow}>
          {Array.from({ length: compact ? 3 : 4 }).map((_, index) => (
            <SkeletonLine key={index} opacity={opacity} style={[styles.chip, compact ? styles.chipCompact : null]} />
          ))}
        </View>

        <View style={styles.metricsRow}>
          {Array.from({ length: compact ? 4 : 6 }).map((_, index) => (
            <SkeletonLine key={index} opacity={opacity} style={[styles.metricCard, compact ? styles.metricCardCompact : null]} />
          ))}
        </View>

        <View style={styles.splitRow}>
          <SectionCard compact={compact}>
            <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '40%' }]} />
            <SkeletonLine opacity={opacity} style={[styles.chartBlock, compact ? styles.chartBlockCompact : null]} />
            <View style={styles.legendRow}>
              <SkeletonLine opacity={opacity} style={[styles.legendPill, { width: compact ? 88 : 102 }]} />
              <SkeletonLine opacity={opacity} style={[styles.legendPill, { width: compact ? 74 : 90 }]} />
            </View>
          </SectionCard>

          <SectionCard compact={compact}>
            <View style={styles.cardTitleRow}>
              <SkeletonLine opacity={opacity} style={[styles.sectionTitle, { width: '34%' }]} />
              <SkeletonLine opacity={opacity} style={[styles.linkPill, { width: compact ? 52 : 68 }]} />
            </View>
            {Array.from({ length: compact ? 2 : 3 }).map((_, index) => (
              <Row
                key={index}
                opacity={opacity}
                titleWidth={compact ? '56%' : '64%'}
                subtitleWidth={compact ? '72%' : '84%'}
                badgeWidth={compact ? 52 : 62}
              />
            ))}
          </SectionCard>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: partnerTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  shell: {
    maxWidth: 540,
    width: '100%',
  },
  authCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
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
    backgroundColor: partnerTheme.accentSoft,
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
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 10,
  },
  title: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 20,
  },
  copy: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 12,
    marginTop: 10,
  },
  formStack: {
    gap: 12,
    marginTop: 18,
  },
  input: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 14,
    height: 50,
  },
  button: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 14,
    height: 50,
  },
  linkStack: {
    gap: 10,
    marginTop: 6,
  },
  linkPill: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 28,
  },
  policyRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    marginTop: 2,
  },
  checkbox: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 8,
    height: 22,
    width: 22,
  },
  policyCopy: {
    flex: 1,
    gap: 8,
    paddingTop: 2,
  },
  policyLine: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 12,
  },
  sectionCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  sectionCardCompact: {
    padding: 16,
  },
  sectionTitle: {
    backgroundColor: partnerTheme.surfaceMuted,
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
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 32,
    width: 74,
  },
  chipCompact: {
    width: 66,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  metricCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 100,
    width: '47.5%',
  },
  metricCardCompact: {
    width: '47%',
    height: 88,
  },
  splitRow: {
    gap: 14,
    marginTop: 16,
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chartBlock: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 20,
    height: 180,
    marginTop: 14,
  },
  chartBlockCompact: {
    height: 150,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  legendPill: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 28,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 12,
  },
  rowAvatar: {
    backgroundColor: partnerTheme.accentSoft,
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
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 14,
  },
  rowSubtitle: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 12,
  },
  rowBadge: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 24,
    marginLeft: 12,
    width: 60,
  },
  menuRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  menuThumb: {
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: 18,
    height: 48,
    width: 48,
  },
  menuCopy: {
    flex: 1,
    gap: 8,
  },
  togglePill: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    height: 28,
    width: 52,
  },
  profileHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  avatarLarge: {
    backgroundColor: partnerTheme.accentSoft,
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
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 16,
    height: 46,
    marginTop: 10,
  },
  skeleton: {
    backgroundColor: partnerTheme.surfaceMuted,
  },
});
