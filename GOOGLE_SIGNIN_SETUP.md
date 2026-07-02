# Google Sign-In Setup Guide

## Scope

Google auth is enabled for the `customer` app only.

- `customer`: Google auth allowed
- `partner`: email/password only
- `dispatch`: email/password only
- `admin`: email/password only

## Flow

1. The customer app gets a Google ID token from the native Google Sign-In module.
2. The app exchanges that token with Supabase using `signInWithIdToken`.
3. Supabase creates or refreshes the customer session.
4. The normal customer profile/session enforcement path continues from there.

## Supabase setup

Enable Google in Supabase Auth and provide the same web client credentials there.

Local Supabase config placeholders live in:

- [supabase/.env.example](/c:/Users/emkad/EBuy/FEASTY/supabase/.env.example)
- [supabase/config.toml](/c:/Users/emkad/EBuy/FEASTY/supabase/config.toml)

Set:

```env
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID="YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com"
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
```

## Customer app setup

Set the customer-facing Google client ID in the shared Expo env file:

```env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com"
```

The shared template now includes this in [`.env.apps.example`](/c:/Users/emkad/EBuy/FEASTY/.env.apps.example).

## Google Cloud requirements

1. Open Google Cloud Console.
2. Open the project that owns your OAuth client.
3. Go to `APIs & Services` -> `Credentials`.
4. Copy the web client ID that ends with `.apps.googleusercontent.com`.
5. Copy the client secret for that same web OAuth client.

Use that same pair in:

- Supabase Google provider config
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` for the customer app

## Runtime notes

- Customer Google auth is native-build only.
- It does not work in Expo Go.
- If `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is missing, the app now stays quiet instead of warning on startup.
- The Google button only appears where the customer auth UI already exposes it.

## Verification

1. Put the Google values into `.env.apps` and the Supabase auth provider config.
2. Restart the customer app dev server.
3. Run a native customer build, not Expo Go.
4. Tap Google sign-in from the customer login or register screen.
5. Confirm:
   - Supabase session is created
   - customer profile is created or refreshed
   - user lands in the customer app
