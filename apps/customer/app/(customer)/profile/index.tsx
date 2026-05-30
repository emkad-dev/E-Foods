import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import AuthPromptCard from '../../../src/components/AuthPromptCard';
import { useAuth } from '../../../src/contexts/AuthContext';
import { customerTheme } from '../../../src/theme/palette';

type ProfileRowProps = {
  destructive?: boolean;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  label: string;
  onPress?: () => void;
  value?: string;
};

function ProfileRow({ destructive = false, icon, label, onPress, value }: ProfileRowProps) {
  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.85 : 1}
      disabled={!onPress}
      onPress={onPress}
      style={styles.row}
    >
      <View style={[styles.rowIconWrap, destructive ? styles.rowIconWrapDanger : null]}>
        <FontAwesome
          color={destructive ? customerTheme.danger : customerTheme.text}
          name={icon}
          size={16}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, destructive ? styles.rowLabelDanger : null]}>{label}</Text>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      </View>
      {onPress ? (
        <FontAwesome
          color={destructive ? customerTheme.danger : customerTheme.textSoft}
          name="angle-right"
          size={18}
        />
      ) : null}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { deleteAccount, loading, signOut, updateDisplayName, user } = useAuth();
  const [usernameDraft, setUsernameDraft] = useState('');

  useEffect(() => {
    setUsernameDraft(user?.displayName?.trim() ?? '');
  }, [user?.displayName]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      Alert.alert('Error', 'Failed to sign out');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This removes your customer sign-in and profile from the app. Order history already tied to past orders can still remain in operations records.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
            } catch (nextError: any) {
              Alert.alert('Delete failed', nextError.message ?? 'Unable to delete this account right now.');
            }
          },
        },
      ]
    );
  };

  const handleSaveUsername = async () => {
    const nextUsername = usernameDraft.trim();

    if (!nextUsername) {
      Alert.alert('Username required', 'Add the name you want the app to greet you with.');
      return;
    }

    if (nextUsername === user?.displayName?.trim()) {
      return;
    }

    try {
      await updateDisplayName(nextUsername);
      Alert.alert('Username saved', 'Your customer greeting has been updated.');
    } catch (nextError: any) {
      Alert.alert('Save failed', nextError.message ?? 'Unable to update username right now.');
    }
  };

  if (!user) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.guestContainer}>
        <AuthPromptCard
          title="Sign in to manage your account"
          message="Keep addresses, order recovery, and customer account controls in one place."
        />
      </ScrollView>
    );
  }

  const initials = (user.displayName?.trim() || user.email?.trim() || 'U').slice(0, 1).toUpperCase();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.heroCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>{user.displayName ?? 'Customer account'}</Text>
          <Text style={styles.heroMeta}>{user.email}</Text>
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.groupTitle}>Orders and delivery</Text>
        <ProfileRow icon="shopping-bag" label="Order history" onPress={() => router.push('/(customer)/orders')} />
        <ProfileRow icon="map-marker" label="Delivery location" onPress={() => router.push('/(customer)/delivery-location')} />
      </View>

      <View style={styles.group}>
        <Text style={styles.groupTitle}>Account</Text>
        <View style={styles.usernameRow}>
          <Text style={styles.usernameLabel}>Username</Text>
          <View style={styles.usernameInputRow}>
            <TextInput
              style={styles.usernameInput}
              value={usernameDraft}
              onChangeText={setUsernameDraft}
              placeholder="Add username"
              placeholderTextColor={customerTheme.textMuted}
              editable={!loading}
              maxLength={24}
            />
            <TouchableOpacity
              style={[
                styles.usernameSaveButton,
                !usernameDraft.trim() || usernameDraft.trim() === user.displayName?.trim()
                  ? styles.usernameSaveButtonDisabled
                  : null,
              ]}
              onPress={handleSaveUsername}
              disabled={loading || !usernameDraft.trim() || usernameDraft.trim() === user.displayName?.trim()}
            >
              <Text style={styles.usernameSaveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ProfileRow icon="user-o" label="Email" value={user.email} />
        <ProfileRow icon="check-circle-o" label="Email verified" value={user.emailVerified ? 'Yes' : 'No'} />
        <ProfileRow icon="mobile" label="Session" value={user.activeSessionId ? 'Active on this device' : 'Idle'} />
      </View>

      <View style={styles.group}>
        <Text style={styles.groupTitle}>Access</Text>
        <ProfileRow icon="sign-out" label={loading ? 'Working...' : 'Sign out'} onPress={handleSignOut} />
        <ProfileRow destructive icon="trash-o" label="Delete my account and data" onPress={handleDeleteAccount} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  container: {
    padding: 14,
    paddingBottom: 28,
  },
  guestContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  heroCard: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 16,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  heroCopy: {
    flex: 1,
    marginLeft: 12,
  },
  heroTitle: {
    color: customerTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  heroMeta: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  group: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    overflow: 'hidden',
  },
  groupTitle: {
    color: customerTheme.textSoft,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    paddingHorizontal: 14,
    paddingTop: 14,
    textTransform: 'uppercase',
  },
  usernameRow: {
    borderTopColor: customerTheme.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  usernameLabel: {
    color: customerTheme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  usernameInputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 10,
  },
  usernameInput: {
    backgroundColor: customerTheme.surfaceStrong,
    borderColor: customerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    color: customerTheme.text,
    flex: 1,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  usernameSaveButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 14,
    marginLeft: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  usernameSaveButtonDisabled: {
    opacity: 0.45,
  },
  usernameSaveText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  row: {
    alignItems: 'center',
    borderTopColor: customerTheme.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowIconWrap: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  rowIconWrapDanger: {
    backgroundColor: customerTheme.dangerSoft,
  },
  rowCopy: {
    flex: 1,
    marginLeft: 12,
    marginRight: 10,
  },
  rowLabel: {
    color: customerTheme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  rowLabelDanger: {
    color: customerTheme.danger,
  },
  rowValue: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
});
