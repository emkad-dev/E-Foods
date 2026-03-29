import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../../src/contexts/AuthContext';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      Alert.alert('Error', 'Failed to sign out');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.email}>{user?.email}</Text>
      <TouchableOpacity style={styles.button} onPress={handleSignOut}>
        <Text style={styles.buttonText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  email: { fontSize: 18, marginBottom: 30 },
  button: { backgroundColor: '#f5b342', padding: 15, borderRadius: 8, width: '100%' },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: 'bold' },
});
