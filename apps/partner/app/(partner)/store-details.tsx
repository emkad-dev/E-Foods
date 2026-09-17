/**
 * Store setup: one form, one Save, one validation model.
 *
 * Split out of the Store tab, which was eleven jobs in one scroll. Everything
 * here is written by a single `upsertPartnerRestaurantProfile` call, which is
 * the seam: identity, photos, commerce settings, map location, fulfilment modes
 * and visibility all round-trip together, so they are edited together and are
 * the only things on this screen. The one control with its own RPC - pausing -
 * stays on the Store tab where it can be reached mid-service.
 *
 * Reached from the Store tab rather than the tab bar. Partner already has four
 * tabs and this is the screen a partner opens once at setup and rarely again;
 * spending a fifth tab on it would push the mid-service controls further away,
 * which is the problem this split exists to fix.
 */
import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import {
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius, useNotice } from '@feasty/design-system';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import {
  draftFromStore,
  hasStoreSetupErrors,
  toNumberOrNull,
  validateStoreSetup,
  type StoreSetupErrors,
  type StoreSetupFieldKey,
} from '../../src/domain/storeSetupForm';
import { useAuth } from '../../src/contexts/AuthContext';
import { usePartnerRestaurant } from '../../src/hooks/usePartnerRestaurant';
import { useSeededField } from '../../src/hooks/useSeededField';
import { savePartnerRestaurantProfile } from '../../src/services/partnerRestaurantActions';
import { uploadRestaurantAsset } from '../../src/services/restaurantAssetUpload';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT, SCREEN_TOP_INSET } from '../../src/theme/screenChrome';

/**
 * Was the literal `#6a7d76`, which `src/theme/palette.ts` documents in its own
 * header as the REJECTED value: 4.04:1, under the 4.5:1 AA bar. Every
 * placeholder on the screen carried the pre-fix colour. `textSoft` resolves to
 * the corrected `text.secondary`, and placeholders now carry more weight than
 * they used to - fields no longer come pre-filled with invented values, so the
 * placeholder is often the only hint of what belongs in an empty field.
 */
const PLACEHOLDER_COLOR = partnerTheme.textSoft;

function FieldError({ message }: { message: string | undefined }) {
  if (!message) {
    return null;
  }

  // Sits directly under the field it explains, so the red border and the reason
  // for it are read together. These messages used to sit in an `Alert.alert`,
  // which is inert on the web build, leaving the border as the whole
  // explanation.
  return (
    <Text accessibilityLiveRegion="polite" role="alert" style={styles.fieldErrorText}>
      {message}
    </Text>
  );
}

