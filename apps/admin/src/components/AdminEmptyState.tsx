import { StyleSheet, Text, View } from 'react-native';
import { adminTheme } from '../theme/palette';

type AdminEmptyStateProps = {
  body: string;
  title: string;
};

export default function AdminEmptyState({ body, title }: AdminEmptyStateProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  title: {
    color: adminTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  body: {
    color: adminTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
});
