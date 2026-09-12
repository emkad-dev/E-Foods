/**
 * Strips a stored phone number down to something `tel:` accepts.
 *
 * Exported because the RESULT matters to the caller: a stored value like "N/A"
 * or "-" is truthy but strips to nothing, and the caller needs to say so rather
 * than hand `tel:` an empty string and watch nothing happen.
 *
 * The old `openPhoneDialer` helper wrapped `Linking.openURL` and threw on an
 * empty number. It is gone: on the web build `Linking.openURL` cannot report
 * failure at all (react-native-web never checks what `window.open` returned),
 * so the throw was the only failure it could ever surface. Callers now use
 * `openExternalLink` from @feasty/runtime, which returns a result.
 */
export const toDialablePhoneNumber = (phoneNumber: string) => phoneNumber.replace(/[^\d+]/g, '');
