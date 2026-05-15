# Google Sign-In Setup Guide

## Overview

Google Sign-In is handled on the client and exchanged into a Supabase session. The only credential this repo needs is the web OAuth client ID.

## Install

```bash
npm install @react-native-google-signin/google-signin
```

For Expo-managed dependency alignment, `expo install @react-native-google-signin/google-signin` is also fine.

## Get the web client ID

1. Open Google Cloud Console.
2. Open the project that owns your OAuth client.
3. Go to `APIs & Services` -> `Credentials`.
4. Copy the web client ID value that ends with `.apps.googleusercontent.com`.

## Configure the app

Set the client ID in the customer app environment:

```env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
```

The customer app already reads that value from Expo config and env.

## Runtime expectation

- Google Sign-In returns an ID token on the device.
- The app sends that token to Supabase auth.
- Supabase creates or refreshes the app session.

## Verification

1. Start the customer app.
2. Trigger Google Sign-In from the login screen.
3. Confirm the user lands in a Supabase-backed session and the customer profile is created or reused.
