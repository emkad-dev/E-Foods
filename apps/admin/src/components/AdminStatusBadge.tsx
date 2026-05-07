import { StyleSheet, Text, View } from 'react-native';
import { type AdminTone, getAdminToneColors } from '../theme/status';

type AdminStatusBadgeProps = {
  label: string;
  tone: AdminTone;
};

export default function AdminStatusBadge({ label, tone }: AdminStatusBadgeProps) {
  const colors = getAdminToneColors(tone);

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
        },
      ]}
    >
      <Text style={[styles.label, { color: colors.textColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
});
