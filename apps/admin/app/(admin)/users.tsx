import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AdminBackendStatusBanner from '../../src/components/AdminBackendStatusBanner';
import AdminCard from '../../src/components/AdminCard';
import AdminEmptyState from '../../src/components/AdminEmptyState';
import AdminScreenHeader from '../../src/components/AdminScreenHeader';
import AdminUserCard from '../../src/components/AdminUserCard';
import { useAuth } from '../../src/contexts/AuthContext';
import { useVisibilityRefresh } from '../../src/hooks/useVisibilityRefresh';
import type { AppRole, UserDocument } from '../../src/domain/entities';
import {
  assignUserRole,
  deleteAdminAccess,
  disableUserAccess,
  enableUserAccess,
  revokeUserRole,
  updateUserRestaurantLink,
} from '../../src/services/accessManagement';
import { getAdminAccessOverview } from '../../src/services/platformReads';
import { adminTheme } from '../../src/theme/palette';

export default function AdminUsersScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [users, setUsers] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [restaurantLinks, setRestaurantLinks] = useState<Record<string, string>>({});
  const [backendSource, setBackendSource] = useState<'live' | 'cache' | 'fallback'>('live');
  const [query, setQuery] = useState('');

  const loadAccessOverview = async (cancelled = false) => {
    try {
      const nextData = await getAdminAccessOverview();

      if (cancelled) {
        return;
      }

      setUsers(nextData.data.users);
      setBackendSource(nextData.source);
      setRestaurantLinks((current) => {
        const nextLinks = { ...current };

        for (const entry of nextData.data.users) {
          if (nextLinks[entry.uid] === undefined) {
            nextLinks[entry.uid] = entry.restaurantId ?? '';
          }
        }

        return nextLinks;
      });
      setError(null);
    } catch (nextError: any) {
      if (cancelled) {
        return;
      }

      console.error('Error loading admin users view:', nextError);
      setError(nextError.message ?? 'Unable to load users right now.');
    } finally {
      if (!cancelled) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    void loadAccessOverview();
    const interval = setInterval(() => {
      void loadAccessOverview(cancelled);
    }, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useVisibilityRefresh(() => {
    void loadAccessOverview();
  });

  const sortedUsers = useMemo(
    () =>
      [...users].sort((left, right) => {
        if (left.accountDisabled !== right.accountDisabled) {
          return left.accountDisabled ? 1 : -1;
        }

        if (left.role !== right.role) {
          return left.role.localeCompare(right.role);
        }

        return (left.displayName ?? left.email).localeCompare(right.displayName ?? right.email);
      }),
    [users]
  );

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return sortedUsers;
    }

    return sortedUsers.filter((entry) =>
      [entry.displayName, entry.email, entry.phoneNumber]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery))
    );
  }, [sortedUsers, query]);

  const handleAssignRole = async (targetUid: string, role: AppRole, restaurantId?: string | null) => {
    setPendingUid(targetUid);

    try {
      await assignUserRole(targetUid, role, restaurantId);
      await loadAccessOverview();
    } catch (nextError: any) {
      Alert.alert('Role update failed', nextError.message ?? 'Unable to update this role right now.');
    } finally {
      setPendingUid(null);
    }
  };

  const handleRevokeRole = async (targetUid: string) => {
    setPendingUid(targetUid);

    try {
      await revokeUserRole(targetUid);
      await loadAccessOverview();
    } catch (nextError: any) {
      Alert.alert('Role revoke failed', nextError.message ?? 'Unable to revoke this role right now.');
    } finally {
      setPendingUid(null);
    }
  };

  const handleDisableAccess = async (targetUid: string) => {
    setPendingUid(targetUid);

    try {
      await disableUserAccess(targetUid);
      await loadAccessOverview();
    } catch (nextError: any) {
      Alert.alert('Disable failed', nextError.message ?? 'Unable to disable this account right now.');
    } finally {
      setPendingUid(null);
    }
  };

  const handleEnableAccess = async (targetUid: string) => {
    setPendingUid(targetUid);

    try {
      await enableUserAccess(targetUid);
      await loadAccessOverview();
    } catch (nextError: any) {
      Alert.alert('Restore failed', nextError.message ?? 'Unable to restore this account right now.');
    } finally {
      setPendingUid(null);
    }
  };

  const handleDeleteAdminAccess = async (targetUid: string, email: string) => {
    Alert.alert(
      'Delete admin access?',
      `This will ban ${email}, remove the auth user, and delete the local access records. You can recreate the account with the same email from the access provisioning form.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setPendingUid(targetUid);

            try {
              await deleteAdminAccess(targetUid);
              await loadAccessOverview();
            } catch (nextError: any) {
              Alert.alert('Delete failed', nextError.message ?? 'Unable to delete this admin access right now.');
            } finally {
              setPendingUid(null);
            }
          },
        },
      ]
    );
  };

  const handleChangeRestaurantLink = (targetUid: string, value: string) => {
    setRestaurantLinks((current) => ({
      ...current,
      [targetUid]: value,
    }));
  };

  const handleUpdateRestaurantLink = async (targetUid: string) => {
    setPendingUid(targetUid);

    try {
      const result = await updateUserRestaurantLink(targetUid, restaurantLinks[targetUid]);
      setRestaurantLinks((current) => ({
        ...current,
        [targetUid]: result.restaurantId ?? '',
      }));
      await loadAccessOverview();
    } catch (nextError: any) {
      Alert.alert('Link update failed', nextError.message ?? 'Unable to update this restaurant link right now.');
    } finally {
      setPendingUid(null);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <AdminScreenHeader
        eyebrow="Directory"
        title="Users"
        subtitle="Every account on the platform. Search, adjust roles, link partners, and manage access from one place."
      />

      <AdminBackendStatusBanner source={backendSource} />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <AdminCard>
          <ActivityIndicator size="large" color={adminTheme.accent} />
          <Text style={styles.loadingText}>Loading users...</Text>
        </AdminCard>
      ) : null}

      {!loading && users.length > 0 ? (
        <View style={styles.searchShell}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, email, or phone"
            placeholderTextColor={adminTheme.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      {!loading && users.length === 0 ? (
        <AdminEmptyState
          title="No users found"
          body="Accounts will appear here once they exist in the users collection."
        />
      ) : null}

      {!loading && users.length > 0 && filteredUsers.length === 0 ? (
        <AdminEmptyState
          title="No matching users"
          body="No account matches that search. Try a different name, email, or phone number."
        />
      ) : null}

      {filteredUsers.map((entry) => (
        <AdminUserCard
          key={entry.uid}
          user={entry}
          pending={pendingUid === entry.uid}
          isSelf={entry.uid === user?.uid}
          restaurantLinkValue={restaurantLinks[entry.uid] ?? entry.restaurantId ?? ''}
          onAssignRole={handleAssignRole}
          onRevoke={handleRevokeRole}
          onDisable={handleDisableAccess}
          onEnable={handleEnableAccess}
          onDelete={(uid, email) => void handleDeleteAdminAccess(uid, email)}
          onChangeRestaurantLink={handleChangeRestaurantLink}
          onUpdateRestaurantLink={handleUpdateRestaurantLink}
        />
      ))}
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
  searchShell: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 14,
  },
  searchInput: {
    color: adminTheme.text,
    fontSize: 14,
    minHeight: 48,
  },
});
