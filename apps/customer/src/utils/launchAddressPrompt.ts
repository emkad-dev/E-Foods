import type { AddressRecord } from '../domain/entities.ts';
import { hasSavedAddress } from './savedAddress.ts';

export type LaunchAddressPromptInput = {
  /** The persisted cart (and its address) has finished loading from storage. */
  cartHydrated: boolean;
  /**
   * Nothing account-related is still pending. A signed-in user who is about to
   * be redirected to verify-email, complete-profile or accept-policy must not
   * get the prompt stacked on that flow.
   */
  accountFlowSettled: boolean;
  /** The Home screen itself is what is showing, not a deep-linked flow. */
  onHome: boolean;
  /** Already offered during this app launch (shown, skipped or saved). */
  alreadyShownThisLaunch: boolean;
  deliveryLocation: AddressRecord | null;
};

/**
 * Whether to ask for an address now. Pure so every guard is testable.
 *
 * Hydration is a hard requirement: before the cart loads the address is
 * `null` for everyone, so deciding earlier would flash the prompt at people who
 * saved one last session.
 */
export const shouldShowLaunchAddressPrompt = ({
  accountFlowSettled,
  alreadyShownThisLaunch,
  cartHydrated,
  deliveryLocation,
  onHome,
}: LaunchAddressPromptInput): boolean =>
  cartHydrated && accountFlowSettled && onHome && !alreadyShownThisLaunch && !hasSavedAddress(deliveryLocation);

// In memory on purpose: Skip lasts until the next cold launch, and every cold
// launch asks again while no address is saved. Persisting this would turn it
// into the one-time onboarding flag, which already exists.
let shownThisLaunch = false;

export const hasLaunchAddressPromptBeenShown = () => shownThisLaunch;

export const markLaunchAddressPromptShown = () => {
  shownThisLaunch = true;
};
