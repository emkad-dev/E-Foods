import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../services/supabase/config';
import { customerTheme } from '../theme/palette';

// Broadcast topic + event mirror the edge function (`PROMOS_REALTIME_TOPIC`,
// `REALTIME_CHANGED_EVENT`) and the direct-subscribe style used by
// useSupportThreadRealtime.
const PROMOS_TOPIC = 'promos';
const CHANGED_EVENT = 'changed';
const DISMISSED_KEY = 'feasty.dismissedPromos';

type Promo = {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
};

// Phase 1 dismissal: persisted in localStorage on web, in-memory on native.
// (Native persistence via AsyncStorage is a follow-up.)
const nativeDismissed = new Set<string>();

const readDismissed = (): Set<string> => {
  if (Platform.OS !== 'web') {
    return nativeDismissed;
  }
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
};

const persistDismissed = (ids: Set<string>) => {
  if (Platform.OS !== 'web') {
    return;
  }
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore quota / privacy-mode failures — dismissal just won't persist.
  }
};

export default function PromoBanner() {
  const [promo, setPromo] = useState<Promo | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const show = useCallback(
    (next: Promo) => {
      setPromo(next);
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    },
    [fadeAnim]
  );

  const hide = useCallback(() => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => setPromo(null));
  }, [fadeAnim]);

  const refresh = useCallback(async () => {
    // RLS returns only promos that are active and inside their live window.
    const { data, error } = await supabase
      .from('Promo')
      .select('id, title, body, actionUrl')
      .order('createdAt', { ascending: false })
      .limit(10)
      .returns<Promo[]>();
    if (error || !data) {
      return;
    }
    const dismissed = readDismissed();
    const next = data.find((candidate) => !dismissed.has(candidate.id));
    if (next) {
      show(next);
    }
  }, [show]);

  useEffect(() => {
    void refresh();

    const channel = supabase
      .channel(PROMOS_TOPIC)
      .on('broadcast', { event: CHANGED_EVENT }, () => {
        void refresh();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const dismiss = useCallback(() => {
    if (promo) {
      const dismissed = readDismissed();
      dismissed.add(promo.id);
      nativeDismissed.add(promo.id);
      persistDismissed(dismissed);
    }
    hide();
  }, [promo, hide]);

  const openDeal = useCallback(() => {
    if (promo?.actionUrl) {
      router.push(promo.actionUrl as never);
    }
    dismiss();
  }, [promo, dismiss]);

  if (!promo) {
    return null;
  }

  return (
    <Animated.View style={[styles.banner, { opacity: fadeAnim }]} pointerEvents="box-none">
      <Pressable
        style={styles.card}
        onPress={promo.actionUrl ? openDeal : undefined}
        accessibilityRole={promo.actionUrl ? 'button' : undefined}
      >
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {promo.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {promo.body}
          </Text>
          {promo.actionUrl ? <Text style={styles.cta}>View deal →</Text> : null}
        </View>
        <TouchableOpacity
          style={styles.close}
          onPress={dismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss promo"
        >
          <Text style={styles.closeText}>×</Text>
        </TouchableOpacity>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    left: 12,
    position: 'absolute',
    right: 12,
    top: Platform.OS === 'web' ? 16 : 52,
    zIndex: 50,
  },
  card: {
    alignItems: 'flex-start',
    backgroundColor: customerTheme.accentStrong,
    borderRadius: 16,
    boxShadow: '0 8px 18px rgba(13, 21, 34, 0.22)',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  body: {
    color: '#eaf5ea',
    fontSize: 13,
    lineHeight: 18,
  },
  cta: {
    color: customerTheme.accentSoft,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 4,
  },
  close: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  closeText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
});
