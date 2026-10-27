/**
 * Step model for courier onboarding.
 *
 * THE CONTRACT. These rules are the ones `submitDispatchApplication`'s screen
 * already enforced as one all-or-nothing check before submit: dispatch area,
 * every vehicle field, a licence number, a base address, and BOTH sides of the
 * licence. Splitting the flow into steps did not loosen any of them — it moved
 * each one to the step that collects it, so a courier is told what is missing
 * where they can fix it rather than after filling the whole page.
 *
 * Both licence sides are required. That is the existing product rule ("Upload
 * both sides of your licence before submitting"), and unlike the partner flow —
 * where the back of a NIN is optional — a driving licence is only verifiable
 * with both faces.
 *
 * Pure and IO-free so the gating is unit-testable without a device.
 */

export type DispatchOnboardingStepId = 'area' | 'vehicle' | 'licence' | 'review';

export const DISPATCH_ONBOARDING_STEPS: readonly {
  id: DispatchOnboardingStepId;
  title: string;
  blurb: string;
}[] = [
  { blurb: 'Where you will pick up and drop off', id: 'area', title: 'Your area' },
  { blurb: 'What you ride or drive', id: 'vehicle', title: 'Your vehicle' },
  { blurb: 'Proof you are licensed to ride', id: 'licence', title: 'Licence' },
  { blurb: 'Check everything before you send it', id: 'review', title: 'Review' },
];

/** Raw form state. Document fields hold a captured image, or null. */
export type DispatchOnboardingFormState = {
  currentAddress: string;
  hasLicenceBack: boolean;
  hasLicenceFront: boolean;
  lga: string;
  licenseNumber: string;
  region: string;
  vehicleMake: string;
  vehicleModel: string;
  vehiclePlateNumber: string;
  vehicleType: string;
};

const filled = (value: string | null | undefined) => Boolean((value ?? '').trim());

/**
 * Light two-wheelers (a bike or a scooter) are frequently unbadged and
 * unplated in practice — make, model and plate number rarely get formally
 * registered the way a car's or van's do. All three are optional for them;
 * they stay required for a car or van.
 */
export const VEHICLE_TYPES_WITH_OPTIONAL_DETAILS: readonly string[] = ['Bike', 'Scooter'];

export const isVehicleDetailRequired = (vehicleType: string | null | undefined): boolean =>
  !VEHICLE_TYPES_WITH_OPTIONAL_DETAILS.includes((vehicleType ?? '').trim());

export const isStepComplete = (step: DispatchOnboardingStepId, form: DispatchOnboardingFormState): boolean => {
  switch (step) {
    case 'area':
      return filled(form.region) && filled(form.lga) && filled(form.currentAddress);
    case 'vehicle': {
      const detailsRequired = isVehicleDetailRequired(form.vehicleType);
      return (
        filled(form.vehicleType) &&
        (!detailsRequired || filled(form.vehicleMake)) &&
        (!detailsRequired || filled(form.vehicleModel)) &&
        (!detailsRequired || filled(form.vehiclePlateNumber))
      );
    }
    case 'licence':
      // Both sides: a licence is only verifiable with both faces.
      return filled(form.licenseNumber) && form.hasLicenceFront && form.hasLicenceBack;
    case 'review':
      return false;
    default:
      return false;
  }
};

export const canSubmitDispatchOnboarding = (form: DispatchOnboardingFormState) =>
  (['area', 'vehicle', 'licence'] as const).every((step) => isStepComplete(step, form));

/**
 * The first step still missing something — where a courier returning to a
 * partly-filled form should land, rather than back on step 1.
 */
export const firstIncompleteStep = (form: DispatchOnboardingFormState): DispatchOnboardingStepId => {
  const collecting = ['area', 'vehicle', 'licence'] as const;
  return collecting.find((step) => !isStepComplete(step, form)) ?? 'review';
};
