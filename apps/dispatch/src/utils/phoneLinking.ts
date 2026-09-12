/**
 * Strips a stored phone number down to something `tel:` accepts.
 *
 * Exported because the RESULT matters to the caller: a stored value like "N/A"
 * is truthy but strips to nothing, and the caller has to say so rather than
 * hand `tel:` an empty string and watch nothing happen.
 *
 * `openPhoneDialer` used to live here and wrapped `Linking.openURL`. It is gone:
 * that call cannot report a blocked popup, so its throw was the only failure it
 * could ever surface. Callers use `openExternalLink` from packages/runtime.
 */
export const toDialablePhoneNumber = (phoneNumber: string) => phoneNumber.replace(/[^\d+]/g, '');
