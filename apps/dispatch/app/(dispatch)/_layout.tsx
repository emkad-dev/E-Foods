import { useMemo } from 'react';
import { Redirect, Slot, Tabs, usePathname } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { useActiveDeliveryNotification } from '../../src/hooks/useActiveDeliveryNotification';
import { useDispatchOrders } from '../../src/hooks/useDispatchOrders';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { dispatchTheme } from '../../src/theme/palette';

export default function DispatchLayout() {
  const pathname = usePathname();
  const { user } = useAuth();
  usePushNotifications();
  const { activeDeliveryOrders } = useDispatchOrders();
  // activeDeliveryOrders also carries unowned manual-queue work any rider could
  // pick up (see DispatchLocationSyncBridge in app/_layout.tsx), so passing it
  // straight through put a "Delivery in progress" card up for orders this
  // rider had never taken. Only orders where they are the assigned courier.
  const myActiveDeliveries = useMemo(
    () => activeDeliveryOrders.filter((order) => order.assignment?.courierId === user?.uid),
    [activeDeliveryOrders, user?.uid]
  );
  useActiveDeliveryNotification(myActiveDeliveries);

  if (user && user.role !== 'dispatch') {
    if (pathname !== '/complete-rider-details') {
      return <Redirect href={'/(dispatch)/complete-rider-details' as never} />;
    }

    return <Slot />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dispatchTheme.accentStrong,
        tabBarInactiveTintColor: dispatchTheme.textMuted,
        tabBarStyle: {
          backgroundColor: dispatchTheme.tabBackground,
          borderTopColor: dispatchTheme.border,
          height: 70,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
        }}
      />
      <Tabs.Screen
        name="deliveries"
        options={{
          title: 'Deliveries',
        }}
      />
      {/* Hidden: dispatchGetRiders only ever returns the caller's OWN record
          to a rider (SP-1), so a "fleet" board showed one card - the rider
          themselves - under developer copy. The route stays for a future
          ops view; it just has no tab. */}
      <Tabs.Screen
        name="fleet"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Rider',
        }}
      />
      {/* Both of these are detail screens reached by pushing, not tabs. A
          Tabs navigator auto-registers every route under its directory, so
          without `href: null` each one grows a button in the bar --
          `delivery/[id]` was already guarded and `offer/[id]`, added later,
          was not, which would have put a fifth tab labelled after the offer
          route next to Rider. Latent only because DISPATCH_ENABLED is false. */}
      <Tabs.Screen
        name="delivery/[id]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="offer/[id]"
        options={{
          href: null,
        }}
      />
      {/* Payout bank account, pushed from the Rider tab. */}
      <Tabs.Screen
        name="payout"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
