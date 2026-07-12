# Google Sign-In Setup

## Scope

Google auth is enabled for the customer app only.

- Customer: Google auth allowed
- Partner: email and password only
- Dispatch: email and password only
- Admin: email and password only

## Flow

1. The customer app gets a Google ID token from the native Google Sign-In module.
2. The app exchanges that token with Supabase using `signInWithIdToken`.
3. Supabase creates or refreshes the customer session.
4. Normal customer profile and session enforcement continues from there.

## Supabase Setup

Enable Google in Supabase Auth and provide the same web client credentials there.

Local placeholders live in:

- [`supabase/.env.example`](supabase/.env.example)
- [`supabase/config.toml`](supabase/config.toml)

Set:

```env
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID="YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com"
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
```

## Customer App Setup

Set the customer-facing Google client ID in the shared Expo env file:

```env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com"
```

The shared template includes this in [`.env.apps.example`](.env.apps.example).

## Google Cloud Requirements

1. Open Google Cloud Console.
2. Open the project that owns the OAuth client.
3. Go to APIs and Services, then Credentials.
4. Copy the web client ID that ends with `.apps.googleusercontent.com`.
5. Copy the client secret for that same web OAuth client.

Use the same pair in:

- Supabase Google provider config
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` for the customer app

## Runtime Notes

- Customer Google auth is native-build only.
- It does not work in Expo Go.
- If `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is missing, the app stays quiet instead of warning on startup.
- The Google button only appears where the customer auth UI already exposes it.

## Verification

1. Put the Google values into `.env.apps` and the Supabase auth provider config.
2. Restart the customer app dev server.
3. Run a native customer build, not Expo Go.
4. Tap Google sign-in from the customer login or register screen.
5. Confirm that:
   - Supabase session is created
   - Customer profile is created or refreshed
   - User lands in the customer app
