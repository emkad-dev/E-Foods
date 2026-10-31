import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

export type BusyLabelProps = {
  busy: boolean;
  label: string;
  /** Shown instead of `label` while busy, e.g. "Submitting...". */
  busyLabel?: string;
  textStyle?: StyleProp<TextStyle>;
  /** Defaults to the label's own text color, so it reads as part of the button. */
  spinnerColor?: string;
};

/**
 * The label half of a submit/save button: a spinner beside the text while the
 * action is in flight. Drop it inside an existing TouchableOpacity/Pressable in
 * place of its `<Text>` -- the button keeps its own styling and `disabled`
 * wiring, this only adds the visible "it heard you" signal.
 *
 * Plain react-native only (no font loading), so apps that import design-system
 * primitives by module path rather than the barrel (dispatch) can use it too.
 */
export function BusyLabel({ busy, label, busyLabel, textStyle, spinnerColor }: BusyLabelProps) {
  const flattened = StyleSheet.flatten(textStyle);
  const color = spinnerColor ?? (typeof flattened?.color === 'string' ? flattened.color : undefined);

  return (
    <View style={styles.row} accessibilityState={{ busy }}>
      {busy ? <ActivityIndicator size="small" color={color} style={styles.spinner} /> : null}
      <Text style={textStyle}>{busy ? busyLabel ?? label : label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  spinner: {
    marginRight: 8,
  },
});
