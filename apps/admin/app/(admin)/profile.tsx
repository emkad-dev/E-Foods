import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AdminCard from '../../src/components/AdminCard';
import AdminScreenHeader from '../../src/components/AdminScreenHeader';
import AdminStatusBadge from '../../src/components/AdminStatusBadge';
import { useAuth } from '../../src/contexts/AuthContext';
import { adminTheme } from '../../src/theme/palette';
import { getRoleTone } from '../../src/theme/status';

export default function AdminProfileScreen() {
  const insets = useSafeAreaInsets();
  const { loading, signOut, user } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (nextError: any) {
      Alert.alert('Sign out failed', nextError.message ?? 'Unable to sign out right now.');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <AdminScreenHeader
        eyebrow="Profile"
        title="Admin profile"
        subtitle="This is the company-only side of the platform. Keep access tight and traceable."
      />

      <AdminCard
        title="Account details"
        subtitle="This operator record controls who can provision staff, review approvals, and steer the sandbox."
      >
        <View style={styles.badgeRow}>
          <AdminStatusBadge label={user?.role ?? 'admin'} tone={getRoleTone(user?.role)} />
          <AdminStatusBadge
            label={user?.emailVerified ? 'verified email' : 'unverified email'}
            tone={user?.emailVerified ? 'success' : 'warning'}
          />
        </View>
        <Text style={styles.metaLine}>Display name: {user?.displayName ?? 'Not set'}</Text>
        <Text style={styles.metaLine}>Email: {user?.email ?? 'Not available'}</Text>
        <Text style={styles.metaLine}>Role: {user?.role ?? 'admin'}</Text>
        <Text style={styles.metaLine}>Email verified: {user?.emailVerified ? 'Yes' : 'No'}</Text>
        <Text style={styles.metaLine}>Single-device session: {user?.activeSessionId ? 'Active' : 'Idle'}</Text>
        <Text style={styles.metaLine}>Session updated: {user?.activeSessionUpdatedAt ?? 'Not recorded'}</Text>
      </AdminCard>

      <AdminCard
        title="Operating note"
        subtitle="Keep the control plane company-managed until the platform has a fuller internal IAM workflow."
      >
        <Text style={styles.copy}>
          Admin accounts are intentionally company-managed. Keep creation, recovery, and role assignment limited to trusted internal operators until a fuller admin workflow is in place.
        </Text>
        <Text style={styles.copy}>
          When a staff member leaves, prefer disabling sign-in and revoking their privileged role from the Access screen instead of deleting their record. That keeps approvals, audit history, and ownership changes traceable.
        </Text>
      </AdminCard>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={loading}>
        <Text style={styles.signOutText}>{loading ? 'Signing out...' : 'Sign out'}</Text>
      </TouchableOpacity>
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
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  metaLine: {
    color: adminTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  copy: {
    color: adminTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: adminTheme.accentStrong,
    borderRadius: 16,
    marginTop: 22,
    paddingVertical: 14,
  },
  signOutText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
