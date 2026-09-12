import { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
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
import { useConfirm, useNotice } from '@feasty/design-system';
import {
  ACCOUNT_DELETION_CANCEL_LABEL,
  ACCOUNT_DELETION_CONFIRM_LABEL,
  ACCOUNT_DELETION_TITLE,
  accountDeletionErrorMessage,
  accountDeletionParagraphs,
} from '../../../../packages/domain/src/accountDeletion';
import { useAuth } from '../../src/contexts/AuthContext';
import { usePartnerRestaurant } from '../../src/hooks/usePartnerRestaurant';
import { savePartnerRestaurantProfile, setPartnerStorePause } from '../../src/services/partnerRestaurantActions';
import { uploadRestaurantAsset } from '../../src/services/restaurantAssetUpload';
import { partnerTheme } from '../../src/theme/palette';

// Task 16 (F2): quick pause durations — one tap picks a duration and pauses
// immediately, no separate confirm step (pausing is fully reversible with
// one more tap on "Resume now"). Mirrors _shared/availability.ts's
// isStorePaused on the display side only: paused while pausedUntil is still
// in the future, auto-resumes with no partner action once it passes.
const PAUSE_DURATION_OPTIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '4 hours', minutes: 240 },
] as const;

const isStoreCurrentlyPaused = (pausedUntil: string | null | undefined) => {
  if (!pausedUntil) {
    return false;
  }

  const untilMs = Date.parse(pausedUntil);
  return Number.isFinite(untilMs) && untilMs > Date.now();
};

