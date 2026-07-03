import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppRole, UserDocument } from '../domain/entities';
import { adminTheme } from '../theme/palette';
import { getRoleTone } from '../theme/status';
import ActionPill from './ActionPill';
import AdminCard from './AdminCard';
import AdminStatusBadge from './AdminStatusBadge';

export const describeRole = (role: UserDocument['role']): string => {
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

type AdminUserCardProps = {
  user: UserDocument;
  pending: boolean;
  isSelf?: boolean;
  restaurantLinkValue: string;
  onAssignRole: (uid: string, role: AppRole, restaurantId?: string | null) => void;
  onRevoke: (uid: string) => void;
  onDisable: (uid: string) => void;
  onEnable: (uid: string) => void;
  onDelete: (uid: string, email: string) => void;
  onChangeRestaurantLink: (uid: string, value: string) => void;
  onUpdateRestaurantLink: (uid: string) => void;
};

export default function AdminUserCard({
  user,
  pending,
  isSelf = false,
  restaurantLinkValue,
  onAssignRole,
  onRevoke,
  onDisable,
  onEnable,
  onDelete,
  onChangeRestaurantLink,
  onUpdateRestaurantLink,
}: AdminUserCardProps) {
  const isLinkedRole = user.role === 'restaurant' || user.role === 'dispatch';

  return (
    <AdminCard>
      <View style={styles.headerRow}>
        <View style={styles.headerMeta}>
          <Text style={styles.name}>{user.displayName ?? user.email ?? 'Unnamed account'}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>
        <AdminStatusBadge label={describeRole(user.role)} tone={getRoleTone(user.role)} />
        {user.accountDisabled ? <AdminStatusBadge label="Disabled" tone="danger" /> : null}
      </View>

      <Text style={styles.detailLine}>Phone: {user.phoneNumber ?? 'Not provided'}</Text>
      <Text style={styles.detailLine}>
        Status: {user.accountDisabled ? 'Sign-in disabled' : 'Active'} ·{' '}
        {user.activeSessionId ? 'Session active' : 'Session idle'}
      </Text>

      <View style={styles.actionWrap}>
        <View style={styles.pillRow}>
          {(['admin', 'restaurant', 'dispatch'] as const).map((role) => (
            <ActionPill
              key={role}
              tone={getRoleTone(role)}
              filled={user.role === role}
              disabled={pending || user.accountDisabled || user.role === role}
              label={user.role === role ? `Current: ${describeRole(role)}` : `Make ${describeRole(role)}`}
              onPress={() =>
                onAssignRole(
                  user.uid,
                  role,
                  role === 'restaurant' || role === 'dispatch' ? restaurantLinkValue || user.restaurantId || null : null
                )
              }
            />
          ))}
          <ActionPill
            tone="warning"
            disabled={pending || isSelf || user.accountDisabled || user.role === 'customer'}
            label={isSelf ? 'Signed-in admin' : 'Revert to Customer'}
            onPress={() => onRevoke(user.uid)}
          />
          {user.accountDisabled ? (
            <ActionPill tone="success" disabled={pending} label="Enable" onPress={() => onEnable(user.uid)} />
          ) : (
            <ActionPill
              tone="danger"
              disabled={pending || isSelf}
              label={isSelf ? 'Signed-in admin' : 'Disable'}
              onPress={() => onDisable(user.uid)}
            />
          )}
          {user.role === 'admin' && !isSelf ? (
            <ActionPill
              tone="danger"
              filled
              disabled={pending}
              label="Delete"
              onPress={() => onDelete(user.uid, user.email)}
            />
          ) : null}
        </View>

        {isLinkedRole ? (
          <View style={styles.linkBlock}>
            <TextInput
              style={styles.input}
              placeholder="Restaurant ID for this account"
              placeholderTextColor={adminTheme.textMuted}
              value={restaurantLinkValue}
              onChangeText={(value) => onChangeRestaurantLink(user.uid, value)}
              editable={!pending && !user.accountDisabled}
            />
            <ActionPill
              tone="primary"
              disabled={pending || user.accountDisabled}
              label="Save restaurant link"
              onPress={() => onUpdateRestaurantLink(user.uid)}
            />
          </View>
        ) : null}
      </View>
    </AdminCard>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
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
  actionWrap: {
    gap: 12,
    marginTop: 14,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  linkBlock: {
    gap: 10,
    marginTop: 2,
  },
});
