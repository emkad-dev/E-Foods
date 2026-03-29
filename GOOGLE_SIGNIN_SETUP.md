# Google Sign-In Setup Guide

## Overview

Google authentication has been integrated into your Firebase backend. Now you need to configure the client-side implementation.

## Installation

### Step 1: Install Google Sign-In Package

```bash
npm install @react-native-google-signin/google-signin
# or
yarn add @react-native-google-signin/google-signin
# or
expo install @react-native-google-signin/google-signin
```

### Step 2: Get Your Web Client ID from Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your **ebuy-ea84b** project
3. Go to **Project Settings** (gear icon)
4. Click **Service Accounts** tab
5. Find **OAuth 2.0 Client IDs** section or go to **APIs & Services** → **Credentials**
6. Copy your **Web Client ID** (looks like: `YOUR_ID.apps.googleusercontent.com`)

### Step 3: Configure Google Sign-In in Your App

#### Option A: Configure at App Startup

Create a file `src/services/google-signin-config.ts`:

```typescript
import { GoogleSignin } from '@react-native-google-signin/google-signin';

export const configureGoogleSignIn = () => {
  GoogleSignin.configure({
    webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
    scopes: ['profile', 'email'],
    offlineAccess: true,
  });
};
```

Then call it in your `app/_layout.tsx`:

```typescript
import { useEffect } from 'react';
import { configureGoogleSignIn } from '../src/services/google-signin-config';

export default function RootLayout() {
  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  // ... rest of your layout
}
```

#### Option B: Configure in AuthContext (Alternative)

Add this to `src/contexts/AuthContext.tsx`:

```typescript
import { GoogleSignin } from '@react-native-google-signin/google-signin';

useEffect(() => {
  GoogleSignin.configure({
    webClientId: Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    scopes: ['profile', 'email'],
  });
}, []);
```

Then add to `.env` and `app.json`:

```env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
```

## Usage in Components

### Basic Integration in Login Screen

```typescript
import { useAuth } from '../contexts/AuthContext';
import GoogleSignInButton from '../components/GoogleSignInButton';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

export default function LoginScreen() {
  const { signInWithGoogle } = useAuth();

  const handleGoogleLogin = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      
      if (userInfo.idToken) {
        await signInWithGoogle(userInfo.idToken);
        // User is now logged in!
      }
    } catch (error) {
      console.error('Google Sign-In failed:', error);
      Alert.alert('Sign-In Failed', error.message);
    }
  };

  return (
    <View>
      {/* Your other login fields */}
      
      {/* Add Google Sign-In Button */}
      <GoogleSignInButton />
    </View>
  );
}
```

### Or Use the Pre-built Button Component

```typescript
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function LoginScreen() {
  return (
    <View>
      {/* Your other login fields */}
      <GoogleSignInButton />
    </View>
  );
}
```

## Complete Implementation Example

Here's a complete updated login screen with Google Sign-In:

```typescript
import React, { useState, useEffect } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import GoogleSignInButton from '../../src/components/GoogleSignInButton';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, loading, error, clearError } = useAuth();

  useEffect(() => {
    // Configure Google Sign-In on component mount
    GoogleSignin.configure({
      webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
      scopes: ['profile', 'email'],
    });
  }, []);

  useEffect(() => {
    if (error) clearError();
  }, [email, password]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing information', 'Please enter both email and password');
      return;
    }

    try {
      await signIn(email.trim(), password);
    } catch (error: any) {
      Alert.alert('Login Failed', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Email/Password Login */}
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
      />
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Loading...' : 'Sign In'}</Text>
      </TouchableOpacity>

      {/* Divider */}
      <View style={styles.dividerContainer}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>Or</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Google Sign-In */}
      <GoogleSignInButton />

      {/* Links */}
      <Link href="/(auth)/register" style={styles.link}>
        Create an account
      </Link>
      <Link href="/(auth)/forgot-password" style={styles.link}>
        Forgot password?
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  errorText: { color: '#d32f2f', marginBottom: 16, textAlign: 'center', fontSize: 14 },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#f5b342',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#999',
    fontSize: 14,
  },
  link: { marginTop: 12, color: '#5D3FD3', textAlign: 'center' },
});
```

## Firebase Console Configuration

Make sure these are enabled in your Firebase Console:

### Enable Google Sign-In Method

1. Go to **Authentication** → **Sign-in method**
2. Find **Google** in the list
3. Click the toggle to **Enable** it
4. Ensure your authorized domain (`ebuy.com`) is added
5. Save

### Set Up OAuth Consent Screen (if needed)

1. Go to **APIs & Services** → **OAuth consent screen**
2. Configure your app details
3. Add your test users if in development mode
4. Verify all required information is complete

## Environment Variables (Optional)

Add to `.env` and `app.json`:

```env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
```

## API Methods Available

The `useAuth()` hook now provides:

```typescript
const { signInWithGoogle } = useAuth();

// Sign in with Google ID Token
await signInWithGoogle(idToken: string);
```

## What Happens When User Signs In With Google

1. ✅ Google Sign-In flow is triggered
2. ✅ User authenticates with Google
3. ✅ ID Token is retrieved
4. ✅ Firebase verifies the token
5. ✅ User document is created or updated in Firestore
6. ✅ User is set as logged in
7. ✅ App redirects to customer dashboard

## Troubleshooting

### "Configuration not provided" Error

**Solution**: Make sure you called `GoogleSignin.configure()` with your `webClientId` before trying to sign in.

### "hasPlayServices() failed" Error

**Solution**: This is Android-specific. Make sure Google Play Services are installed on the device. For emulator, add those services.

### "Invalid web client ID" Error

**Solution**: Double-check your Web Client ID from Firebase Console matches exactly what's in your code.

### "Sign-in cancelled" Error

**Solution**: User cancelled the sign-in flow. This is normal - just let them try again.

## Security Notes

- Keep your `webClientId` safe - it's not a secret, but don't share your whole Firebase config publicly
- Never hardcode sensitive credentials; use environment variables
- Enable Firestore security rules to protect user data

## Next Steps

1. Install `@react-native-google-signin/google-signin`
2. Get your Web Client ID from Firebase
3. Update `GoogleSignInButton.tsx` with your actual configuration
4. Test the sign-in flow
5. Update your login screen to include the Google Sign-In button

---

**Note**: The `signInWithGoogle` function in AuthContext automatically:
- Creates a new user document in Firestore if the user is new
- Updates existing user info if the user already exists
- Sets the correct role ('customer' by default)
- Handles all error formatting
