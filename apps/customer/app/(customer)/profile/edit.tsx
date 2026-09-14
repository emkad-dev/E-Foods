import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Input, Text, space, useNotice } from '@feasty/design-system';
import AuthPromptCard from '../../../src/components/AuthPromptCard';
import { screenColumn } from '../../../src/components/ScreenColumn';
import { useAuth } from '../../../src/contexts/AuthContext';
import {
  normalizeProfilePhoneNumber,
  validatePhoneNumber,
  validateUsername,
} from '../../../src/domain/authFormValidation';
import { customerTheme } from '../../../src/theme/palette';

const DISPLAY_NAME_MAX_LENGTH = 24;

/** "display name" + "phone number" -> "display name and phone number". */
const joinFields = (fields: string[]) =>
  fields.length > 1 ? `${fields.slice(0, -1).join(', ')} and ${fields[fields.length - 1]}` : fields[0];

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * The only place the customer profile MUTATES.
 *
 * Split out of /profile because that screen mixed navigating rows with two
 * inline fields that each had their own Save button — three different meanings
 * for a tap in one card, and two competing "did it work?" answers. Here there is
 * one form and one Save.
 */
export default function EditProfileScreen() {
  const { updateDisplayName, updatePhoneNumber, user } = useAuth();
  const { notice, showNotice, dismissNotice } = useNotice();

  const savedName = user?.displayName?.trim() ?? '';
  const savedPhone = String(user?.phoneNumber ?? '').trim();

  const [nameDraft, setNameDraft] = useState(savedName);
  const [phoneDraft, setPhoneDraft] = useState(savedPhone);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  // Local, not `loading` from useAuth(): that flag is raised by every auth
  // operation in the app, including the one this screen is not running.
  const [saving, setSaving] = useState(false);

  // ONE EFFECT PER FIELD, and that is the whole point — a single effect over
  // both would run BOTH setters whenever either value changed. On a half-success
  // (name saved, phone rejected by the server) `updateDisplayName` patches the
  // auth user, so `savedName` changes, and the shared effect would also fire
  // `setPhoneDraft(savedPhone)`: the rejected field silently reverts to the old
  // stored number, `phoneDirty` goes false, and Save disables itself under an
  // error message telling the customer to fix a field they can no longer retry.
  // Split, only the field that actually changed is re-seeded.
  //
  // KNOWN GAP, not worth dirty-tracking for: these depend on the stored STRINGS,
  // so a bootstrap or token refresh that returns identical values is inert, but a
  // genuine change made elsewhere (another device, an admin edit) mid-typing will
  // still overwrite that field's draft.
  useEffect(() => {
    setNameDraft(savedName);
  }, [savedName]);

  useEffect(() => {
    setPhoneDraft(savedPhone);
  }, [savedPhone]);

  const nextName = nameDraft.trim();
  // Compared in E.164 so retyping the same number with different spacing is not
  // "dirty", and so a legacy record stored as raw text counts as dirty and gets
  // upgraded on the next save.
  const nextPhone = normalizeProfilePhoneNumber(phoneDraft) ?? phoneDraft.trim();
  const nameDirty = nextName !== savedName;
  const phoneDirty = nextPhone !== savedPhone;
  const dirty = nameDirty || phoneDirty;

  const handleSave = async () => {
    dismissNotice();

    // Only the fields being sent are validated. Validating an untouched field
    // would block the save on data the customer has not looked at — exactly what
    // happens to anyone whose number predates the format check.
    const nameProblem = nameDirty ? validateUsername({ value: nameDraft }) : null;
    const phoneProblem = phoneDirty ? validatePhoneNumber({ value: phoneDraft }) : null;

    setNameError(nameProblem);
    setPhoneError(phoneProblem);

    if (nameProblem || phoneProblem) {
      return;
    }

    const failed: string[] = [];
    const succeeded: string[] = [];

    setSaving(true);

    try {
      if (nameDirty) {
        try {
          await updateDisplayName(nextName);
          succeeded.push('display name');
        } catch (nextError) {
          failed.push('display name');
          setNameError(messageOf(nextError, 'Unable to update your display name right now.'));
        }
      }

      if (phoneDirty) {
        try {
          // The normalised form, never the typed text: the same person typing
          // "0803 123 4567" and "+234 803 123 4567" must not produce two
          // different numbers for support to dial.
          await updatePhoneNumber(nextPhone);
          succeeded.push('phone number');
        } catch (nextError) {
          failed.push('phone number');
          setPhoneError(messageOf(nextError, 'Unable to update your phone number right now.'));
        }
      }
    } finally {
      setSaving(false);
    }

    if (failed.length === 0) {
      router.replace('/profile');
      return;
    }

    // Says WHICH half failed. A blanket "could not save" after one of two writes
    // succeeded invites the customer to retype the field that is already correct.
    showNotice({
      tone: 'error',
      title: succeeded.length > 0 ? 'Only part of this saved' : 'Nothing saved',
      message:
        succeeded.length > 0
          ? `Your ${joinFields(succeeded)} saved, but your ${joinFields(failed)} did not. The field says why.`
          : `Your ${joinFields(failed)} did not save. The field says why.`,
    });
  };

  if (!user) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.guestContainer}>
        <View style={screenColumn.reading}>
          <AuthPromptCard
            title="Sign in to edit your profile"
            message="Your name and contact number live on your FEASTY account."
          />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* Same 560pt cap as /profile — see the note there. */}
      <View style={screenColumn.reading}>
        <Card>
          <Text variant="title3">Your details</Text>

          {/* "Display name", not "Username". The field writes `displayName` and
              the validator's own message calls it "the name you want the app to
              greet you with"; "Username" promises a unique handle that this has
              never been and that nothing in the app enforces. */}
          <Input
            label="Display name"
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="Add a display name"
            autoCapitalize="words"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            editable={!saving}
            error={nameError ?? undefined}
            containerStyle={styles.field}
          />

          <Input
            label="Phone number"
            value={phoneDraft}
            onChangeText={setPhoneDraft}
            placeholder="0803 123 4567"
            keyboardType="phone-pad"
            autoComplete="tel"
            editable={!saving}
            error={phoneError ?? undefined}
            hint="Nigerian (+234) or UK (+44) mobile. Riders and support use this number."
            containerStyle={styles.field}
          />
        </Card>

        <Button
          label="Save changes"
          variant="primary"
          fullWidth
          disabled={!dirty}
          loading={saving}
          onPress={handleSave}
          style={styles.save}
        />

        {notice}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  container: {
    padding: 14,
    paddingBottom: 28,
  },
  guestContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  field: {
    marginTop: space.lg,
  },
  save: {
    marginTop: space.xl,
  },
});
