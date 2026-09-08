import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PromoContent } from '../../../src/domain/promoContent';
import { supabase } from '../../../src/services/supabase/config';
import { customerTheme } from '../../../src/theme/palette';

const PROMO_SELECT = 'id, title, body, actionUrl, imageUrl, detailBody, terms, ctaLabel';

export default function PromoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [promo, setPromo] = useState<PromoContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (!id) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('Promo')
      .select(PROMO_SELECT)
      .eq('id', id)
      .maybeSingle<PromoContent>();
    if (error && !data) {
      setFailed(true);
    } else {
      setPromo(data ?? null);
      setFailed(false);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCta = () => {
    // Same open-redirect guard as the banner: in-app paths only.
    if (promo?.actionUrl && promo.actionUrl.startsWith('/')) {
      router.push(promo.actionUrl as never);
    }
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
        <Text style={styles.emptyTitle}>Couldn&apos;t load this deal</Text>
        <Text style={styles.emptyBody}>Check your connection and try again.</Text>
        <Pressable style={styles.retry} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.ctaText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!promo) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>This deal has ended</Text>
        <Text style={styles.emptyBody}>It may have expired or been withdrawn.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        {promo.imageUrl ? (
          <Image source={{ uri: promo.imageUrl }} style={styles.hero} resizeMode="cover" />
        ) : (
          <View style={[styles.hero, styles.heroPlaceholder]} />
        )}
        <Text style={styles.title}>{promo.title}</Text>
        <Text style={styles.body}>{promo.detailBody?.trim() || promo.body}</Text>
        {promo.terms ? (
          <View style={styles.terms}>
            <Text style={styles.termsLabel}>Terms</Text>
            <Text style={styles.termsBody}>{promo.terms}</Text>
          </View>
        ) : null}
      </ScrollView>
      {promo.actionUrl ? (
        <Pressable style={styles.cta} onPress={onCta} accessibilityRole="button">
          <Text style={styles.ctaText}>{promo.ctaLabel?.trim() || 'Order now'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: customerTheme.background },
  container: { padding: 16, paddingBottom: 100, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: customerTheme.background, gap: 6, padding: 24 },
  emptyTitle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: customerTheme.textMuted, fontSize: 14, textAlign: 'center' },
  retry: {
    marginTop: 12, backgroundColor: customerTheme.accentStrong, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center',
  },
  hero: { width: '100%', height: 200, borderRadius: 16 },
  heroPlaceholder: { backgroundColor: customerTheme.accentSoft },
  title: { color: customerTheme.text, fontSize: 22, fontWeight: '800' },
  body: { color: customerTheme.text, fontSize: 15, lineHeight: 22 },
  terms: { backgroundColor: customerTheme.surfaceMuted, borderRadius: 12, padding: 12, gap: 4 },
  termsLabel: { color: customerTheme.textMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  termsBody: { color: customerTheme.textMuted, fontSize: 13, lineHeight: 19 },
  cta: {
    position: 'absolute', left: 16, right: 16, bottom: 20, backgroundColor: customerTheme.accentStrong,
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  ctaText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
});
