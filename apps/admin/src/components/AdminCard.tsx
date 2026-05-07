import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { adminTheme } from '../theme/palette';

type AdminCardProps = {
  children: ReactNode;
  subtitle?: string;
  title?: string;
};

export default function AdminCard({ children, subtitle, title }: AdminCardProps) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 18,
    shadowColor: adminTheme.shadow,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 1,
    shadowRadius: 18,
  },
  title: {
    color: adminTheme.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: adminTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
  },
});
