import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type AuthPromptCardProps = {
  title: string;
  message: string;
};

export default function AuthPromptCard({ title, message }: AuthPromptCardProps) {
  const router = useRouter();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/(auth)/login')}>
          <Text style={styles.secondaryText}>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/(auth)/register')}>
          <Text style={styles.primaryText}>Sign up</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff8ea',
    borderColor: '#f3d8a5',
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
  },
  title: {
    color: '#3b2b0f',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    color: '#6a5630',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 18,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  secondaryButton: {
    borderColor: '#c6aa75',
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  secondaryText: {
    color: '#7a5b23',
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#f5b342',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
