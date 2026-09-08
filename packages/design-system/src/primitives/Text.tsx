import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { typeScale, type TypeVariant } from '../tokens/type';
import { text as textColor } from '../tokens/color';

export type TextTone = keyof typeof textColor;

export type TextProps = RNTextProps & {
  /** One of the 8 type roles. Defaults to `body`. */
  variant?: TypeVariant;
  /** A text color role. Defaults to `primary`. */
  tone?: TextTone;
  align?: 'auto' | 'left' | 'right' | 'center';
};

/**
 * The most important primitive: it is what retires ad-hoc `fontSize`/`fontWeight`
 * across the apps. Every string on screen should render through this.
 */
export function Text({ variant = 'body', tone = 'primary', align, style, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        typeScale[variant],
        { color: textColor[tone] },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
