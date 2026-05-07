import { StyleSheet, Text, View } from 'react-native';
import { adminTheme } from '../theme/palette';

type AdminScreenHeaderProps = {
  eyebrow?: string;
  subtitle: string;
  title: string;
};

export default function AdminScreenHeader({ eyebrow, subtitle, title }: AdminScreenHeaderProps) {
  return (
    <View>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: adminTheme.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    color: adminTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: adminTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
});
