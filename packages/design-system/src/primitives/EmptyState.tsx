import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '../tokens/space';
import { Button } from './Button';
import { Text } from './Text';

export type EmptyStateProps = {
  title: string;
  body?: string;
  /** Usually an icon or illustration. */
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * Replaces the hand-rolled empty states scattered per screen.
 *
 * Uses `title1` rather than `display`: an empty state usually sits inside an existing
 * screen with a header already present, so 32pt would compete. Callers wanting a true
 * full-screen hero can override with `variant="display"` on their own Text.
 */
export function EmptyState({ title, body, icon, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.root}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}

      <Text variant="title1" align="center">
        {title}
      </Text>

      {body ? (
        <Text variant="body" tone="secondary" align="center" style={styles.body}>
          {body}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space['2xl'],
    paddingVertical: space['4xl'],
  },
  icon: {
    marginBottom: space.lg,
  },
  body: {
    marginTop: space.sm,
    maxWidth: 320,
  },
  action: {
    marginTop: space['2xl'],
  },
});
