import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function AuthHeaderActions() {
  const { user } = useAuth();
  const router = useRouter();

  if (user) {
    return null;
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/login')}>
        <Text style={styles.secondaryText}>Sign in</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/register')}>
        <Text style={styles.primaryText}>Sign up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    marginRight: 8,
  },
  secondaryButton: {
    borderColor: '#d5b06b',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryText: {
    color: '#7a5b23',
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#f5b342',
    borderRadius: 999,
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
