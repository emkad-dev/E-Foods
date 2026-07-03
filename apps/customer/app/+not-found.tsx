import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

export default function NotFoundScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>This screen does not exist.</Text>
      <Text style={styles.copy}>Use the link below to get back to the app.</Text>
      <Link href="/home" style={styles.link}>
        Go to home
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#fff',
    flex: 1,
  },
  container: {
    alignItems: 'center',
    backgroundColor: '#fff',
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#222',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  copy: {
    color: '#666',
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  link: {
    color: '#5D3FD3',
    fontSize: 16,
    fontWeight: '600',
  },
});
