import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AdminCard from '../../src/components/AdminCard';
import AdminEmptyState from '../../src/components/AdminEmptyState';
import AdminScreenHeader from '../../src/components/AdminScreenHeader';
import AdminStatusBadge from '../../src/components/AdminStatusBadge';
import { useAuth } from '../../src/contexts/AuthContext';
import type { AppRole, UserDocument } from '../../src/domain/entities';
import {
  assignUserRole,
  disableUserAccess,
  enableUserAccess,
  provisionStaffAccount,
  revokeUserRole,
  updateUserRestaurantLink,
} from '../../src/services/accessManagement';
import { getAdminAccessOverview } from '../../src/services/platformReads';
import { adminTheme } from '../../src/theme/palette';
import { getRoleTone } from '../../src/theme/status';

const describeRole = (role: UserDocument['role']) => {
  switch (role) {
    case 'restaurant':
      return 'Partner';
    case 'dispatch':
      return 'Dispatch';
    case 'customer':
      return 'Customer';
    case 'admin':
      return 'Admin';
    default:
      return role;
  }
};

export default function AdminAccessScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [users, setUsers] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionEmail, setProvisionEmail] = useState('');
  const [provisionPassword, setProvisionPassword] = useState('');
  const [provisionName, setProvisionName] = useState('');
  const [provisionRestaurantId, setProvisionRestaurantId] = useState('');
  const [provisionRole, setProvisionRole] = useState<Extract<AppRole, 'restaurant' | 'dispatch' | 'admin'>>('restaurant');
  const [restaurantLinks, setRestaurantLinks] = useState<Record<string, string>>({});

  const loadAccessOverview = async (cancelled = false) => {
    try {
      const nextData = await getAdminAccessOverview();

      if (cancelled) {
        return;
      }

      setUsers(nextData.users);
      setRestaurantLinks((current) => {
        const nextLinks = { ...current };

        for (const entry of nextData.users) {
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

      console.error('Error loading admin access view:', nextError);
      setError(nextError.message ?? 'Unable to load account access right now.');
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

  const opsUsers = useMemo(
    () =>
      [...users]
        .filter((entry) => entry.role !== 'customer' || entry.accountDisabled === true)
        .sort((left, right) => {
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

  const handleProvisionStaff = async () => {
    if (!provisionEmail.trim() || !provisionPassword.trim()) {
      Alert.alert('Missing details', 'Enter a staff email and password before provisioning the account.');
      return;
    }

    setProvisioning(true);

    try {
      const result = await provisionStaffAccount({
        displayName: provisionName.trim() || undefined,
        email: provisionEmail.trim(),
        password: provisionPassword,
        restaurantId:
          ['restaurant', 'dispatch'].includes(provisionRole) && provisionRestaurantId.trim()
            ? provisionRestaurantId.trim()
            : undefined,
        role: provisionRole,
      });

      Alert.alert(
        result.created ? 'Staff account created' : 'Staff account updated',
        `${result.email} now has ${describeRole(result.role)} access.`
      );
      setProvisionEmail('');
      setProvisionPassword('');
      setProvisionName('');
      setProvisionRestaurantId('');
      setProvisionRole('restaurant');
      await loadAccessOverview();
    } catch (nextError: any) {
      Alert.alert('Provisioning failed', nextError.message ?? 'Unable to provision this staff account right now.');
    } finally {
      setProvisioning(false);
    }
  };

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
        eyebrow="Access"
        title="Access overview"
        subtitle="Review internal accounts, partner ownership links, and which sessions are currently active on-device."
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <AdminCard>
          <ActivityIndicator size="large" color={adminTheme.accent} />
          <Text style={styles.loadingText}>Loading access records...</Text>
        </AdminCard>
      ) : null}

      <AdminCard
        title="Provision sandbox staff"
        subtitle="Create partner, dispatch, or extra admin accounts directly from the sandbox without falling back to manual console setup."
      >
        <TextInput
          style={styles.input}
          placeholder="Display name"
          placeholderTextColor={adminTheme.textMuted}
          value={provisionName}
          onChangeText={setProvisionName}
          editable={!provisioning}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={adminTheme.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          value={provisionEmail}
          onChangeText={setProvisionEmail}
          editable={!provisioning}
        />
        <TextInput
          style={styles.input}
          placeholder="Temporary password"
          placeholderTextColor={adminTheme.textMuted}
          secureTextEntry
          value={provisionPassword}
          onChangeText={setProvisionPassword}
          editable={!provisioning}
        />
        <View style={styles.roleRow}>
          {(['restaurant', 'dispatch', 'admin'] as const).map((role) => (
            <TouchableOpacity
              key={role}
              style={[styles.roleOption, provisionRole === role ? styles.roleOptionActive : null]}
              onPress={() => setProvisionRole(role)}
              disabled={provisioning}
            >
              <Text style={[styles.roleOptionText, provisionRole === role ? styles.roleOptionTextActive : null]}>
                {describeRole(role)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.input}
          placeholder="Restaurant ID (optional)"
          placeholderTextColor={adminTheme.textMuted}
          value={provisionRestaurantId}
          onChangeText={setProvisionRestaurantId}
          editable={!provisioning}
        />
        <TouchableOpacity style={styles.primaryAction} onPress={handleProvisionStaff} disabled={provisioning}>
          <Text style={styles.primaryActionText}>{provisioning ? 'Provisioning...' : 'Provision staff account'}</Text>
        </TouchableOpacity>
      </AdminCard>

      {!loading && opsUsers.length === 0 ? (
        <AdminEmptyState
          title="No internal accounts found"
          body="Approved admin, partner, and dispatch accounts will appear here once they exist in the users collection."
        />
      ) : null}

      {opsUsers.map((entry) => (
        <AdminCard key={entry.uid}>
          <View style={styles.headerRow}>
            <View style={styles.headerMeta}>
              <Text style={styles.name}>{entry.displayName ?? entry.email ?? 'Unnamed account'}</Text>
              <Text style={styles.email}>{entry.email}</Text>
            </View>
            <AdminStatusBadge label={describeRole(entry.role)} tone={getRoleTone(entry.role)} />
            {entry.accountDisabled ? <AdminStatusBadge label="Disabled" tone="danger" /> : null}
          </View>

          <Text style={styles.detailLine}>UID: {entry.uid}</Text>
          <Text style={styles.detailLine}>Verified email: {entry.emailVerified ? 'Yes' : 'No'}</Text>
          <Text style={styles.detailLine}>Sign-in disabled: {entry.accountDisabled ? 'Yes' : 'No'}</Text>
          <Text style={styles.detailLine}>Last privileged role: {entry.lastPrivilegedRole ?? 'Not recorded'}</Text>
          <Text style={styles.detailLine}>Disabled at: {entry.disabledAt ?? 'Not disabled'}</Text>
          <Text style={styles.detailLine}>Restaurant link: {entry.restaurantId ?? 'Not linked'}</Text>
          <Text style={styles.detailLine}>Single-device session: {entry.activeSessionId ? 'Active' : 'Idle'}</Text>
          <Text style={styles.detailLine}>Last session update: {entry.activeSessionUpdatedAt ?? 'Not recorded'}</Text>
          <Text style={styles.detailLine}>Created: {entry.createdAt}</Text>

          <View style={styles.actionWrap}>
            {(['admin', 'restaurant', 'dispatch'] as const).map((role) => (
              <TouchableOpacity
                key={role}
                style={[
                  styles.inlineAction,
                  entry.role === role ? styles.inlineActionActive : null,
                  pendingUid === entry.uid || entry.accountDisabled ? styles.inlineActionDisabled : null,
                ]}
                onPress={() =>
                  handleAssignRole(
                    entry.uid,
                    role,
                    ['restaurant', 'dispatch'].includes(role) ? restaurantLinks[entry.uid] ?? entry.restaurantId ?? null : null
                  )
                }
                disabled={pendingUid === entry.uid || entry.accountDisabled}
              >
                <Text style={[styles.inlineActionText, entry.role === role ? styles.inlineActionTextActive : null]}>
                  {entry.role === role ? `Current: ${describeRole(role)}` : `Make ${describeRole(role)}`}
                </Text>
              </TouchableOpacity>
            ))}
            {['restaurant', 'dispatch'].includes(entry.role) ? (
              <View style={styles.linkBlock}>
                <TextInput
                  style={styles.input}
                  placeholder="Restaurant ID for this account"
                  placeholderTextColor={adminTheme.textMuted}
                  value={restaurantLinks[entry.uid] ?? entry.restaurantId ?? ''}
                  onChangeText={(value) =>
                    setRestaurantLinks((current) => ({
                      ...current,
                      [entry.uid]: value,
                    }))
                  }
                  editable={pendingUid !== entry.uid && !entry.accountDisabled}
                />
                <TouchableOpacity
                  style={[
                    styles.inlineAction,
                    pendingUid === entry.uid || entry.accountDisabled ? styles.inlineActionDisabled : null,
                  ]}
                  onPress={() => handleUpdateRestaurantLink(entry.uid)}
                  disabled={pendingUid === entry.uid || entry.accountDisabled}
                >
                  <Text style={styles.inlineActionText}>Save restaurant link</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity
              style={[
                styles.inlineDanger,
                pendingUid === entry.uid || entry.uid === user?.uid || entry.accountDisabled ? styles.inlineActionDisabled : null,
              ]}
              onPress={() => handleRevokeRole(entry.uid)}
              disabled={pendingUid === entry.uid || entry.uid === user?.uid || entry.accountDisabled}
            >
              <Text style={styles.inlineDangerText}>
                {entry.uid === user?.uid ? 'Signed-in admin' : 'Revert to Customer'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.inlineDanger,
                pendingUid === entry.uid || entry.uid === user?.uid || entry.accountDisabled
                  ? styles.inlineActionDisabled
                  : null,
              ]}
              onPress={() => handleDisableAccess(entry.uid)}
              disabled={pendingUid === entry.uid || entry.uid === user?.uid || entry.accountDisabled}
            >
              <Text style={styles.inlineDangerText}>
                {entry.accountDisabled ? 'Access disabled' : entry.uid === user?.uid ? 'Signed-in admin' : 'Disable sign-in'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.inlineAction,
                entry.accountDisabled ? styles.inlineActionActive : null,
                pendingUid === entry.uid || !entry.accountDisabled ? styles.inlineActionDisabled : null,
              ]}
              onPress={() => handleEnableAccess(entry.uid)}
              disabled={pendingUid === entry.uid || !entry.accountDisabled}
            >
              <Text
                style={[
                  styles.inlineActionText,
                  entry.accountDisabled ? styles.inlineActionTextActive : null,
                ]}
              >
                {entry.accountDisabled ? 'Restore last access' : 'Active'}
              </Text>
            </TouchableOpacity>
          </View>
        </AdminCard>
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
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  headerMeta: {
    flex: 1,
  },
  name: {
    color: adminTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  email: {
    color: adminTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  detailLine: {
    color: adminTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
  },
  input: {
    backgroundColor: adminTheme.cream,
    borderColor: adminTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    color: adminTheme.text,
    fontSize: 14,
    marginTop: 10,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  roleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  roleOption: {
    backgroundColor: adminTheme.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  roleOptionActive: {
    backgroundColor: adminTheme.accent,
  },
  roleOptionText: {
    color: adminTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  roleOptionTextActive: {
    color: '#ffffff',
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: adminTheme.accent,
    borderRadius: 14,
    marginTop: 16,
    paddingVertical: 14,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  actionWrap: {
    gap: 10,
    marginTop: 14,
  },
  linkBlock: {
    gap: 10,
    marginTop: 2,
  },
  inlineAction: {
    backgroundColor: adminTheme.surfaceMuted,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inlineActionActive: {
    backgroundColor: adminTheme.accentSoft,
  },
  inlineActionDisabled: {
    opacity: 0.55,
  },
  inlineActionText: {
    color: adminTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  inlineActionTextActive: {
    color: adminTheme.accentStrong,
  },
  inlineDanger: {
    backgroundColor: adminTheme.dangerSoft,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inlineDangerText: {
    color: adminTheme.danger,
    fontSize: 13,
    fontWeight: '800',
  },
});
