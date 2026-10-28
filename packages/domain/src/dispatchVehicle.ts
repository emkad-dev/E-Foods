/**
 * Light two-wheelers (a bike or a scooter) are frequently unbadged and
 * unplated in practice — make, model and plate number rarely get formally
 * registered the way a car's or van's do. All three are optional for them;
 * they stay required for a car or van.
 *
 * Shared between the dispatch app's onboarding gate and the
 * `submitDispatchApplication` edge function so the two never drift: a form
 * the client accepts must never be one the server rejects.
 */
export const VEHICLE_TYPES_WITH_OPTIONAL_DETAILS: readonly string[] = ['Bike', 'Scooter'];

export const isVehicleDetailRequired = (vehicleType: string | null | undefined): boolean =>
  !VEHICLE_TYPES_WITH_OPTIONAL_DETAILS.includes((vehicleType ?? '').trim());
