import { FontAwesome } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { border, brand, space, text as textColor, Text } from '@feasty/design-system';

type OrderStatusTrackerProps = {
  /** Already-formatted step labels, in order. */
  labels: string[];
  /** Index of the current step; steps before it are treated as complete. */
  currentStep: number;
};

/**
 * A connected vertical timeline of an order's progress.
 *
 * Replaces the earlier bare-circles list: completed steps are filled green with a check
 * and joined by a solid connector; the current step carries a ring and a bold label;
 * upcoming steps recede to a hollow dot, a muted connector, and secondary text — so the
 * order's position reads at a glance, which is the whole job of a tracking view.
 */
export default function OrderStatusTracker({ labels, currentStep }: OrderStatusTrackerProps) {
  return (
    <View style={styles.root}>
      {labels.map((label, index) => {
        const complete = index < currentStep;
        const current = index === currentStep;
        const active = complete || current;
        const isLast = index === labels.length - 1;

        return (
          <Animated.View key={label} entering={FadeIn.delay(index * 120)} style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  active ? styles.dotActive : styles.dotIdle,
                  current ? styles.dotCurrent : null,
                ]}
              >
                {complete ? <FontAwesome name="check" size={10} color={textColor.onBrand} /> : null}
              </View>
              {!isLast ? (
                <View style={[styles.connector, complete ? styles.connectorActive : styles.connectorIdle]} />
              ) : null}
            </View>

            <Text
              variant={current ? 'bodyStrong' : 'body'}
              tone={active ? 'primary' : 'secondary'}
              style={styles.label}
            >
              {label}
            </Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

const DOT = 22;

const styles = StyleSheet.create({
  root: {
    marginTop: space.sm,
  },
  row: {
    flexDirection: 'row',
  },
  rail: {
    alignItems: 'center',
    marginRight: space.md,
    width: DOT,
  },
  dot: {
    alignItems: 'center',
    borderRadius: DOT / 2,
    height: DOT,
    justifyContent: 'center',
    width: DOT,
  },
  dotActive: {
    backgroundColor: brand.primary,
  },
  dotIdle: {
    backgroundColor: 'transparent',
    borderColor: border.strong,
    borderWidth: 2,
  },
  dotCurrent: {
    borderColor: brand.primaryStrong,
    borderWidth: 3,
  },
  connector: {
    flex: 1,
    marginVertical: 2,
    width: 2,
  },
  connectorActive: {
    backgroundColor: brand.primary,
  },
  connectorIdle: {
    backgroundColor: border.default,
  },
  label: {
    flex: 1,
    paddingTop: 1,
    paddingBottom: space.lg,
  },
});
