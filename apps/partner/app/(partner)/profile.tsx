import { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { usePartnerRestaurant } from '../../src/hooks/usePartnerRestaurant';
import { savePartnerRestaurantProfile } from '../../src/services/partnerRestaurantActions';
import { uploadRestaurantAsset } from '../../src/services/restaurantAssetUpload';
import { partnerTheme } from '../../src/theme/palette';

const toNumberOrNull = (value: string) => {
  if (!value.trim()) {
    return null;
  }

  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const INPUT_PLACEHOLDER_COLOR = '#6a7d76';

export default function PartnerProfileScreen() {
  const insets = useSafeAreaInsets();
  const { deleteAccount, linkRestaurant, loading: authLoading, signOut, user } = useAuth();
  const { claimableRestaurants, error, loading, restaurant, restaurants, requiresVerifiedLink } = usePartnerRestaurant();
  const [savingProfile, setSavingProfile] = useState(false);
  const [name, setName] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [image, setImage] = useState('');
  const [logoImage, setLogoImage] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [openingTime, setOpeningTime] = useState('');
  const [closingTime, setClosingTime] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState('');
  const [supportsDelivery, setSupportsDelivery] = useState(true);
  const [supportsPickup, setSupportsPickup] = useState(true);
  const [isOpen, setIsOpen] = useState(true);
  const [isPublished, setIsPublished] = useState(true);

  const sortedRestaurants = [...restaurants].sort((left, right) => left.name.localeCompare(right.name));

  useEffect(() => {
    setName(restaurant?.name ?? user?.displayName ?? '');
    setCuisine(restaurant?.cuisine ?? '');
    setDescription(restaurant?.description ?? '');
    setAddress(restaurant?.address ?? '');
    setImage(restaurant?.image ?? '');
    setLogoImage(restaurant?.logoImage ?? '');
    setDeliveryTime(String(restaurant?.deliveryTime ?? '25-35 min'));
    setOpeningTime(restaurant?.openingTime ?? '08:00');
    setClosingTime(restaurant?.closingTime ?? '22:00');
    setDeliveryFee(
      restaurant?.deliveryFee !== null && restaurant?.deliveryFee !== undefined ? String(restaurant.deliveryFee) : '0'
    );
    setMinOrder(restaurant?.minOrder !== null && restaurant?.minOrder !== undefined ? String(restaurant.minOrder) : '0');
    setLatitude(
      restaurant?.latitude !== null && restaurant?.latitude !== undefined ? String(restaurant.latitude) : ''
    );
    setLongitude(
      restaurant?.longitude !== null && restaurant?.longitude !== undefined ? String(restaurant.longitude) : ''
    );
    setDeliveryRadiusKm(
      restaurant?.deliveryRadiusKm !== null && restaurant?.deliveryRadiusKm !== undefined
        ? String(restaurant.deliveryRadiusKm)
        : '12'
    );
    setSupportsDelivery(restaurant?.supportsDelivery !== false);
    setSupportsPickup(restaurant?.supportsPickup !== false);
    setIsOpen(restaurant?.isOpen !== false);
    setIsPublished(restaurant?.isPublished !== false);
  }, [restaurant, user?.displayName]);

  const handlePickRestaurantAsset = async (kind: 'covers' | 'logos') => {
    if (!user) {
      Alert.alert('Session expired', 'Sign in again before uploading images.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access blocked', 'Allow photo access to upload images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: kind === 'logos' ? [1, 1] : [16, 9],
      mediaTypes: ['images'],
      quality: 0.84,
    });

    if (result.canceled || !result.assets[0]?.uri) {
      return;
    }

    try {
      const publicUrl = await uploadRestaurantAsset({
        kind,
        ownerId: user.uid,
        uri: result.assets[0].uri,
      });

      if (kind === 'logos') {
        setLogoImage(publicUrl);
      } else {
        setImage(publicUrl);
      }
    } catch (nextError: any) {
      Alert.alert('Upload failed', nextError.message ?? 'Unable to upload this image right now.');
    }
  };

  const handleLinkRestaurant = async (restaurantId: string, restaurantName: string) => {
    try {
      await linkRestaurant(restaurantId);
      Alert.alert('Restaurant linked', `${restaurantName} is now connected to this partner account.`);
    } catch (nextError: any) {
      Alert.alert('Link failed', nextError.message ?? 'Unable to link this restaurant right now.');
    }
  };

  const handleSaveProfile = async () => {
    if (!user) {
      Alert.alert('Session expired', 'Sign in again before saving store changes.');
      return;
    }

    if (!name.trim()) {
      Alert.alert('Store name required', 'Add a restaurant name before saving.');
      return;
    }

    setSavingProfile(true);

    try {
      const savedRestaurant = await savePartnerRestaurantProfile({
        restaurantId: user.restaurantId ?? restaurant?.id ?? null,
        userId: user.uid,
        name,
        cuisine,
        description,
        address,
        image,
        logoImage,
        deliveryTime,
        openingTime,
        closingTime,
        deliveryFee: toNumberOrNull(deliveryFee),
        minOrder: toNumberOrNull(minOrder),
        latitude: toNumberOrNull(latitude),
        longitude: toNumberOrNull(longitude),
        deliveryRadiusKm: toNumberOrNull(deliveryRadiusKm),
        isPublished,
        supportsDelivery,
        supportsPickup,
        isOpen,
      });

      if (user.restaurantId !== savedRestaurant.id) {
        await linkRestaurant(savedRestaurant.id);
      }

      Alert.alert(
        user.restaurantId || restaurant?.id ? 'Store updated' : 'Store created',
        `${savedRestaurant.name} is ${isPublished ? 'live for customers' : 'hidden from customers'} and saved for partner menu management.`
      );
    } catch (nextError: any) {
      Alert.alert('Save failed', nextError.message ?? 'Unable to save store details right now.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (nextError: any) {
      Alert.alert('Sign out failed', nextError.message ?? 'Unable to sign out right now.');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete partner account',
      'Partner accounts tied to a restaurant may need admin offboarding instead of self-removal so ownership and order history stay traceable.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
            } catch (nextError: any) {
              Alert.alert('Delete blocked', nextError.message ?? 'Unable to delete this account right now.');
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>Store control</Text>
      <Text style={styles.subtitle}>Run the partner side from one place: your business identity, store setup, publishing state, and linked restaurant record.</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Partner account</Text>
        <Text style={styles.metaLine}>Email: {user?.email ?? 'Not available'}</Text>
        <Text style={styles.metaLine}>Role: {user?.role ?? 'restaurant'}</Text>
        <Text style={styles.metaLine}>Email verified: {user?.emailVerified ? 'Yes' : 'No'}</Text>
        <Text style={styles.metaLine}>Linked restaurant: {user?.restaurantName ?? restaurant?.name ?? 'Not linked yet'}</Text>
        <Text style={styles.metaLine}>Single-device session: {user?.activeSessionId ? 'Active' : 'Idle'}</Text>
      </View>
      {requiresVerifiedLink ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Verified link needed</Text>
          <Text style={styles.warningCopy}>
            We found a restaurant owned by this account, but your partner profile is not explicitly linked yet. Confirm the link below so future access stays pinned to the correct restaurant ID.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Restaurant details</Text>
        <Text style={styles.fieldLabel}>Restaurant name</Text>
        <TextInput
          style={styles.input}
          placeholder="Type the exact restaurant name customers should see"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={name}
          onChangeText={setName}
        />
        <Text style={styles.fieldLabel}>Cuisine</Text>
        <TextInput
          style={styles.input}
          placeholder="Example: Nigerian, Grills, Fast Food"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={cuisine}
          onChangeText={setCuisine}
        />
        <Text style={styles.fieldLabel}>Short description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Tell customers what you serve in one short sentence"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={description}
          onChangeText={setDescription}
          multiline
        />
        <Text style={styles.fieldLabel}>Restaurant address</Text>
        <TextInput
          style={styles.input}
          placeholder="Street, area, city"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={address}
          onChangeText={setAddress}
        />
        <View style={styles.assetGrid}>
          <View style={styles.assetBlock}>
            <View style={styles.logoPreview}>
              {logoImage ? (
                <Image source={{ uri: logoImage }} style={styles.assetImage} />
              ) : (
                <Text style={styles.assetFallbackText}>Logo</Text>
              )}
            </View>
            <TouchableOpacity style={styles.assetButton} onPress={() => handlePickRestaurantAsset('logos')}>
              <Text style={styles.assetButtonText}>{logoImage ? 'Change logo' : 'Upload logo'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.assetBlock}>
            <View style={styles.coverPreview}>
              {image ? (
                <Image source={{ uri: image }} style={styles.assetImage} />
              ) : (
                <Text style={styles.assetFallbackText}>Cover</Text>
              )}
            </View>
            <TouchableOpacity style={styles.assetButton} onPress={() => handlePickRestaurantAsset('covers')}>
              <Text style={styles.assetButtonText}>{image ? 'Change cover' : 'Upload cover'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.fieldLabel}>Delivery time</Text>
        <TextInput
          style={styles.input}
          placeholder="Example: 25-35 min"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={deliveryTime}
          onChangeText={setDeliveryTime}
        />
        <View style={styles.row}>
          <View style={styles.fieldColumn}>
            <Text style={styles.fieldLabel}>Opening time</Text>
            <TextInput
              style={styles.input}
              placeholder="08:00"
              placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
              value={openingTime}
              onChangeText={setOpeningTime}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.fieldColumn}>
            <Text style={styles.fieldLabel}>Closing time</Text>
            <TextInput
              style={styles.input}
              placeholder="22:00"
              placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
              value={closingTime}
              onChangeText={setClosingTime}
              autoCapitalize="none"
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.fieldColumn}>
            <Text style={styles.fieldLabel}>Delivery fee</Text>
            <TextInput
              style={styles.input}
              placeholder="Amount customers pay for delivery"
              placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
              value={deliveryFee}
              onChangeText={setDeliveryFee}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.fieldColumn}>
            <Text style={styles.fieldLabel}>Minimum order</Text>
            <TextInput
              style={styles.input}
              placeholder="Lowest order amount accepted"
              placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
              value={minOrder}
              onChangeText={setMinOrder}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.fieldColumn}>
            <Text style={styles.fieldLabel}>Latitude</Text>
            <TextInput
              style={styles.input}
              placeholder="Optional map latitude"
              placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
              value={latitude}
              onChangeText={setLatitude}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.fieldColumn}>
            <Text style={styles.fieldLabel}>Longitude</Text>
            <TextInput
              style={styles.input}
              placeholder="Optional map longitude"
              placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
              value={longitude}
              onChangeText={setLongitude}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <Text style={styles.fieldLabel}>Delivery radius</Text>
        <TextInput
          style={styles.input}
          placeholder="Maximum delivery distance in km"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={deliveryRadiusKm}
          onChangeText={setDeliveryRadiusKm}
          keyboardType="decimal-pad"
        />

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Supports delivery</Text>
          <Switch
            value={supportsDelivery}
            onValueChange={setSupportsDelivery}
            trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
            thumbColor={supportsDelivery ? partnerTheme.accent : '#f3f4f6'}
          />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Supports pickup</Text>
          <Switch
            value={supportsPickup}
            onValueChange={setSupportsPickup}
            trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
            thumbColor={supportsPickup ? partnerTheme.accent : '#f3f4f6'}
          />
        </View>
        <View style={styles.approvalNotice}>
          <Text style={styles.approvalNoticeTitle}>Self-publish active</Text>
          <Text style={styles.approvalNoticeCopy}>
            Save changes and your restaurant stays visible to customers. Use the visibility switch below if you want to hide it temporarily.
          </Text>
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Visible to customers</Text>
          <Switch
            value={isPublished}
            onValueChange={setIsPublished}
            trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
            thumbColor={isPublished ? partnerTheme.accent : '#f3f4f6'}
          />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Store open now</Text>
          <Switch
            value={isOpen}
            onValueChange={setIsOpen}
            trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
            thumbColor={isOpen ? partnerTheme.accent : '#f3f4f6'}
          />
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleSaveProfile} disabled={savingProfile || loading}>
          <Text style={styles.primaryButtonText}>
            {savingProfile ? 'Saving store...' : user?.restaurantId || restaurant?.id ? 'Save store changes' : 'Create store record'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Current publishing state</Text>
        <Text style={styles.metaLine}>Email: {user?.email ?? 'Not available'}</Text>
        <Text style={styles.metaLine}>Linked restaurant ID: {user?.restaurantId ?? restaurant?.id ?? 'Not linked yet'}</Text>
        <Text style={styles.metaLine}>Link source: {user?.restaurantLinkSource ?? 'Not recorded yet'}</Text>
        <Text style={styles.metaLine}>Link confirmed at: {user?.restaurantLinkedAt ?? 'Not recorded yet'}</Text>
        <Text style={styles.metaLine}>Menu categories: {restaurant?.menu?.length ?? 0}</Text>
        <Text style={styles.metaLine}>
          Listed items: {restaurant?.menu?.reduce((sum, category) => sum + (category.items?.length ?? 0), 0) ?? 0}
        </Text>
        <Text style={styles.metaLine}>Live status: {restaurant?.approvalStatus ?? (restaurant?.isPublished === true ? 'live' : 'hidden')}</Text>
        <Text style={styles.metaLine}>Last live update: {restaurant?.approvedAt ?? 'Not recorded yet'}</Text>
        <Text style={styles.metaLine}>Published to customers: {restaurant?.isPublished === true ? 'Yes' : 'No'}</Text>
        <Text style={styles.metaLine}>Store status: {restaurant?.isOpen === false ? 'Closed' : 'Open'}</Text>
        <Text style={styles.metaLine}>
          Trading hours: {restaurant?.openingTime && restaurant?.closingTime ? `${restaurant.openingTime} - ${restaurant.closingTime}` : 'Not set'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Restaurant linking</Text>
        <Text style={styles.helperText}>
          Claim an unowned restaurant doc, or create a fresh one above and it will link automatically.
        </Text>
        {sortedRestaurants.length === 0 ? (
          <Text style={styles.metaLine}>No restaurant documents are available yet.</Text>
        ) : claimableRestaurants.length === 0 ? (
          <Text style={styles.metaLine}>Every existing restaurant is already managed by another partner account.</Text>
        ) : null}
        {sortedRestaurants.map((candidate) => {
          const isLinked = (user?.restaurantId ?? restaurant?.id) === candidate.id;
          const claimedByAnotherPartner = Boolean(candidate.ownerId && candidate.ownerId !== user?.uid);
          const ownedByThisPartner = Boolean(candidate.ownerId && candidate.ownerId === user?.uid);

          return (
            <View
              key={candidate.id}
              style={[
                styles.restaurantRow,
                isLinked ? styles.restaurantRowActive : null,
                claimedByAnotherPartner ? styles.restaurantRowDisabled : null,
              ]}
            >
              <View style={styles.restaurantMeta}>
                <Text style={styles.restaurantName}>{candidate.name}</Text>
                <Text style={styles.restaurantInfo}>
                  {candidate.cuisine ?? 'Cuisine not set'} | {candidate.address ?? 'Address not set'}
                </Text>
                <Text style={styles.restaurantId}>ID: {candidate.id}</Text>
                <Text style={styles.restaurantId}>
                  Ownership: {claimedByAnotherPartner ? 'Managed by another partner' : ownedByThisPartner ? 'Owned by this account' : 'Available to claim'}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.linkButton, isLinked ? styles.linkButtonActive : null]}
                onPress={() => handleLinkRestaurant(candidate.id, candidate.name)}
                disabled={loading || isLinked || claimedByAnotherPartner}
              >
                <Text style={[styles.linkButtonText, isLinked ? styles.linkButtonTextActive : null]}>
                  {isLinked ? 'Linked' : claimedByAnotherPartner ? 'Unavailable' : 'Claim'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account access</Text>
        <Text style={styles.helperText}>
          Sign out when you are done on this device. If you want this partner account removed entirely, use delete. The backend will block self-removal when admin-controlled business records are still attached.
        </Text>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleSignOut}
          disabled={loading || savingProfile || authLoading}
        >
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeleteAccount}
          disabled={loading || savingProfile || authLoading}
        >
          <Text style={styles.deleteButtonText}>Delete account</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    paddingBottom: 30,
    paddingHorizontal: 18,
  },
  title: {
    color: partnerTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 13,
    marginTop: 12,
  },
  warningCard: {
    backgroundColor: partnerTheme.warningSoft,
    borderColor: '#efcf96',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  warningTitle: {
    color: partnerTheme.warning,
    fontSize: 15,
    fontWeight: '800',
  },
  warningCopy: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  cardTitle: {
    color: partnerTheme.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  input: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 14,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  fieldColumn: {
    flex: 1,
  },
  fieldLabel: {
    color: partnerTheme.text,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 12,
  },
  textArea: {
    minHeight: 98,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  halfInput: {
    flex: 1,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  toggleLabel: {
    color: partnerTheme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 16,
    marginTop: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  metaLine: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 4,
  },
  helperText: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
  },
  approvalNotice: {
    backgroundColor: partnerTheme.warningSoft,
    borderColor: '#efcf96',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
  },
  approvalNoticeTitle: {
    color: partnerTheme.warning,
    fontSize: 14,
    fontWeight: '800',
  },
  approvalNoticeCopy: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  assetBlock: {
    flex: 1,
  },
  assetButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 14,
    marginTop: 10,
    paddingVertical: 12,
  },
  assetButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  assetFallbackText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  assetGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  assetImage: {
    height: '100%',
    width: '100%',
  },
  coverPreview: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 86,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoPreview: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 86,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  restaurantRow: {
    alignItems: 'center',
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    padding: 14,
  },
  restaurantRowActive: {
    backgroundColor: partnerTheme.accentSoft,
    borderColor: partnerTheme.accent,
  },
  restaurantRowDisabled: {
    opacity: 0.55,
  },
  restaurantMeta: {
    flex: 1,
  },
  restaurantName: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  restaurantInfo: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  restaurantId: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    marginTop: 6,
  },
  linkButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 12,
    minWidth: 74,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  linkButtonActive: {
    backgroundColor: partnerTheme.accent,
  },
  linkButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  linkButtonTextActive: {
    color: '#ffffff',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accentStrong,
    borderRadius: 16,
    marginTop: 8,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  deleteButton: {
    alignItems: 'center',
    borderColor: partnerTheme.danger,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 14,
  },
  deleteButtonText: {
    color: partnerTheme.danger,
    fontSize: 15,
    fontWeight: '800',
  },
});