const formatPausedUntil = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const toNumberOrNull = (value: string) => {
  if (!value.trim()) {
    return null;
  }

  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const INPUT_PLACEHOLDER_COLOR = '#6a7d76';
type PublishFieldKey = 'name' | 'latitude' | 'longitude' | 'deliveryRadiusKm';

/**
 * The messages that used to sit in an `Alert.alert` beside `setFieldErrors`.
 * The red border already told the partner WHICH field was wrong; the Alert was
 * meant to say why, and says nothing at all on the web build, so the border was
 * the entire explanation. These now render in that same per-field surface
 * rather than in a second, competing one.
 */
const PUBLISH_FIELD_MESSAGES = {
  name: 'Add a restaurant name before saving.',
  location: 'Add both latitude and longitude before publishing this store.',
  deliveryRadiusKm: 'Add a delivery distance above zero before publishing this store.',
} as const;

export default function PartnerProfileScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { deleteAccount, linkRestaurant, loading: authLoading, signOut, user } = useAuth();
  const { error, loading, restaurant, restaurants, requiresVerifiedLink } = usePartnerRestaurant();
  const { confirm, confirmDialog } = useConfirm();
  // Every save, upload, link, pause, resume and sign-out failure on this screen
  // used to report through `Alert`, which is `class Alert { static alert() {} }`
  // in react-native-web - nothing at all on partner.feasty.com.ng. The `error`
  // below belongs to usePartnerRestaurant and carries LOAD failures only, so a
  // failed Pause left the partner believing the store was paused while it was
  // still accepting orders nobody would cook.
  //
  // Floating rather than inline: the controls are spread down a long scrolling
  // page - Save sits in Restaurant details, the pause chips in their own card,
  // Confirm link further down and Sign out at the very bottom - so no single
  // in-layout slot is visible from all of them. The offset clears the tab bar
  // on narrow layouts; the wide layout uses a sidebar and has none.
  const { notice, showNotice } = useNotice({
    placement: 'floating',
    offsetBottom: width >= 1024 ? insets.bottom + 16 : insets.bottom + 86,
  });
  // Separate from `error` above, which belongs to usePartnerRestaurant and is
  // rendered at the top of the screen; this one sits beside the delete button.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [pauseActionPending, setPauseActionPending] = useState(false);
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
  const [supportsDelivery, setSupportsDelivery] = useState(false);
  const [supportsPickup, setSupportsPickup] = useState(true);
  const [isOpen, setIsOpen] = useState(true);
  const [isPublished, setIsPublished] = useState(true);
  // Holds the MESSAGE per field now rather than a bare boolean - see the note
  // on PUBLISH_FIELD_MESSAGES. Truthiness still drives the red border.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PublishFieldKey, string>>>({});

  const linkedRestaurantId = user?.restaurantId ?? restaurant?.id ?? null;
  const linkableRestaurants = [...restaurants].sort((left, right) => left.name.localeCompare(right.name));

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
    setSupportsDelivery(restaurant?.supportsDelivery === true);
    setSupportsPickup(restaurant?.supportsPickup !== false);
    setIsOpen(restaurant?.isOpen !== false);
    setIsPublished(restaurant?.isPublished !== false);
  }, [restaurant, user?.displayName]);

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

  const handleLinkRestaurant = async (restaurantId: string, restaurantName: string) => {
    try {
      await linkRestaurant(restaurantId);
      showNotice({
        tone: 'success',
        title: 'Restaurant linked',
        message: `${restaurantName} is now connected to this partner account.`,
      });
    } catch (nextError: any) {
      // `linkRestaurant` writes to AuthContext's `error`, which this screen
      // never renders - the slot at the top belongs to usePartnerRestaurant.
      showNotice({
        tone: 'error',
        title: 'Link failed',
        message: nextError?.message ?? 'Unable to link this restaurant right now.',
      });
    }
  };

  const clearFieldError = (field: PublishFieldKey) => {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleRequiredFieldChange = (field: PublishFieldKey, setter: (value: string) => void) => (value: string) => {
    clearFieldError(field);
    setter(value);
  };

  const handlePublishToggle = (value: boolean) => {
    setIsPublished(value);

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

    if (!name.trim()) {
      setFieldErrors({ name: PUBLISH_FIELD_MESSAGES.name });
      return;
    }

    const parsedLatitude = toNumberOrNull(latitude);
    const parsedLongitude = toNumberOrNull(longitude);
    const parsedDeliveryRadiusKm = toNumberOrNull(deliveryRadiusKm);

    if (isPublished) {
      if (parsedLatitude === null || parsedLongitude === null) {
        setFieldErrors({
          latitude: parsedLatitude === null ? PUBLISH_FIELD_MESSAGES.location : undefined,
          longitude: parsedLongitude === null ? PUBLISH_FIELD_MESSAGES.location : undefined,
        });
        return;
      }

      if (parsedDeliveryRadiusKm === null || parsedDeliveryRadiusKm <= 0) {
        setFieldErrors({ deliveryRadiusKm: PUBLISH_FIELD_MESSAGES.deliveryRadiusKm });
        return;
      }
    }

    setSavingProfile(true);
    setFieldErrors({});

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
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        deliveryRadiusKm: parsedDeliveryRadiusKm,
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

  // Task 16 (F2): the "two taps" pause action — one tap on a duration chip
  // pauses the store immediately via the dedicated partnerSetStorePause RPC,
  // separate from the full store-details save above so a kitchen backlog
  // doesn't require touching (or re-validating) the rest of the profile.
  const handlePauseStore = async (minutes: number) => {
    if (!restaurant?.id) {
      showNotice({
        tone: 'error',
        title: 'Store setup needed',
        message: 'Create or link a restaurant record before pausing orders.',
      });
      return;
    }

    setPauseActionPending(true);

    try {
      await setPartnerStorePause({
        paused: true,
        pausedUntil: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
        restaurantId: restaurant.id,
      });
    } catch (nextError: any) {
      // The partner must not be left believing the store is paused while it is
      // still taking orders. Sticky, as errors default to.
      showNotice({
        tone: 'error',
        title: 'Pause failed',
        message: nextError?.message ?? 'Unable to pause the store right now.',
      });
    } finally {
      setPauseActionPending(false);
    }
  };

  const handleResumeStore = async () => {
    if (!restaurant?.id) {
      return;
    }

    setPauseActionPending(true);

    try {
      await setPartnerStorePause({ paused: false, restaurantId: restaurant.id });
    } catch (nextError: any) {
      showNotice({
        tone: 'error',
        title: 'Resume failed',
        message: nextError?.message ?? 'Unable to resume the store right now.',
      });
    } finally {
      setPauseActionPending(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (nextError: any) {
      showNotice({
        tone: 'error',
        title: 'Sign out failed',
        message: nextError?.message ?? 'Unable to sign out right now.',
      });
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);

    try {
      await confirm({
        title: ACCOUNT_DELETION_TITLE,
        paragraphs: accountDeletionParagraphs('partner'),
        confirmLabel: ACCOUNT_DELETION_CONFIRM_LABEL,
        cancelLabel: ACCOUNT_DELETION_CANCEL_LABEL,
        destructive: true,
        // Held inside the dialog so both buttons stay disabled for the whole
        // round trip; a second tap cannot fire a second delete.
        onConfirm: deleteAccount,
      });
    } catch (nextError) {
      // The backend's 412 ("Partner accounts linked to a restaurant must be
      // offboarded by admin...") is the whole point of this path, so it is shown
      // in the screen rather than through Alert, which is inert on the web build
      // at partner.feasty.com.ng.
      setDeleteError(accountDeletionErrorMessage(nextError));
    }
  };

  return (
    // Wrapped rather than used as the root because the floating notice
    // positions itself absolutely: inside a ScrollView that would anchor it to
    // the bottom of the CONTENT and let it scroll away, instead of pinning it
    // to the bottom of the screen.
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
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
            style={[styles.input, fieldErrors.name ? styles.inputError : null]}
            placeholder="Type the exact restaurant name customers should see"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
            value={name}
            onChangeText={handleRequiredFieldChange('name', setName)}
          />
          {fieldErrors.name ? (
            <Text accessibilityLiveRegion="polite" role="alert" style={styles.fieldErrorText}>
              {fieldErrors.name}
            </Text>
          ) : null}
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
                style={[styles.input, fieldErrors.latitude ? styles.inputError : null]}
                placeholder="Required to publish"
                placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                value={latitude}
                onChangeText={handleRequiredFieldChange('latitude', setLatitude)}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.fieldColumn}>
              <Text style={styles.fieldLabel}>Longitude</Text>
              <TextInput
                style={[styles.input, fieldErrors.longitude ? styles.inputError : null]}
                placeholder="Required to publish"
                placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                value={longitude}
                onChangeText={handleRequiredFieldChange('longitude', setLongitude)}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          {fieldErrors.latitude ?? fieldErrors.longitude ? (
            <Text accessibilityLiveRegion="polite" role="alert" style={styles.fieldErrorText}>
              {fieldErrors.latitude ?? fieldErrors.longitude}
            </Text>
          ) : null}
          <Text style={styles.fieldLabel}>Delivery radius</Text>
          <TextInput
            style={[styles.input, fieldErrors.deliveryRadiusKm ? styles.inputError : null]}
            placeholder="Maximum delivery distance in km"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
            value={deliveryRadiusKm}
            onChangeText={handleRequiredFieldChange('deliveryRadiusKm', setDeliveryRadiusKm)}
            keyboardType="decimal-pad"
          />
          {fieldErrors.deliveryRadiusKm ? (
            <Text accessibilityLiveRegion="polite" role="alert" style={styles.fieldErrorText}>
              {fieldErrors.deliveryRadiusKm}
            </Text>
          ) : null}

          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelGroup}>
              <Text style={styles.toggleLabel}>I handle my own delivery</Text>
              <Text style={styles.toggleCaption}>
                Turn on to offer delivery with the fee and radius above — your team delivers. Leave off and
                customers see &ldquo;delivery coming soon&rdquo; and order pickup.
              </Text>
            </View>
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
              onValueChange={handlePublishToggle}
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
          <Text style={styles.cardTitle}>Pause orders</Text>
          <Text style={styles.helperText}>
            Kitchen backed up? Pause the whole store for a set time — customers stop seeing you in search and can&apos;t place new
            orders. It resumes on its own the moment the time is up, no need to remember to switch it back on.
          </Text>
          {isStoreCurrentlyPaused(restaurant?.pausedUntil) ? (
            <View style={styles.pausedBanner}>
              <Text style={styles.pausedBannerTitle}>Paused right now</Text>
              <Text style={styles.pausedBannerCopy}>
                {restaurant?.pausedUntil && formatPausedUntil(restaurant.pausedUntil)
                  ? `Resumes automatically at ${formatPausedUntil(restaurant.pausedUntil)}, or tap below to resume sooner.`
                  : 'Tap below to resume taking orders.'}
              </Text>
              <TouchableOpacity
                style={[styles.primaryButton, styles.resumeButton]}
                onPress={handleResumeStore}
                disabled={pauseActionPending || loading}
              >
                <Text style={styles.primaryButtonText}>{pauseActionPending ? 'Updating...' : 'Resume now'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.pauseChipRow}>
              {PAUSE_DURATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.label}
                  style={styles.pauseChip}
                  onPress={() => handlePauseStore(option.minutes)}
                  disabled={pauseActionPending || loading || !restaurant}
                >
                  <Text style={styles.pauseChipText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
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
            Order pause:{' '}
            {isStoreCurrentlyPaused(restaurant?.pausedUntil)
              ? `Paused${restaurant?.pausedUntil && formatPausedUntil(restaurant.pausedUntil) ? ` until ${formatPausedUntil(restaurant.pausedUntil)}` : ''}`
              : 'Not paused'}
          </Text>
          <Text style={styles.metaLine}>
            Trading hours: {restaurant?.openingTime && restaurant?.closingTime ? `${restaurant.openingTime} - ${restaurant.closingTime}` : 'Not set'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Restaurant linking</Text>
          <Text style={styles.helperText}>
            This is the restaurant record tied to your partner account. Create or update your store above and the link is kept in sync.
          </Text>
          {linkableRestaurants.length === 0 ? (
            <Text style={styles.metaLine}>
              No restaurant is attached to this account yet. Complete your restaurant application to have one created for you.
            </Text>
          ) : null}
          {linkableRestaurants.map((candidate) => {
            const isLinked = linkedRestaurantId === candidate.id;

            return (
              <View
                key={candidate.id}
                style={[styles.restaurantRow, isLinked ? styles.restaurantRowActive : null]}
              >
                <View style={styles.restaurantMeta}>
                  <Text style={styles.restaurantName}>{candidate.name}</Text>
                  <Text style={styles.restaurantInfo}>
                    {candidate.cuisine ?? 'Cuisine not set'} | {candidate.address ?? 'Address not set'}
                  </Text>
                  <Text style={styles.restaurantId}>ID: {candidate.id}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.linkButton, isLinked ? styles.linkButtonActive : null]}
                  onPress={() => handleLinkRestaurant(candidate.id, candidate.name)}
                  disabled={loading || isLinked}
                >
                  <Text style={[styles.linkButtonText, isLinked ? styles.linkButtonTextActive : null]}>
                    {isLinked ? 'Linked' : 'Confirm link'}
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
          {deleteError ? (
            <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
              {deleteError}
            </Text>
          ) : null}
        </View>

        {confirmDialog}
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
  // Sits directly under the field it explains, so the red border and the reason
  // for it are read together.
  fieldErrorText: {
    color: partnerTheme.danger,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
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
    color: partnerTheme.warningText,
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
  inputError: {
    backgroundColor: '#fff6f6',
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
  halfInput: {
    flex: 1,
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
    color: partnerTheme.warningText,
    fontSize: 14,
    fontWeight: '800',
  },
  approvalNoticeCopy: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  pauseChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  pauseChip: {
    backgroundColor: partnerTheme.warningSoft,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  pauseChipText: {
    color: partnerTheme.warningText,
    fontSize: 14,
    fontWeight: '800',
  },
  pausedBanner: {
    backgroundColor: partnerTheme.warningSoft,
    borderColor: '#efcf96',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  pausedBannerTitle: {
    color: partnerTheme.warningText,
    fontSize: 15,
    fontWeight: '800',
  },
  pausedBannerCopy: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  resumeButton: {
    marginTop: 14,
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
