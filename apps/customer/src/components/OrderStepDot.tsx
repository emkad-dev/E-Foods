import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type OrderStepDotProps = {
  active: boolean;
  style?: StyleProp<ViewStyle>;
};

const INACTIVE_SCALE = 0.9;
const INACTIVE_OPACITY = 0.55;

/**
 * Tracking dot for the order status list. When an order advances, the dot for
 * the newly-reached step settles in rather than flipping instantly — the whole
 * point of the tracker is that the state change is legible.
 */
export default function OrderStepDot({ active, style }: OrderStepDotProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(active ? 1 : INACTIVE_SCALE);
  const opacity = useSharedValue(active ? 1 : INACTIVE_OPACITY);

  useEffect(() => {
    const nextOpacity = active ? 1 : INACTIVE_OPACITY;

    if (reduceMotion) {
      // Gentler, not zero: keep the opacity cue, drop the movement.
      scale.value = 1;
      opacity.value = withTiming(nextOpacity, { duration: 200 });
      return;
    }

    scale.value = withSpring(active ? 1 : INACTIVE_SCALE, { duration: 400, dampingRatio: 0.8 });
    opacity.value = withTiming(nextOpacity, {
      duration: 200,
      easing: Easing.bezier(0.23, 1, 0.32, 1).factory(),
    });
  }, [active, opacity, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[style, animatedStyle]} />;
}
