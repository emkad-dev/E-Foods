import { FontAwesome } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { Card, Text, space } from '@feasty/design-system';
import { customerTheme } from '../../theme/palette';

type ProfileDeliveryCardProps = {
  /** From `formatDeliverySummary` — already carries the no-location copy. */
  title: string;
  subtitle: string | null;
  onPress: () => void;
};

/**
 * Where the food is going.
 *
 * Previously this was a bare "Delivery location ›" row: a chevron with no answer
 * behind it, on the screen a delivery customer opens precisely to check that
 * answer. Showing the current location turns the row into the information it was
 * always pointing at.
 */
export default function ProfileDeliveryCard({
  title,
  subtitle,
  onPress,
}: ProfileDeliveryCardProps) {
  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.row}>
        <View style={styles.copy}>
          {/* The app's established eyebrow recipe (see orders/[id].tsx), minus
              its `fontWeight: '800'`: the type tokens carry per-weight font
              FILES, so setting a weight alongside them makes Android synthesize
              or mis-pick a face. The weight lives in the family name. */}
          <Text variant="caption" style={styles.eyebrow}>
            Delivering to
          </Text>
          <Text variant="title3" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="callout" tone="secondary" numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <FontAwesome color={customerTheme.textSoft} name="angle-right" size={18} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.md,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space.md,
  },
  copy: {
    flex: 1,
    // See ProfileIdentityCard: without this a long address stops truncating on
    // web and pushes the chevron out of the card.
    minWidth: 0,
  },
  eyebrow: {
    color: customerTheme.accentStrong,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: space.xs,
  },
  subtitle: {
    marginTop: space.hair,
  },
});
