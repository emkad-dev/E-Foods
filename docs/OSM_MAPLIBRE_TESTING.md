# OSM and MapLibre Testing Guide

## Summary

FEASTy no longer uses Google Maps for the location stack.

- Customer delivery address entry uses `expo-location` for current location and reverse geocoding.
- The dispatch live rider map uses `MapLibre` in a `WebView` with OpenStreetMap raster tiles.
- Dispatch place search and reverse geocoding use OpenStreetMap and Nominatim.

There is no `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in this stack.

## Required Configuration

Set the environment values the apps already consume:

- `EXPO_PUBLIC_APP_DOMAIN=feasty.com`
- `EXPO_PUBLIC_APP_SCHEME=feasty-customer`, `feasty-partner`, or `feasty-dispatch`
- `EXPO_PUBLIC_FUNCTIONS_REGION`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Do not add Google Maps keys.

## Testing Checklist

### Customer App

- The app requests location permission when the user taps `Use current location`.
- Current location populates coordinates when permission is granted.
- Reverse geocoding resolves a readable address.
- Manual address entry still works when location is denied.
- Saving returns the user to cart with the address preserved.
- If geocoding fails, the app keeps the entered address.
- If coordinates are unavailable, checkout still works with manual address data.

### Dispatch App

- Rider pins render on the MapLibre map.
- The map fits to the rider bounds with tight padding.
- Riders with precise coordinates appear as live pins.
- LGA-based riders remain visible with fallback zone labels.
- `useRealTimeLocation` requests foreground location permission.
- Tracking starts only after permission is granted.
- Updates are filtered by accuracy and throttled.
- Permission denial surfaces a clear error state.
- Place search returns Nigerian results from Nominatim.
- Selecting a place returns coordinates and a readable address.
- Reverse geocoding returns a stable short address for delivery use.

## Performance Notes

- OpenStreetMap tiles are lightweight, but public tile servers can throttle usage.
- Nominatim is suitable for light production use, but it is rate-limited.
- MapLibre keeps the native dependency surface smaller than `react-native-maps`.

## Troubleshooting

### Blank Map

- Confirm the WebView can load external tiles and MapLibre assets.
- Check that the rider list includes valid latitude and longitude values.

### No Location on Customer Side

- Confirm location permissions are granted on the device.
- Confirm the device has a current GPS fix.
- Verify the app still saves manual address input even if geocoding fails.

### Empty Search Results

- Make sure the query has at least two characters.
- Check that Nominatim is reachable.

## Relevant Files

- `apps/customer/app/(customer)/delivery-location.tsx`
- `apps/dispatch/app/(dispatch)/profile.tsx`
- `apps/dispatch/src/components/DispatchLiveMap.tsx`
- `apps/dispatch/src/hooks/useRealTimeLocation.ts`
- `apps/dispatch/src/services/osmLocation.ts`
