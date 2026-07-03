import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { getAdminToneColors, type AdminTone } from '../theme/status';

type ActionPillProps = {
  disabled?: boolean;
  filled?: boolean;
  label: string;
  onPress: () => void;
  tone: AdminTone;
};

export default function ActionPill({ disabled = false, filled = false, label, onPress, tone }: ActionPillProps) {
  const toneColors = getAdminToneColors(tone);

  return (
    <TouchableOpacity
      style={[
        styles.actionPill,
        filled
          ? { backgroundColor: toneColors.textColor, borderColor: toneColors.textColor }
          : { backgroundColor: toneColors.backgroundColor, borderColor: toneColors.borderColor },
        disabled ? styles.actionPillDisabled : null,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.actionPillText, { color: filled ? '#ffffff' : toneColors.textColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  actionPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionPillDisabled: {
    opacity: 0.5,
  },
  actionPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
});