export default function StoreDetailsScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { linkRestaurant, user } = useAuth();
  const { error, loading, restaurant } = usePartnerRestaurant();
  const { notice, showNotice } = useNotice({
    placement: 'floating',
    offsetBottom: width >= 1024 ? insets.bottom + 16 : insets.bottom + 86,
  });

  // The SAVED values, with nothing invented for a field the record does not
  // hold - see storeSetupForm.ts. Each one seeds its own draft field, and only
  // its own: a single effect over the whole `restaurant` object discarded
  // in-progress typing every time a realtime broadcast replaced it.
  const saved = draftFromStore(restaurant);

  const [name, setName] = useSeededField(saved.name);
  const [cuisine, setCuisine] = useSeededField(saved.cuisine);
  const [description, setDescription] = useSeededField(saved.description);
  const [address, setAddress] = useSeededField(saved.address);
  const [image, setImage] = useSeededField(saved.image);
  const [logoImage, setLogoImage] = useSeededField(saved.logoImage);
  const [deliveryTime, setDeliveryTime] = useSeededField(saved.deliveryTime);
  const [openingTime, setOpeningTime] = useSeededField(saved.openingTime);
  const [closingTime, setClosingTime] = useSeededField(saved.closingTime);
  const [deliveryFee, setDeliveryFee] = useSeededField(saved.deliveryFee);
  const [minOrder, setMinOrder] = useSeededField(saved.minOrder);
  const [latitude, setLatitude] = useSeededField(saved.latitude);
  const [longitude, setLongitude] = useSeededField(saved.longitude);
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useSeededField(saved.deliveryRadiusKm);
  const [supportsDelivery, setSupportsDelivery] = useSeededField(saved.supportsDelivery);
  const [supportsPickup, setSupportsPickup] = useSeededField(saved.supportsPickup);
  const [isPublished, setIsPublished] = useSeededField(saved.isPublished);
  const [isOpen, setIsOpen] = useSeededField(saved.isOpen);

  const [savingProfile, setSavingProfile] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<StoreSetupErrors>({});

  const draft = {
    name,
    cuisine,
    description,
    address,
    image,
    logoImage,
    deliveryTime,
    openingTime,
    closingTime,
    deliveryFee,
    minOrder,
    latitude,
    longitude,
    deliveryRadiusKm,
    supportsDelivery,
    supportsPickup,
    isPublished,
    isOpen,
  };

  const clearFieldError = (field: StoreSetupFieldKey) => {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleFieldChange =
    (field: StoreSetupFieldKey, setter: (value: string) => void) => (value: string) => {
      clearFieldError(field);
      setter(value);
    };

  const handlePickRestaurantAsset = async (kind: 'covers' | 'logos') => {
    if (!user) {
      showNotice({
        tone: 'error',
        title: 'Session expired',
        message: 'Sign in again before uploading images.',
      });
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showNotice({
        tone: 'error',
        title: 'Photo access blocked',
        message: 'Allow photo access to upload images.',
      });
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
      showNotice({
        tone: 'error',
        title: 'Upload failed',
        message: nextError?.message ?? 'Unable to upload this image right now.',
      });
    }
  };

  const handlePublishToggle = (value: boolean) => {
    setIsPublished(value);

    // The publish-only errors stop applying the moment the store is hidden
    // again, so they are cleared rather than left standing over valid fields.
    if (!value) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next.latitude;
        delete next.longitude;
        delete next.deliveryRadiusKm;
        return next;
      });
    }
  };

  const handleSaveProfile = async () => {
    if (!user) {
      showNotice({
        tone: 'error',
        title: 'Session expired',
        message: 'Sign in again before saving store changes.',
      });
      return;
    }

    const nextErrors = validateStoreSetup(draft);
    setFieldErrors(nextErrors);

    if (hasStoreSetupErrors(nextErrors)) {
      // The fields run down a long scroll, so the first offending one is often
      // off-screen: the inline messages say WHAT is wrong, this says that
      // something is, from wherever the Save button was tapped.
      showNotice({
        tone: 'error',
        title: 'Check the highlighted fields',
        message: 'Some details are missing or unreadable. The fields in red explain what each one needs.',
      });
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
        // Blank sends null, never a stand-in: an amount the partner never typed
        // must not be persisted as one they did.
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

      showNotice({
        tone: 'success',
        title: user.restaurantId || restaurant?.id ? 'Store updated' : 'Store created',
        message: `${savedRestaurant.name} is ${isPublished ? 'live for customers' : 'hidden from customers'} and saved for partner menu management.`,
      });
    } catch (nextError: any) {
      showNotice({
        tone: 'error',
        title: 'Save failed',
        message: nextError?.message ?? 'Unable to save store details right now.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/profile' as never);
  };

  // Raised once on mount and never again, so this cannot flash over a realtime
  // refresh. Without it the form rendered empty inputs that a partner could
  // start typing into, only for the arriving record to seed over them.
  if (loading) {
    return <LoadingSkeleton mode="profile" />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + SCREEN_TOP_INSET }]}>
        <TouchableOpacity style={styles.backLink} onPress={handleBack}>
          <Text style={styles.backLinkText}>&lsaquo; Store</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Store details</Text>
        <Text style={styles.subtitle}>
          What customers see, where you are, and how you take orders. One Save covers the whole screen.
        </Text>
        {error ? (
          <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
            {error}
          </Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Identity</Text>
          <Text style={styles.fieldLabel}>Restaurant name</Text>
          <TextInput
            style={[styles.input, fieldErrors.name ? styles.inputError : null]}
            placeholder="Type the exact restaurant name customers should see"
            placeholderTextColor={PLACEHOLDER_COLOR}
            value={name}
            onChangeText={handleFieldChange('name', setName)}
          />
          <FieldError message={fieldErrors.name} />
          <Text style={styles.fieldLabel}>Cuisine</Text>
          <TextInput
            style={styles.input}
            placeholder="Example: Nigerian, Grills, Fast Food"
            placeholderTextColor={PLACEHOLDER_COLOR}
            value={cuisine}
            onChangeText={setCuisine}
          />
          <Text style={styles.fieldLabel}>Short description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Tell customers what you serve in one short sentence"
            placeholderTextColor={PLACEHOLDER_COLOR}
            value={description}
            onChangeText={setDescription}
            multiline
          />
          <Text style={styles.fieldLabel}>Restaurant address</Text>
          <TextInput
            style={[styles.input, fieldErrors.address ? styles.inputError : null]}
            placeholder="Street, area, city"
            placeholderTextColor={PLACEHOLDER_COLOR}
            value={address}
            onChangeText={handleFieldChange('address', setAddress)}
          />
          <FieldError message={fieldErrors.address} />
          <View style={styles.assetGrid}>
            <View style={styles.assetBlock}>
              <View style={styles.assetPreview}>
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
              <View style={styles.assetPreview}>
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
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Trading</Text>
          <Text style={styles.helperText}>
            An empty field stays empty - nothing here is filled in for you, so what you see is what customers get.
          </Text>
          <View style={styles.row}>
            <View style={styles.fieldColumn}>
              <Text style={styles.fieldLabel}>Opening time</Text>
              <TextInput
                style={[styles.input, fieldErrors.openingTime ? styles.inputError : null]}
                placeholder="08:00"
                placeholderTextColor={PLACEHOLDER_COLOR}
                value={openingTime}
                onChangeText={handleFieldChange('openingTime', setOpeningTime)}
                autoCapitalize="none"
              />
            </View>
            <View style={styles.fieldColumn}>
              <Text style={styles.fieldLabel}>Closing time</Text>
              <TextInput
                style={[styles.input, fieldErrors.closingTime ? styles.inputError : null]}
                placeholder="22:00"
                placeholderTextColor={PLACEHOLDER_COLOR}
                value={closingTime}
                onChangeText={handleFieldChange('closingTime', setClosingTime)}
                autoCapitalize="none"
              />
            </View>
          </View>
          <FieldError message={fieldErrors.openingTime ?? fieldErrors.closingTime} />
          <Text style={styles.fieldLabel}>Delivery time</Text>
          <TextInput
            style={styles.input}
            placeholder="Example: 25-35 min"
            placeholderTextColor={PLACEHOLDER_COLOR}
            value={deliveryTime}
            onChangeText={setDeliveryTime}
          />
          <View style={styles.row}>
            <View style={styles.fieldColumn}>
              <Text style={styles.fieldLabel}>Delivery fee</Text>
              <TextInput
                style={[styles.input, fieldErrors.deliveryFee ? styles.inputError : null]}
                placeholder="Amount customers pay for delivery"
                placeholderTextColor={PLACEHOLDER_COLOR}
                value={deliveryFee}
                onChangeText={handleFieldChange('deliveryFee', setDeliveryFee)}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.fieldColumn}>
              <Text style={styles.fieldLabel}>Minimum order</Text>
              <TextInput
                style={[styles.input, fieldErrors.minOrder ? styles.inputError : null]}
                placeholder="Lowest order amount accepted"
                placeholderTextColor={PLACEHOLDER_COLOR}
                value={minOrder}
                onChangeText={handleFieldChange('minOrder', setMinOrder)}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <FieldError message={fieldErrors.deliveryFee ?? fieldErrors.minOrder} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Fulfilment</Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelGroup}>
              <Text style={styles.toggleLabel}>I handle my own delivery</Text>
              <Text style={styles.toggleCaption}>
                Turn on to offer delivery with the fee and distance you set - your team delivers. Leave off and
                customers see &ldquo;delivery coming soon&rdquo; and order pickup.
              </Text>
            </View>
            <Switch
              value={supportsDelivery}
              onValueChange={(value) => {
                clearFieldError('fulfilment');
                setSupportsDelivery(value);
              }}
              trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
              thumbColor={supportsDelivery ? partnerTheme.accent : '#f3f4f6'}
            />
          </View>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelGroup}>
              <Text style={styles.toggleLabel}>Customers can collect</Text>
              <Text style={styles.toggleCaption}>Pickup orders, collected from your address.</Text>
            </View>
            <Switch
              value={supportsPickup}
              onValueChange={(value) => {
                clearFieldError('fulfilment');
                setSupportsPickup(value);
              }}
              trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
              thumbColor={supportsPickup ? partnerTheme.accent : '#f3f4f6'}
            />
          </View>
          <FieldError message={fieldErrors.fulfilment} />
          <Text style={styles.fieldLabel}>Delivery distance (km)</Text>
          <TextInput
            style={[styles.input, fieldErrors.deliveryRadiusKm ? styles.inputError : null]}
            placeholder="How far from you will you deliver?"
            placeholderTextColor={PLACEHOLDER_COLOR}
            value={deliveryRadiusKm}
            onChangeText={handleFieldChange('deliveryRadiusKm', setDeliveryRadiusKm)}
            keyboardType="decimal-pad"
          />
          <FieldError message={fieldErrors.deliveryRadiusKm} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Map location</Text>
          <Text style={styles.helperText}>
            Customers are matched to you by distance, so these are what put you in their search results. Both are needed
            before your store can be visible.
          </Text>
          <View style={styles.row}>
            <View style={styles.fieldColumn}>
              <Text style={styles.fieldLabel}>Latitude</Text>
              <TextInput
                style={[styles.input, fieldErrors.latitude ? styles.inputError : null]}
                placeholder="Required to be visible"
                placeholderTextColor={PLACEHOLDER_COLOR}
                value={latitude}
                onChangeText={handleFieldChange('latitude', setLatitude)}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.fieldColumn}>
              <Text style={styles.fieldLabel}>Longitude</Text>
              <TextInput
                style={[styles.input, fieldErrors.longitude ? styles.inputError : null]}
                placeholder="Required to be visible"
                placeholderTextColor={PLACEHOLDER_COLOR}
                value={longitude}
                onChangeText={handleFieldChange('longitude', setLongitude)}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <FieldError message={fieldErrors.latitude ?? fieldErrors.longitude} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Visibility</Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelGroup}>
              <Text style={styles.toggleLabel}>Visible to customers</Text>
              <Text style={styles.toggleCaption}>Takes effect as soon as you save. Nobody has to approve it.</Text>
            </View>
            <Switch
              value={isPublished}
              onValueChange={handlePublishToggle}
              trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
              thumbColor={isPublished ? partnerTheme.accent : '#f3f4f6'}
            />
          </View>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelGroup}>
              <Text style={styles.toggleLabel}>Store open now</Text>
              <Text style={styles.toggleCaption}>
                Saved with the rest of this screen. To stop orders for a while during service, use Pause on the Store
                tab instead - it turns itself back on.
              </Text>
            </View>
            <Switch
              value={isOpen}
              onValueChange={setIsOpen}
              trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
              thumbColor={isOpen ? partnerTheme.accent : '#f3f4f6'}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, savingProfile ? styles.controlDisabled : null]}
            onPress={handleSaveProfile}
            disabled={savingProfile}
          >
            <Text style={styles.primaryButtonText}>
              {savingProfile ? 'Saving store...' : user?.restaurantId || restaurant?.id ? 'Save store changes' : 'Create store record'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      {notice}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 1100,
    paddingBottom: 30,
    paddingHorizontal: 18,
    width: '100%',
  },
  backLink: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginBottom: 6,
    minHeight: MIN_TAP_TARGET,
    paddingRight: 12,
    paddingVertical: 10,
  },
  backLinkText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  title: {
    color: partnerTheme.text,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
  },
  subtitle: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  errorText: {
    color: partnerTheme.dangerText,
    fontSize: 13,
    marginTop: 12,
  },
  fieldErrorText: {
    color: partnerTheme.dangerText,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
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
  helperText: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  input: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 14,
    marginTop: 10,
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  inputError: {
    backgroundColor: partnerTheme.dangerSoft,
    borderColor: partnerTheme.danger,
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
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  toggleLabelGroup: {
    flex: 1,
    paddingRight: 12,
  },
  toggleLabel: {
    color: partnerTheme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  toggleCaption: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: radius.lg,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  // One shared dim for every control that can go disabled on this screen.
  controlDisabled: {
    opacity: 0.5,
  },
  assetGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  assetBlock: {
    flex: 1,
  },
  assetButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: radius.lg,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 12,
  },
  assetButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 13,
    fontWeight: '800',
  },
  assetFallbackText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  assetImage: {
    height: '100%',
    width: '100%',
  },
  // The logo and cover previews were two identical style objects under
  // different names; one box, two aspect crops chosen at the picker.
  assetPreview: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 86,
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
