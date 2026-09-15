import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { screenColumn } from '../../src/components/ScreenColumn';
import type { PromoContent } from '../../src/domain/promoContent';
import { trackPromoClick } from '../../src/services/promoTracking';
import { supabase } from '../../src/services/supabase/config';
import { customerTheme } from '../../src/theme/palette';

const PROMO_SELECT = 'id, title, body, actionUrl, imageUrl, detailBody, terms, ctaLabel';

export default function DealsScreen() {
  const [promos, setPromos] = useState<PromoContent[]>([]);
  const [loading, setLoading] = useState(true);
  // The screen had no error state at all: a failed query left `promos` empty
  // and fell through to "No deals right now", presenting a service failure as
  // fact. Modelled on promo/[id].tsx, which already distinguishes the two.
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    // RLS returns only active, in-window promos.
    const { data, error } = await supabase
      .from('Promo')
      .select(PROMO_SELECT)
      .order('createdAt', { ascending: false })
      .limit(50)
      .returns<PromoContent[]>();
    if (error) {
      setFailed(true);
    } else {
      setPromos(data ?? []);
      setFailed(false);
    }
    setLoading(false);
  }, []);

  const retry = useCallback(() => {
    // Only the explicit retry shows the spinner again. Refocusing the tab
    // re-runs `load` silently, so the list does not flash on every return.
    setLoading(true);
    void load();
  }, [load]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openPromo = (promo: PromoContent) => {
    trackPromoClick(promo.id);
    router.push(`/promo/${promo.id}` as never);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={customerTheme.accent} />
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Couldn&apos;t load deals</Text>
        <Text style={styles.emptyBody}>Check your connection and try again.</Text>
        <Pressable style={styles.retry} onPress={retry} accessibilityRole="button">
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (promos.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No deals right now</Text>
        <Text style={styles.emptyBody}>Check back soon — new offers land here.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.container, screenColumn.feed]}>
      {promos.map((promo) => (
        <Pressable key={promo.id} style={styles.card} onPress={() => openPromo(promo)} accessibilityRole="button">
          {promo.imageUrl ? (
            <Image source={{ uri: promo.imageUrl }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={[styles.image, styles.imagePlaceholder]} />
          )}
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle} numberOfLines={1}>{promo.title}</Text>
            <Text style={styles.cardCopy} numberOfLines={2}>{promo.body}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.background, flex: 1 },
  container: { padding: 16, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: customerTheme.background, gap: 6, padding: 24 },
  emptyTitle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: customerTheme.textMuted, fontSize: 14, textAlign: 'center' },
  retry: {
    marginTop: 12, backgroundColor: customerTheme.accentStrong, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center',
  },
  retryText: { color: customerTheme.textOnBrand, fontSize: 16, fontWeight: '800' },
  card: { backgroundColor: customerTheme.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: customerTheme.border },
  image: { width: '100%', height: 150 },
  imagePlaceholder: { backgroundColor: customerTheme.accentSoft },
  cardBody: { padding: 14, gap: 4 },
  cardTitle: { color: customerTheme.text, fontSize: 16, fontWeight: '800' },
  cardCopy: { color: customerTheme.textMuted, fontSize: 13, lineHeight: 18 },
});
