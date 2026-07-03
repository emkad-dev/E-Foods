import { FontAwesome } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useRef } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { adminTheme } from '../theme/palette';
import { useSidebarPrefs } from './AdminSidebarPrefsContext';

type NavItem = {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  label: string;
  path: string;
};

const NAV_ITEMS: NavItem[] = [
  { icon: 'dashboard', label: 'Dashboard', path: '/' },
  { icon: 'users', label: 'Users', path: '/users' },
  { icon: 'shopping-bag', label: 'Orders', path: '/orders' },
  { icon: 'truck', label: 'Dispatch', path: '/dispatch' },
  { icon: 'check-square-o', label: 'Approvals', path: '/approvals' },
  { icon: 'shield', label: 'Access', path: '/access' },
  { icon: 'user', label: 'Profile', path: '/profile' },
];

const isActivePath = (pathname: string, target: string): boolean => {
  if (target === '/') {
    return pathname === '/' || pathname === '/index';
  }

  return pathname === target || pathname.startsWith(`${target}/`);
};

export default function AdminSidebar() {
  const pathname = usePathname();
  const { signOut } = useAuth();
  const { side, width, setSide, setWidth } = useSidebarPrefs();
  const startWidthRef = useRef(width);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startWidthRef.current = width;
      },
      onPanResponderMove: (_event, gestureState) => {
        const next =
          side === 'right'
            ? startWidthRef.current - gestureState.dx
            : startWidthRef.current + gestureState.dx;
        setWidth(next);
      },
    })
  ).current;

  const handle = (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.dragHandle,
        side === 'right' ? styles.dragHandleLeft : styles.dragHandleRight,
        { cursor: 'col-resize' as any },
      ]}
    />
  );

  return (
    <View style={[styles.rail, { width }]}>
      {side === 'right' ? handle : null}

      <View style={styles.inner}>
        <View>
          <View style={styles.brandRow}>
            <Text style={styles.brand}>
              <Text style={styles.brandFeast}>FEAST</Text>
              <Text style={styles.brandY}>Y</Text> Admin
            </Text>
            <TouchableOpacity
              style={styles.dockToggle}
              onPress={() => setSide(side === 'left' ? 'right' : 'left')}
              accessibilityLabel="Toggle sidebar side"
            >
              <FontAwesome name="exchange" size={15} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.navScroll} contentContainerStyle={styles.nav}>
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(pathname, item.path);
              return (
                <TouchableOpacity
                  key={item.path}
                  style={[styles.navItem, active ? styles.navItemActive : null]}
                  onPress={() => router.replace(item.path as never)}
                >
                  <FontAwesome
                    name={item.icon}
                    size={17}
                    color={active ? '#ffffff' : 'rgba(255,255,255,0.62)'}
                    style={styles.navIcon}
                  />
                  <Text style={[styles.navLabel, active ? styles.navLabelActive : null]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <TouchableOpacity style={styles.logout} onPress={() => void signOut()}>
          <FontAwesome name="sign-out" size={17} color={adminTheme.dangerSoft} style={styles.navIcon} />
          <Text style={styles.logoutLabel}>Log out</Text>
        </TouchableOpacity>
      </View>

      {side === 'left' ? handle : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    backgroundColor: adminTheme.hero,
    flexDirection: 'row',
    height: '100%',
  },
  inner: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  dragHandle: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    height: '100%',
    width: 6,
  },
  dragHandleRight: {
    borderLeftColor: 'rgba(255,255,255,0.08)',
    borderLeftWidth: 1,
  },
  dragHandleLeft: {
    borderRightColor: 'rgba(255,255,255,0.08)',
    borderRightWidth: 1,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  brand: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // FEASTY wordmark — same colors + italic slant as the customer app brand.
  brandFeast: {
    color: adminTheme.brandGreen,
    fontStyle: 'italic',
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  brandY: {
    color: adminTheme.brandOrange,
    fontStyle: 'italic',
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  dockToggle: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  navScroll: {
    flexGrow: 0,
  },
  nav: {
    gap: 6,
  },
  navItem: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  navItemActive: {
    backgroundColor: 'rgba(24,178,107,0.16)',
  },
  navIcon: {
    marginRight: 12,
    width: 20,
  },
  navLabel: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 14,
    fontWeight: '700',
  },
  navLabelActive: {
    color: '#ffffff',
  },
  logout: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  logoutLabel: {
    color: adminTheme.dangerSoft,
    fontSize: 14,
    fontWeight: '700',
  },
});
