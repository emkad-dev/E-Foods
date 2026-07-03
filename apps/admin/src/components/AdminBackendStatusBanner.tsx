import { StyleSheet, Text, View } from 'react-native';
import { adminTheme } from '../theme/palette';
import type { AdminReadSource } from '../services/platformReads';

type AdminBackendStatusBannerProps = {
  source: AdminReadSource;
};

const getBannerCopy = (source: AdminReadSource) => {
  switch (source) {
    case 'live':
      return null;
    case 'cache':
      return 'Live data is unavailable right now. Showing cached admin data.';
    case 'fallback':
      return 'Live data is unavailable. Showing an empty admin snapshot for now.';
    default:
      return null;
  }
};

export default function AdminBackendStatusBanner({ source }: AdminBackendStatusBannerProps) {
  const copy = getBannerCopy(source);

  if (!copy) {
    return null;
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{copy}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: adminTheme.warningSoft,
    borderColor: '#fed7aa',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: {
    color: adminTheme.text,
    fontSize: 13,
    lineHeight: 18,
  },
});
