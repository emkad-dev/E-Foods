import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AdminBackendStatusBanner from '../../src/components/AdminBackendStatusBanner';
import AdminCard from '../../src/components/AdminCard';
import AdminEmptyState from '../../src/components/AdminEmptyState';
import AdminScreenHeader from '../../src/components/AdminScreenHeader';
import AdminStatusBadge from '../../src/components/AdminStatusBadge';
import type { DispatchProfileDocument } from '../../src/domain/entities';
import { useVisibilityRefresh } from '../../src/hooks/useVisibilityRefresh';
import { getAdminDashboardSnapshot } from '../../src/services/platformReads';
import { adminTheme } from '../../src/theme/palette';
import type { AdminTone } from '../../src/theme/status';

const getDispatchTone = (status?: string | null): AdminTone => {
  const normalized = (status ?? '').toLowerCase();

  if (['online', 'active', 'available'].includes(normalized)) {
    return 'success';
  }

  if (['busy', 'on_trip', 'delivering'].includes(normalized)) {
    return 'info';
  }

  if (['offline', 'suspended', 'disabled'].includes(normalized)) {
    return 'danger';
  }

  return 'neutral';
};

export default function AdminDispatchScreen() {
  const insets = useSafeAreaInsets();
  const [profiles, setProfiles] = useState<DispatchProfileDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendSource, setBackendSource] = useState<'live' | 'cache' | 'fallback'>('live');

  const loadSnapshot = async (cancelled = false) => {
    try {
      const nextSnapshot = await getAdminDashboardSnapshot();

      if (cancelled) {
        return;
      }

      setProfiles(nextSnapshot.data.dispatchProfiles);
      setBackendSource(nextSnapshot.source);
      setError(null);
    } catch (nextError: any) {
      if (cancelled) {
        return;
      }

      console.error('Error loading admin dispatch view:', nextError);
      setError(nextError.message ?? 'Unable to load dispatch profiles right now.');
    } finally {
      if (!cancelled) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    void loadSnapshot();
    const interval = setInterval(() => {
      void loadSnapshot(cancelled);
    }, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useVisibilityRefresh(() => {
    void loadSnapshot();
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <AdminScreenHeader
        eyebrow="Operations"
        title="Dispatch"
        subtitle="Rider availability, zones, and trip load across the dispatch network."
      />

      <AdminBackendStatusBanner source={backendSource} />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <AdminCard>
          <ActivityIndicator size="large" color={adminTheme.accent} />
          <Text style={styles.loadingText}>Loading dispatch profiles...</Text>
        </AdminCard>
      ) : null}

      {!loading && profiles.length === 0 ? (
        <AdminEmptyState
          title="No dispatch riders yet"
          body="Dispatch rider profiles will appear here once they register and come online."
        />
      ) : null}

      {!loading && profiles.length > 0 ? (
        <AdminCard title="Dispatch riders">
          {profiles.map((profile) => {
            const name =
              profile.displayName?.trim() ||
              profile.name?.trim() ||
              profile.fullName?.trim() ||
              `Rider ${String(profile.id).slice(-6)}`;
            const zone = profile.zone ?? profile.currentZone ?? profile.region ?? null;
            const detailParts = [
              zone ? `Zone: ${zone}` : null,
              profile.vehicleType ? `Vehicle: ${profile.vehicleType}` : null,
              profile.activeLoad != null ? `Active: ${profile.activeLoad}` : null,
              profile.completedTrips != null ? `Trips: ${profile.completedTrips}` : null,
            ].filter((value): value is string => Boolean(value));

            return (
              <View key={profile.id} style={styles.riderRow}>
                <View style={styles.riderMeta}>
                  <Text style={styles.riderTitle}>{name}</Text>
                  {detailParts.length > 0 ? (
                    <Text style={styles.riderSubtext}>{detailParts.join(' | ')}</Text>
                  ) : null}
                </View>
                <AdminStatusBadge label={profile.status ?? 'unknown'} tone={getDispatchTone(profile.status)} />
              </View>
            );
          })}
        </AdminCard>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: adminTheme.background,
    flex: 1,
  },
  content: {
    paddingBottom: 28,
    paddingHorizontal: 18,
  },
  errorText: {
    color: adminTheme.danger,
    fontSize: 13,
    marginTop: 14,
  },
  loadingText: {
    color: adminTheme.textMuted,
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  riderRow: {
    alignItems: 'center',
    borderColor: adminTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    padding: 14,
  },
  riderMeta: {
    flex: 1,
  },
  riderTitle: {
    color: adminTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  riderSubtext: {
    color: adminTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
});
