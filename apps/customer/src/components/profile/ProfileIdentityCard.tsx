import { StyleSheet, View } from 'react-native';
import { Button, Card, Text, brand, radius, space } from '@feasty/design-system';

type ProfileIdentityCardProps = {
  /** 1–2 letters from `getProfileInitials`. */
  initials: string;
  name: string;
  email: string;
  onEdit: () => void;
};

/**
 * Who you are signed in as, plus the one control that changes it.
 *
 * The avatar is not decoration. The `profile` loading skeleton has always drawn a
 * 56pt circle beside the name (`LoadingSkeleton.tsx`, mode `'profile'`) while the
 * real screen rendered a copy block alone, so the placeholder and the content
 * disagreed and every load ended in a visible horizontal jump. Matching the
 * skeleton is the point of the size.
 */
export default function ProfileIdentityCard({
  initials,
  name,
  email,
  onEdit,
}: ProfileIdentityCardProps) {
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text variant="title2" style={styles.initials}>
            {initials}
          </Text>
        </View>

        {/* `minWidth: 0` is load-bearing on web, where a flex child defaults to
            `min-width: auto` and a long address refuses to shrink — without it
            the email pushes the Edit button off the right edge at 375pt instead
            of ellipsising. */}
        <View style={styles.copy}>
          <Text variant="title3" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="callout" tone="secondary" numberOfLines={1} style={styles.email}>
            {email}
          </Text>
        </View>

        <Button label="Edit" variant="secondary" size="sm" onPress={onEdit} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space.md,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: brand.primarySoft,
    borderRadius: radius.pill,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  initials: {
    // Not a `tone`: the token layer has no text role for "brand green on the
    // soft brand fill". 14.0:1 on `brand.primarySoft`.
    color: brand.primaryStrong,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  email: {
    marginTop: space.hair,
  },
});
