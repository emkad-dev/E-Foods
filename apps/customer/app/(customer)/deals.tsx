import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PromoContent } from '../../src/domain/promoContent';
import { trackPromoClick } from '../../src/services/promoTracking';
import { supabase } from '../../src/services/supabase/config';
import { customerTheme } from '../../src/theme/palette';

const PROMO_SELECT = 'id, title, body, actionUrl, imageUrl, detailBody, terms, ctaLabel';

export default function DealsScreen() {
  const [promos, setPromos] = useState<PromoContent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // RLS returns only active, in-window promos.
    const { data, error } = await supabase
      .from('Promo')
      .select(PROMO_SELECT)
      .order('createdAt', { ascending: false })
      .returns<PromoContent[]>();
    if (!error && data) {
      setPromos(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (promos.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No deals right now</Text>
        <Text style={styles.emptyBody}>Check back soon — new offers land here.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
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
  card: { backgroundColor: customerTheme.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: customerTheme.border },
  image: { width: '100%', height: 150 },
  imagePlaceholder: { backgroundColor: customerTheme.accentSoft },
  cardBody: { padding: 14, gap: 4 },
  cardTitle: { color: customerTheme.text, fontSize: 16, fontWeight: '800' },
  cardCopy: { color: customerTheme.textMuted, fontSize: 13, lineHeight: 18 },
});
