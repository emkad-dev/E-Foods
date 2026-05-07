import React from 'react';
import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AuthPromptCard from '../../../src/components/AuthPromptCard';
import { useAuth } from '../../../src/contexts/AuthContext';
import { customerTheme } from '../../../src/theme/palette';

export default function ProfileScreen() {
  const { deleteAccount, loading, signOut, user } = useAuth();

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Customer account</Text>
        <Text style={styles.title}>{user.displayName ?? 'Your E-Foods profile'}</Text>
        <Text style={styles.copy}>
          Keep your customer identity, saved delivery flow, and order follow-up actions together here.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account details</Text>
        <Text style={styles.metaLine}>Email: {user.email}</Text>
        <Text style={styles.metaLine}>Role: customer</Text>
        <Text style={styles.metaLine}>Email verified: {user.emailVerified ? 'Yes' : 'No'}</Text>
        <Text style={styles.metaLine}>Single-device session: {user.activeSessionId ? 'Active' : 'Idle'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quick actions</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/(customer)/orders')}>
          <Text style={styles.secondaryButtonText}>View order history</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/(customer)/delivery-location')}>
          <Text style={styles.secondaryButtonText}>Manage delivery location</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Session</Text>
        <Text style={styles.copyMuted}>Use sign out when you’re done on this device. Use delete only if you want this customer account removed from the app.</Text>
        <TouchableOpacity style={styles.button} onPress={handleSignOut} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Working...' : 'Sign out'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteAccount} disabled={loading}>
          <Text style={styles.deleteButtonText}>Delete account</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.background, flex: 1 },
  container: { padding: 20, paddingBottom: 30 },
  guestContainer: { flex: 1, justifyContent: 'center', padding: 20 },
  heroCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  eyebrow: {
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    color: customerTheme.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 10,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  copyMuted: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 14,
  },
  card: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  cardTitle: {
    color: customerTheme.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  metaLine: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  secondaryButton: {
    borderColor: customerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: customerTheme.text,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  button: {
    backgroundColor: customerTheme.accent,
    borderRadius: 14,
    padding: 15,
    width: '100%',
  },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: 'bold' },
  deleteButton: {
    borderColor: customerTheme.danger,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    padding: 15,
    width: '100%',
  },
  deleteButtonText: {
    color: customerTheme.danger,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
});
