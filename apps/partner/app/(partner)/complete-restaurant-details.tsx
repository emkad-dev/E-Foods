/**
 * Partner onboarding — the single-flow wizard.
 *
 * WHY THIS REPLACED THE ONE-PAGE FORM. The old screen called
 * `submitPartnerApplication`, which writes only PartnerApplicationRecord. But
 * admin approval (Task 7 [C1]) reads RestaurantPayout by uid and 412s when the
 * row is missing — so a partner who signed up through that form could never be
 * approved. `submitPartnerOnboarding` writes all three rows
 * (PartnerApplicationRecord + RestaurantKyc + RestaurantPayout); this wizard is
 * what finally calls it.
 *
 * The gating rules live in src/domain/partnerOnboardingSteps.ts, mirrored from
 * the server's validatePartnerOnboardingSubmission so a partner cannot fill five
 * steps and then fail on submit. The server stays the authority.
 *
 * The payout step will not advance until Paystack has resolved the account
 * holder's name: approval later mints a subaccount from this pair, and a bad
 * account cannot be settled to.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius, useNotice } from '@feasty/design-system';
import { useAuth } from '../../src/contexts/AuthContext';
import { NIGERIA_BANKS, isPlausibleNubanAccountNumber } from '../../src/domain/nigeriaBanks';
import {
  PARTNER_ONBOARDING_STEPS,
  canSubmitPartnerOnboarding,
  firstIncompleteStep,
  isStepComplete,
  isValidDeliveryRadius,
  shouldInvalidateBankVerification,
  type PartnerOnboardingFormState,
  type PartnerOnboardingStepId,
} from '../../src/domain/partnerOnboardingSteps';
import {
  resolvePartnerBankAccount,
  submitPartnerOnboarding,
  uploadPartnerVerificationDocument,
} from '../../src/services/partnerApplications';
import {
  clearPartnerOnboardingDraft,
  loadPartnerOnboardingDraft,
  savePartnerOnboardingDraft,
} from '../../src/services/partnerOnboardingDraft';
import { buildPartnerPolicyAcceptance } from '../../src/services/policyAcceptance';
import { uploadRestaurantAsset } from '../../src/services/restaurantAssetUpload';
import { supabase } from '../../src/services/supabase/config';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT, SCREEN_TOP_INSET } from '../../src/theme/screenChrome';

const cuisineOptions = ['Nigerian', 'Fast Food', 'Pizza', 'Grills', 'Seafood', 'Healthy', 'Desserts'] as const;
const deliveryTimeOptions = ['15-25 min', '25-35 min', '35-45 min', '45-60 min'] as const;
const documentTypeOptions = [
  { label: 'NIN', value: 'nin' },
  { label: 'Tax ID (TIN)', value: 'tax_id' },
] as const;

const emptyForm = (email: string): PartnerOnboardingFormState => ({
  accountNumber: '',
  address: '',
  bankCode: '',
  bankName: '',
  bankVerifiedAccountName: null,
  contactName: '',
  cuisine: 'Nigerian',
  deliveryRadiusKm: '5',
  deliveryTime: '25-35 min',
  description: '',
  documentBackPath: null,
  documentFrontPath: null,
  documentNumber: '',
  documentType: 'nin',
  email,
  latitude: '',
  legalName: '',
  logoImage: null,
  longitude: '',
  phoneNumber: '',
  restaurantName: '',
});

export default function CompleteRestaurantDetailsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { loading, signOut, user } = useAuth();

  const [form, setForm] = useState<PartnerOnboardingFormState>(() => emptyForm(user?.email ?? ''));
  const [stepId, setStepId] = useState<PartnerOnboardingStepId>('restaurant');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifyingBank, setVerifyingBank] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<'front' | 'back' | null>(null);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  // The (code, number) pair the resolved name actually belongs to.
  const [verifiedPair, setVerifiedPair] = useState<{ accountNumber: string; bankCode: string } | null>(null);

  const stepIndex = PARTNER_ONBOARDING_STEPS.findIndex((step) => step.id === stepId);
  const step = PARTNER_ONBOARDING_STEPS[stepIndex] ?? PARTNER_ONBOARDING_STEPS[0];

  const setField = useCallback(<K extends keyof PartnerOnboardingFormState>(key: K, value: PartnerOnboardingFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  // Resume a saved draft, and land on the first thing still missing rather than
  // on step 1. Document paths survive because the file is already uploaded.
  useEffect(() => {
    let cancelled = false;
    loadPartnerOnboardingDraft()
      .then((draft) => {
        if (cancelled) {
          return;
        }
        if (draft) {
          const restored: PartnerOnboardingFormState = {
            ...emptyForm(user?.email ?? ''),
            accountNumber: draft.accountNumber ?? '',
            address: draft.address ?? '',
            bankCode: draft.bankCode ?? '',
            bankName: draft.bankName ?? '',
            contactName: draft.contactName ?? '',
            cuisine: draft.cuisine ?? 'Nigerian',
            deliveryRadiusKm: draft.deliveryRadiusKm != null ? String(draft.deliveryRadiusKm) : '5',
            deliveryTime: draft.deliveryTime ?? '25-35 min',
            description: draft.description ?? '',
            documentBackPath: draft.documentBackPath ?? null,
            documentFrontPath: draft.documentFrontPath ?? null,
            documentType: draft.documentType ?? 'nin',
            email: draft.email ?? user?.email ?? '',
            latitude: draft.latitude != null ? String(draft.latitude) : '',
            legalName: draft.legalName ?? '',
            longitude: draft.longitude != null ? String(draft.longitude) : '',
            phoneNumber: draft.phoneNumber ?? '',
            restaurantName: draft.restaurantName ?? '',
          };
          setForm(restored);
          // The bank verification is deliberately NOT restored: the resolve
          // proved a pair at a point in time and is cheap to redo, so the
          // partner re-verifies rather than submitting on stale evidence.
          setStepId(firstIncompleteStep(restored));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setDraftLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  // Persist whatever is filled so far, so a partner who leaves mid-flow (to
  // find their account number, typically) does not start over.
  useEffect(() => {
    if (!draftLoaded) {
      return;
    }
    void savePartnerOnboardingDraft({
      accountNumber: form.accountNumber,
      address: form.address,
      bankCode: form.bankCode,
      bankName: form.bankName,
      contactName: form.contactName,
      cuisine: form.cuisine,
      deliveryRadiusKm: Number.parseFloat(form.deliveryRadiusKm) || null,
      deliveryTime: form.deliveryTime,
      description: form.description,
      documentBackPath: form.documentBackPath,
      documentFrontPath: form.documentFrontPath,
      documentType: form.documentType,
      email: form.email,
      latitude: form.latitude ? Number.parseFloat(form.latitude) : null,
      legalName: form.legalName,
      longitude: form.longitude ? Number.parseFloat(form.longitude) : null,
      phoneNumber: form.phoneNumber,
      restaurantName: form.restaurantName,
    }).catch(() => undefined);
  }, [draftLoaded, form]);

  // A changed pair invalidates the resolved name — it proved that pair, not this one.
  useEffect(() => {
    if (
      form.bankVerifiedAccountName &&
      shouldInvalidateBankVerification({
        nextAccountNumber: form.accountNumber,
        nextBankCode: form.bankCode,
        verifiedAccountNumber: verifiedPair?.accountNumber ?? null,
        verifiedBankCode: verifiedPair?.bankCode ?? null,
      })
    ) {
      setForm((current) => ({ ...current, bankVerifiedAccountName: null }));
      setVerifiedPair(null);
    }
  }, [form.accountNumber, form.bankCode, form.bankVerifiedAccountName, verifiedPair]);

  const displayName = useMemo(
    () => user?.displayName?.trim() || user?.email?.split('@')[0]?.trim() || 'Partner',
    [user?.displayName, user?.email]
  );

  // Every failure in this 764-line wizard went to `Alert`, which is
  // `class Alert { static alert() {} }` in react-native-web - nothing at all on
  // partner.feasty.com.ng. The only inline error in the whole file was the
  // delivery-radius hint, so a payout account that Paystack could not resolve,
  // a document upload that failed, or a rejected submission all looked like a
  // dead button. That matters most on the payout step: approval later mints a
  // subaccount from this pair, so a partner who cannot verify here cannot be
  // paid, and was never told why.
  //
  // Inline rather than floating: this is a one-step-at-a-time form, and the
  // notice renders directly below the step card, immediately above the
  // Continue/Submit button and just under the Verify account and Upload
  // controls it answers for.
  const { notice, showNotice } = useNotice({ placement: 'inline' });

  const pickImage = async (onPicked: (uri: string) => void) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showNotice({
        tone: 'error',
        title: 'Permission needed',
        message: 'Allow photo access to attach an image.',
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      onPicked(result.assets[0].uri);
    }
  };

  const handleVerifyBank = async () => {
    if (verifyingBank) {
      return;
    }
    if (!form.bankCode) {
      showNotice({
        tone: 'error',
        title: 'Pick a bank',
        message: 'Select your bank before verifying the account.',
      });
      return;
    }
    if (!isPlausibleNubanAccountNumber(form.accountNumber)) {
      showNotice({
        tone: 'error',
        title: 'Check the account number',
        message: 'A Nigerian account number is exactly 10 digits.',
      });
      return;
    }

    setVerifyingBank(true);
    try {
      const resolved = await resolvePartnerBankAccount({
        accountNumber: form.accountNumber.trim(),
        bankCode: form.bankCode.trim(),
      });
      setForm((current) => ({ ...current, bankVerifiedAccountName: resolved.accountName }));
      setVerifiedPair({ accountNumber: form.accountNumber.trim(), bankCode: form.bankCode.trim() });
    } catch (error: any) {
      setForm((current) => ({ ...current, bankVerifiedAccountName: null }));
      setVerifiedPair(null);
      // Sticky, as errors default to: the payout step will not advance until
      // Paystack resolves the account holder's name, so this banner is the only
      // thing standing between the partner and a step that refuses to continue.
      showNotice({
        tone: 'error',
        title: 'Could not verify',
        message: error?.message ?? 'Check the account number and bank, then try again.',
      });
    } finally {
      setVerifyingBank(false);
    }
  };

  const handlePickDocument = async (kind: 'front' | 'back') => {
    await pickImage(async (uri) => {
      setUploadingKind(kind);
      try {
        const path = await uploadPartnerVerificationDocument({ fileUri: uri, kind });
        setField(kind === 'front' ? 'documentFrontPath' : 'documentBackPath', path);
      } catch (error: any) {
        showNotice({
          tone: 'error',
          title: 'Upload failed',
          message: error?.message ?? 'Please try again.',
        });
      } finally {
        setUploadingKind(null);
      }
    });
  };

  const handleSubmit = async () => {
    if (loading || submitting || !canSubmitPartnerOnboarding(form)) {
      return;
    }

    setSubmitting(true);
    try {
      const logoUpload = form.logoImage
        ? await uploadRestaurantAsset({ kind: 'logos', ownerId: user?.uid ?? '', uri: form.logoImage })
        : null;

      await submitPartnerOnboarding({
        accountNumber: form.accountNumber.trim(),
        address: form.address.trim(),
        bankCode: form.bankCode.trim(),
        bankName: form.bankName.trim(),
        contactName: form.contactName.trim(),
        cuisine: form.cuisine,
        deliveryRadiusKm: Number.parseFloat(form.deliveryRadiusKm),
        deliveryTime: form.deliveryTime,
        description: form.description.trim() || undefined,
        documentBackPath: form.documentBackPath,
        documentFrontPath: form.documentFrontPath as string,
        documentNumber: form.documentNumber.trim(),
        documentType: form.documentType,
        email: form.email.trim(),
        latitude: form.latitude ? Number.parseFloat(form.latitude) : null,
        legalName: form.legalName.trim(),
        logoImage: logoUpload,
        longitude: form.longitude ? Number.parseFloat(form.longitude) : null,
        phoneNumber: form.phoneNumber.trim(),
        policyAcceptance: buildPartnerPolicyAcceptance('partner_signup'),
        restaurantName: form.restaurantName.trim(),
      });

      await clearPartnerOnboardingDraft().catch(() => undefined);
      // Submitting does not grant the restaurant role — an admin approves
      // first. Refresh so the pending status is picked up, then let the layout
      // route to the under-review screen.
      await supabase.auth.refreshSession().catch(() => undefined);
      router.replace('/(partner)/application-under-review' as never);
    } catch (error: any) {
      showNotice({
        tone: 'error',
        title: 'Unable to submit',
        message: error?.message ?? 'Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const goNext = () => {
    const next = PARTNER_ONBOARDING_STEPS[stepIndex + 1];
    if (next) {
      setStepId(next.id);
    }
  };

  const goBack = () => {
    const previous = PARTNER_ONBOARDING_STEPS[stepIndex - 1];
    if (previous) {
      setStepId(previous.id);
    }
  };

  const currentStepComplete = stepId === 'review' ? canSubmitPartnerOnboarding(form) : isStepComplete(stepId, form);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SCREEN_TOP_INSET, paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FEASTY Partner</Text>
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.copy}>{step.blurb}</Text>
      </View>

      <View style={styles.progressRow}>
        {PARTNER_ONBOARDING_STEPS.map((entry, index) => (
          <View
            key={entry.id}
            style={[
              styles.progressSegment,
              index <= stepIndex ? styles.progressSegmentActive : null,
            ]}
          />
        ))}
      </View>
      <Text style={styles.progressLabel}>
        Step {stepIndex + 1} of {PARTNER_ONBOARDING_STEPS.length}
      </Text>

      <View style={styles.card}>
        <View style={styles.identityRow}>
          <View style={styles.identityBubble}>
            <Text style={styles.identityBubbleText}>{displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.identityCopy}>
            <Text style={styles.identityName}>{displayName}</Text>
            <Text style={styles.identityEmail}>{user?.email ?? 'Signed in'}</Text>
          </View>
        </View>

        {stepId === 'restaurant' ? (
          <>
            <Text style={styles.sectionLabel}>Restaurant name</Text>
            <TextInput
              style={styles.input}
              onChangeText={(value) => setField('restaurantName', value)}
              placeholder="Ada Obi Kitchen"
              placeholderTextColor={partnerTheme.textSoft}
              value={form.restaurantName}
            />

            <Text style={styles.sectionLabel}>Registered legal name</Text>
            <TextInput
              style={styles.input}
              onChangeText={(value) => setField('legalName', value)}
              placeholder="Ada Obi Foods Ltd"
              placeholderTextColor={partnerTheme.textSoft}
              value={form.legalName}
            />
            <Text style={styles.hint}>The name on your bank account and tax records.</Text>

            <Text style={styles.sectionLabel}>Contact name</Text>
            <TextInput
              style={styles.input}
              onChangeText={(value) => setField('contactName', value)}
              placeholder="Ada Obi"
              placeholderTextColor={partnerTheme.textSoft}
              value={form.contactName}
            />

            <Text style={styles.sectionLabel}>Phone number</Text>
            <TextInput
              style={styles.input}
              keyboardType="phone-pad"
              onChangeText={(value) => setField('phoneNumber', value)}
              placeholder="08012345678"
              placeholderTextColor={partnerTheme.textSoft}
              value={form.phoneNumber}
            />

            <Text style={styles.sectionLabel}>Cuisine</Text>
            <View style={styles.optionRow}>
              {cuisineOptions.map((option) => (
                <TouchableOpacity
                  key={option}
                  onPress={() => setField('cuisine', option)}
                  style={[styles.chip, form.cuisine === option ? styles.chipActive : null]}
                >
                  <Text style={[styles.chipText, form.cuisine === option ? styles.chipTextActive : null]}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Typical prep + delivery time</Text>
            <View style={styles.optionRow}>
              {deliveryTimeOptions.map((option) => (
                <TouchableOpacity
                  key={option}
                  onPress={() => setField('deliveryTime', option)}
                  style={[styles.chip, form.deliveryTime === option ? styles.chipActive : null]}
                >
                  <Text style={[styles.chipText, form.deliveryTime === option ? styles.chipTextActive : null]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Short description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              onChangeText={(value) => setField('description', value)}
              placeholder="Home-style Nigerian cooking, generous portions."
              placeholderTextColor={partnerTheme.textSoft}
              value={form.description}
            />

            <Text style={styles.sectionLabel}>Logo (optional)</Text>
            <View style={styles.logoRow}>
              <View style={styles.logoPreview}>
                {form.logoImage ? (
                  <Image source={{ uri: form.logoImage }} style={styles.logoImage} />
                ) : (
                  <Text style={styles.logoPreviewText}>No logo</Text>
                )}
              </View>
              <View style={styles.logoActions}>
                <TouchableOpacity onPress={() => pickImage((uri) => setField('logoImage', uri))} style={styles.logoButton}>
                  <Text style={styles.logoButtonText}>{form.logoImage ? 'Change' : 'Add logo'}</Text>
                </TouchableOpacity>
                {form.logoImage ? (
                  <TouchableOpacity onPress={() => setField('logoImage', null)} style={styles.removeLogoButton}>
                    <Text style={styles.removeLogoText}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </>
        ) : null}

        {stepId === 'location' ? (
          <>
            <Text style={styles.sectionLabel}>Restaurant address</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              onChangeText={(value) => setField('address', value)}
              placeholder="12 Admiralty Way, Lekki Phase 1, Lagos"
              placeholderTextColor={partnerTheme.textSoft}
              value={form.address}
            />

            <Text style={styles.sectionLabel}>Delivery radius (km)</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              onChangeText={(value) => setField('deliveryRadiusKm', value)}
              placeholder="5"
              placeholderTextColor={partnerTheme.textSoft}
              value={form.deliveryRadiusKm}
            />
            {isValidDeliveryRadius(form.deliveryRadiusKm) ? (
              <Text style={styles.hint}>Orders outside this radius will not reach you.</Text>
            ) : (
              <Text style={styles.errorText}>Enter a delivery radius greater than zero.</Text>
            )}

            <Text style={styles.sectionLabel}>Coordinates (optional)</Text>
            <View style={styles.coordinatesRow}>
              <TextInput
                style={[styles.input, styles.coordinateInput]}
                keyboardType="numbers-and-punctuation"
                onChangeText={(value) => setField('latitude', value)}
                placeholder="Latitude"
                placeholderTextColor={partnerTheme.textSoft}
                value={form.latitude}
              />
              <TextInput
                style={[styles.input, styles.coordinateInput]}
                keyboardType="numbers-and-punctuation"
                onChangeText={(value) => setField('longitude', value)}
                placeholder="Longitude"
                placeholderTextColor={partnerTheme.textSoft}
                value={form.longitude}
              />
            </View>
            <Text style={styles.hint}>Leave both empty if you are not sure — add them together or not at all.</Text>
          </>
        ) : null}

        {stepId === 'payout' ? (
          <>
            <Text style={styles.sectionLabel}>Bank</Text>
            <TouchableOpacity onPress={() => setBankPickerOpen((open) => !open)} style={styles.input}>
              <Text style={form.bankName ? styles.pickerValue : styles.pickerPlaceholder}>
                {form.bankName || 'Select your bank'}
              </Text>
            </TouchableOpacity>
            {bankPickerOpen ? (
              <View style={styles.bankList}>
                {NIGERIA_BANKS.map((bank) => (
                  <TouchableOpacity
                    key={bank.code}
                    onPress={() => {
                      setForm((current) => ({ ...current, bankCode: bank.code, bankName: bank.name }));
                      setBankPickerOpen(false);
                    }}
                    style={styles.bankRow}
                  >
                    <Text style={styles.bankRowText}>{bank.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>Account number</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              maxLength={10}
              onChangeText={(value) => setField('accountNumber', value.replace(/\D/g, ''))}
              placeholder="0123456789"
              placeholderTextColor={partnerTheme.textSoft}
              value={form.accountNumber}
            />

            {form.bankVerifiedAccountName ? (
              <View style={styles.verifiedCard}>
                <Text style={styles.verifiedLabel}>Account verified</Text>
                <Text style={styles.verifiedName}>{form.bankVerifiedAccountName}</Text>
                <Text style={styles.hint}>Payouts for this restaurant will land here.</Text>
              </View>
            ) : (
              <TouchableOpacity
                disabled={verifyingBank}
                onPress={handleVerifyBank}
                style={[styles.secondaryButton, verifyingBank ? styles.buttonDisabled : null]}
              >
                {verifyingBank ? (
                  <ActivityIndicator color={partnerTheme.accentStrong} />
                ) : (
                  <Text style={styles.secondaryButtonText}>Verify account</Text>
                )}
              </TouchableOpacity>
            )}
            <Text style={styles.hint}>
              We confirm the account with your bank before you can continue. Nothing is charged.
            </Text>
          </>
        ) : null}

        {stepId === 'verification' ? (
          <>
            <Text style={styles.sectionLabel}>Document type</Text>
            <View style={styles.optionRow}>
              {documentTypeOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => setField('documentType', option.value)}
                  style={[styles.chip, form.documentType === option.value ? styles.chipActive : null]}
                >
                  <Text style={[styles.chipText, form.documentType === option.value ? styles.chipTextActive : null]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Document number</Text>
            <TextInput
              style={styles.input}
              onChangeText={(value) => setField('documentNumber', value)}
              placeholder="12345678901"
              placeholderTextColor={partnerTheme.textSoft}
              value={form.documentNumber}
            />
            <Text style={styles.hint}>Stored as a one-way hash — we keep only the last 4 digits for reference.</Text>

            <Text style={styles.sectionLabel}>Front of document</Text>
            <TouchableOpacity
              disabled={uploadingKind === 'front'}
              onPress={() => handlePickDocument('front')}
              style={[styles.uploadButton, form.documentFrontPath ? styles.uploadButtonDone : null]}
            >
              {uploadingKind === 'front' ? (
                <ActivityIndicator color={partnerTheme.accentStrong} />
              ) : (
                <Text style={styles.uploadButtonText}>{form.documentFrontPath ? 'Front uploaded — replace' : 'Upload front'}</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.sectionLabel}>Back of document (optional)</Text>
            <TouchableOpacity
              disabled={uploadingKind === 'back'}
              onPress={() => handlePickDocument('back')}
              style={[styles.uploadButton, form.documentBackPath ? styles.uploadButtonDone : null]}
            >
              {uploadingKind === 'back' ? (
                <ActivityIndicator color={partnerTheme.accentStrong} />
              ) : (
                <Text style={styles.uploadButtonText}>{form.documentBackPath ? 'Back uploaded — replace' : 'Upload back'}</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.hint}>Documents go to private storage. They are never shown publicly.</Text>
          </>
        ) : null}

        {stepId === 'review' ? (
          <>
            {PARTNER_ONBOARDING_STEPS.filter((entry) => entry.id !== 'review').map((entry) => (
              <TouchableOpacity key={entry.id} onPress={() => setStepId(entry.id)} style={styles.reviewRow}>
                <View style={styles.reviewCopy}>
                  <Text style={styles.reviewTitle}>{entry.title}</Text>
                  <Text style={isStepComplete(entry.id, form) ? styles.reviewDone : styles.reviewMissing}>
                    {isStepComplete(entry.id, form) ? 'Complete' : 'Still needs something'}
                  </Text>
                </View>
                <Text style={styles.reviewEdit}>Edit</Text>
              </TouchableOpacity>
            ))}

            <View style={styles.summaryCard}>
              <Text style={styles.summaryLine}>{form.restaurantName || '—'}</Text>
              <Text style={styles.summaryMuted}>{form.address || '—'}</Text>
              <Text style={styles.summaryMuted}>
                {form.bankName ? `${form.bankName} • ${form.bankVerifiedAccountName ?? 'unverified'}` : '—'}
              </Text>
            </View>

            <Text style={styles.hint}>
              An admin reviews your details and verifies your payout account before your restaurant goes live.
            </Text>
          </>
        ) : null}
      </View>

      {notice}

      {stepId === 'review' ? (
        <TouchableOpacity
          disabled={submitting || !currentStepComplete}
          onPress={handleSubmit}
          style={[styles.primaryButton, submitting || !currentStepComplete ? styles.buttonDisabled : null]}
        >
          {submitting ? (
            <ActivityIndicator color={partnerTheme.textOnBrand} />
          ) : (
            <Text style={styles.primaryButtonText}>Submit for review</Text>
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          disabled={!currentStepComplete}
          onPress={goNext}
          style={[styles.primaryButton, !currentStepComplete ? styles.buttonDisabled : null]}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      )}

      {stepIndex > 0 ? (
        <TouchableOpacity onPress={goBack} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      ) : null}

      {/*
        THE WAY OUT FOR SOMEBODY WHO IS NOT AN APPLICANT.

        A signed-in user without the restaurant role lands here, because the
        app cannot tell a new owner from an invited staff member and applying
        is the common case. But an invitee has no business to verify, no KYC
        document and no payout account -- working through this wizard would
        have them create a SECOND restaurant in order to join the one they
        were invited to. One tap gets them to the code screen instead.

        A link rather than a change to `resolvePartnerLandingRoute`: where a
        genuine applicant lands must not move, and the routing has nothing to
        read that would tell it an invite is waiting.
      */}
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => router.replace('/(partner)/join-restaurant' as never)}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>I was invited to join a restaurant</Text>
      </TouchableOpacity>

      <TouchableOpacity accessibilityRole="button" onPress={() => void signOut()} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
  },
  hero: {
    marginBottom: 16,
  },
  eyebrow: {
    color: partnerTheme.accentText,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: partnerTheme.text,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
    marginTop: 6,
  },
  copy: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  progressSegment: {
    backgroundColor: partnerTheme.border,
    borderRadius: radius.pill,
    flex: 1,
    height: 5,
  },
  progressSegmentActive: {
    backgroundColor: partnerTheme.accent,
  },
  progressLabel: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 14,
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    padding: 18,
  },
  errorText: {
    color: partnerTheme.dangerText,
    fontSize: 13,
    marginTop: 6,
  },
  hint: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  identityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 8,
  },
  identityBubble: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  identityBubbleText: {
    color: partnerTheme.accentStrong,
    fontSize: 18,
    fontWeight: '900',
  },
  identityCopy: {
    marginLeft: 12,
  },
  identityName: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '900',
  },
  identityEmail: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 15,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textArea: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  pickerValue: {
    color: partnerTheme.text,
    fontSize: 15,
  },
  pickerPlaceholder: {
    color: partnerTheme.textSoft,
    fontSize: 15,
  },
  bankList: {
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: 8,
    maxHeight: 260,
    overflow: 'hidden',
  },
  bankRow: {
    borderBottomColor: partnerTheme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  bankRowText: {
    color: partnerTheme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  verifiedCard: {
    backgroundColor: partnerTheme.successSoft,
    borderRadius: radius.lg,
    marginTop: 12,
    padding: 14,
  },
  verifiedLabel: {
    color: partnerTheme.success,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  verifiedName: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 4,
  },
  uploadButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: radius.lg,
    paddingVertical: 14,
  },
  uploadButtonDone: {
    backgroundColor: partnerTheme.successSoft,
  },
  uploadButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '900',
  },
  logoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 4,
  },
  logoPreview: {
    alignItems: 'center',
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 72,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 72,
  },
  logoPreviewText: {
    color: partnerTheme.textSoft,
    fontSize: 11,
  },
  logoImage: {
    height: '100%',
    width: '100%',
  },
  logoActions: {
    marginLeft: 14,
  },
  // Nothing in this block reads as wrong, which is the point: 10 + 10 of padding
  // around a 13pt label whose line box is 18pt comes to 38pt. The pill keeps its
  // padding and grows to the floor instead.
  logoButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  logoButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '900',
  },
  // "Remove" was a bare touchable wrapping this text, so the target was the
  // 12pt label's 17pt line box plus its own 8pt top margin: 25pt, and the only
  // way to undo a wrong logo. The spacing moves off the label and onto the
  // button so that centring inside the 44pt box actually centres the glyph
  // rather than sitting it 8pt low.
  removeLogoButton: {
    justifyContent: 'center',
    marginTop: 4,
    minHeight: MIN_TAP_TARGET,
  },
  removeLogoText: {
    color: partnerTheme.dangerText,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  sectionLabel: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 16,
    textTransform: 'uppercase',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // 10 + 10 of padding, a 13pt/800 label measuring 18pt, and 1pt of border top
  // and bottom: 40pt. These chips are how a partner picks cuisine, prep time
  // and ID document during signup — three steps of the one flow that has to
  // succeed before a restaurant can trade at all — and every one of them was
  // four points under.
  chip: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipActive: {
    backgroundColor: partnerTheme.accent,
    borderColor: partnerTheme.accent,
  },
  chipText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  chipTextActive: {
    color: partnerTheme.textOnBrand,
  },
  coordinatesRow: {
    flexDirection: 'row',
    gap: 10,
  },
  coordinateInput: {
    flex: 1,
  },
  reviewRow: {
    alignItems: 'center',
    borderBottomColor: partnerTheme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  reviewCopy: {
    flex: 1,
  },
  reviewTitle: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '900',
  },
  reviewDone: {
    color: partnerTheme.success,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  reviewMissing: {
    color: partnerTheme.dangerText,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  reviewEdit: {
    color: partnerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '900',
  },
  summaryCard: {
    backgroundColor: partnerTheme.cream,
    borderRadius: radius.lg,
    marginTop: 14,
    padding: 14,
  },
  summaryLine: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '900',
  },
  summaryMuted: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: radius.lg,
    marginTop: 18,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  secondaryButton: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '900',
  },
});
