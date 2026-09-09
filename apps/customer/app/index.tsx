import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../src/contexts/AuthContext';
import { useCart } from '../src/contexts/CartContext';
import { shouldShowLocationOnboarding } from '../src/domain/customerOnboarding';
import { hasSeenLocationStep } from '../src/services/customerOnboardingState';
import { customerTheme } from '../src/theme/palette';

export default function Index() {
  const { loading, policyLoading, policyAccepted, user } = useAuth();
  const { deliveryLocation } = useCart();
  // null while the flag is still being read — routing must not flash the feed
  // and then bounce to onboarding.
  const [seenLocationStep, setSeenLocationStep] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    hasSeenLocationStep()
      .then((seen) => {
        if (!cancelled) {
          setSeenLocationStep(seen);
        }
      })
      .catch(() => {
        // The service already fails closed to `true`; this is belt-and-braces
        // so a rejected promise can never leave routing stuck on the spinner.
        if (!cancelled) {
          setSeenLocationStep(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || policyLoading || seenLocationStep === null) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: customerTheme.launchBackground,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={customerTheme.brandGreen} size="large" />
      </View>
    );
  }

  // Signed-out visitors browse first; sign-in is prompted at the point of
  // action (add to cart, checkout) rather than at the front door.
  let target = '/home';

  if (user) {
    if (!user.emailVerified) {
      target = '/verify-email';
    } else if (user.role === 'customer' && !user.phoneNumber) {
      target = '/complete-profile';
    } else if (!policyAccepted) {
      target = '/accept-policy';
    } else {
      target = '/home';
    }
  }

  // The location step only ever displaces the feed, never an account step: a
  // half-verified account has something more urgent to finish first.
  if (
    target === '/home' &&
    shouldShowLocationOnboarding({
      hasDeliveryLocation: Boolean(deliveryLocation),
      hasSeenLocationStep: seenLocationStep,
    })
  ) {
    target = '/onboarding';
  }

  return <Redirect href={target as never} />;
}
