import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { dispatchTheme } from '../theme/palette';

type CompactOptionPickerProps = {
  disabled?: boolean;
  isOpen: boolean;
  label: string;
  onSelect: (value: string) => void;
  onToggle: () => void;
  options: readonly string[];
  selectedValue: string;
};

export default function CompactOptionPicker({
  disabled = false,
  isOpen,
  label,
  onSelect,
  onToggle,
  options,
  selectedValue,
}: CompactOptionPickerProps) {
  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={[styles.trigger, disabled ? styles.triggerDisabled : null]}
        onPress={onToggle}
        disabled={disabled}
      >
        <View style={styles.triggerCopy}>
          <Text style={styles.triggerLabel}>{label}</Text>
          <Text style={styles.triggerValue} numberOfLines={1}>
            {selectedValue || 'Select an option'}
          </Text>
        </View>
        <Text style={styles.triggerChevron}>{isOpen ? 'Hide' : 'Choose'}</Text>
      </TouchableOpacity>

      {isOpen ? (
        <View style={styles.panel}>
          <ScrollView nestedScrollEnabled style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            {options.map((option) => {
              const selected = option === selectedValue;

              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.option, selected ? styles.optionSelected : null]}
                  onPress={() => onSelect(option)}
                >
                  <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 12,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  triggerDisabled: {
    opacity: 0.55,
  },
  triggerCopy: {
    flex: 1,
    marginRight: 12,
  },
  triggerLabel: {
    color: dispatchTheme.textSoft,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  triggerValue: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '700',
  },
  triggerChevron: {
    color: dispatchTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  panel: {
    backgroundColor: dispatchTheme.surfaceMuted,
    borderColor: dispatchTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 10,
    overflow: 'hidden',
  },
  scrollArea: {
    maxHeight: 176,
  },
  scrollContent: {
    padding: 10,
  },
  option: {
    backgroundColor: dispatchTheme.cream,
    borderRadius: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionSelected: {
    backgroundColor: dispatchTheme.accent,
  },
  optionText: {
    color: dispatchTheme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  optionTextSelected: {
    color: '#ffffff',
  },
});
