# Firebase Self-Adjustment Quick Reference

This document explains how the authentication system automatically adjusts to Firebase configuration.

## 🎯 Self-Adjustment Points

### 1. **Environment Variables** → Configuration
```
.env / app.json
    ↓
Constants.expoConfig?.extra
    ↓
config.ts (Firebase initialization)
    ↓
auth.ts & firestore.ts (Helper functions)
    ↓
AuthContext.tsx (Business logic)
```

### 2. **Configuration Flow**

```typescript
// Step 1: Config reads from environment
const firebaseConfig = {
  apiKey: Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: Constants.expoConfig?.extra?.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Step 2: Firebase is initialized with config
const app = initializeApp(firebaseConfig);

// Step 3: Auth and Firestore use the initialized app
export const auth = getAuth(app);
export const db = getFirestore(app);
```

### 3. **Action Code Settings** (Email Links)

```typescript
// In AuthContext.tsx
const getActionCodeSettings = (path: string) => {
  const appDomain = Constants.expoConfig?.extra?.EXPO_PUBLIC_APP_DOMAIN 
    || 'youreatsclone.com'; // fallback
  
  return {
    url: `https://${appDomain}/${path}`,
  };
};

// Used in email verification:
const verifyPath = Constants.expoConfig?.extra?.EXPO_PUBLIC_VERIFY_EMAIL_PATH 
  || 'verify-email';
await sendVerificationEmailWithFallback(
  firebaseUser,
  getActionCodeSettings(verifyPath)
);
```

### 4. **Error Handling Self-Adjustment**

```typescript
// Detects Firebase configuration errors automatically
const isActionCodeConfigurationError = (error: any): boolean => {
  return ACTION_CODE_CONFIGURATION_ERRORS.has(error?.code);
};

// Falls back gracefully if action code configuration fails
export const sendVerificationEmailWithFallback = async (
  firebaseUser: FirebaseAuthUser,
  actionCodeSettings?: { url: string }
): Promise<void> => {
  try {
    // Try with custom domain settings
    if (actionCodeSettings?.url) {
      await sendEmailVerification(firebaseUser, actionCodeSettings);
    } else {
      await sendEmailVerification(firebaseUser);
    }
  } catch (error: any) {
    // If action code error, try without custom settings
    if (isActionCodeConfigurationError(error)) {
      await sendEmailVerification(firebaseUser);
    } else {
      throw error;
    }
  }
};
```

---

## 🔄 Key Self-Adjusting Features

### Feature 1: Dynamic Email Links
**What it does**: Email verification and password reset links are automatically built from your domain.

**How it adjusts**:
- Reads `EXPO_PUBLIC_APP_DOMAIN` from environment
- Constructs full URL: `https://{domain}/{path}`
- Falls back if domain not configured
- Can be changed without rebuilding the app

**Files involved**:
- `.env` (Configuration)
- `app.json` (Mirror configuration)
- `AuthContext.tsx` (Uses via Constants)

### Feature 2: Automatic Firestore Sync
**What it does**: User data is automatically synchronized with Firestore when they sign in.

**How it adjusts**:
- Detects if user document exists
- Creates it if missing
- Updates it with Firebase Auth data
- Maintains role assignments
- Tracks email verification status

**Code**:
```typescript
useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      const userData = await getUserDocument(db, firebaseUser.uid);
      if (userData) {
        // Use existing document
        setUser({ ...firebaseUser, role: userData.role });
      } else {
        // Create new document
        await createUserDocument(db, firebaseUser.uid, {
          email: firebaseUser.email,
          role: 'customer',
        });
      }
    }
  });
  return unsubscribe;
}, []);
```

### Feature 3: Error Message Localization
**What it does**: Firebase error codes are converted to user-friendly messages.

**How it adjusts**:
- Detects error code from Firebase
- Maps to user-friendly message
- Provides fallback for unknown errors
- Easy to add translations

**Mapping**:
```typescript
const errorMap: Record<string, string> = {
  'auth/user-not-found': 'No account found with this email address',
  'auth/wrong-password': 'Incorrect password',
  'auth/email-already-in-use': 'An account with this email already exists',
  'auth/weak-password': 'Password must be at least 6 characters',
  // ... more mappings
};
```

### Feature 4: Configuration Fallbacks
**What it does**: If a configuration value is missing, sensible defaults are used.

**How it adjusts**:
- Primary: Uses environment variable
- Secondary: Falls back to hardcoded default
- Tertiary: Uses Firebase defaults

**Example**:
```typescript
const appDomain = Constants.expoConfig?.extra?.EXPO_PUBLIC_APP_DOMAIN 
  || 'youreatsclone.com';
const verifyPath = Constants.expoConfig?.extra?.EXPO_PUBLIC_VERIFY_EMAIL_PATH 
  || 'verify-email';
const resetPath = Constants.expoConfig?.extra?.EXPO_PUBLIC_RESET_PASSWORD_PATH 
  || 'reset-password';
```

---

## 🔧 How to Adjust Configuration

### To Change the App Domain:
1. Update `.env`:
   ```env
   EXPO_PUBLIC_APP_DOMAIN=newdomain.com
   ```

2. Update `app.json`:
   ```json
   "extra": {
     "EXPO_PUBLIC_APP_DOMAIN": "newdomain.com"
   }
   ```

3. Update Firebase authorized domains in Console
4. Restart the dev server

### To Change Firebase Project:
1. Update `.env` with new Firebase config
2. Update `app.json` with new credentials
3. No code changes needed!

### To Change Email Paths:
1. Update environment variables:
   ```env
   EXPO_PUBLIC_VERIFY_EMAIL_PATH=auth/verify
   EXPO_PUBLIC_RESET_PASSWORD_PATH=auth/reset
   ```

2. Update your domain's routing to match

---

## 📊 Self-Adjustment Decision Tree

```
Authentication Request
    ↓
┌─────────────────────────────┐
│ Check Auth State            │
└─────────────────────────────┘
    ↓
    ├─→ User Exists?
    │   ├─→ YES: Fetch from Firestore
    │   └─→ NO: Create new document
    ↓
┌─────────────────────────────┐
│ Prepare Email Link          │
└─────────────────────────────┘
    ↓
    ├─→ Read EXPO_PUBLIC_APP_DOMAIN
    │   ├─→ Found: Use custom domain
    │   └─→ Not found: Use default
    ↓
┌─────────────────────────────┐
│ Send Verification Email     │
└─────────────────────────────┘
    ↓
    ├─→ Success: Return
    └─→ Configuration Error
        └─→ Retry without custom URL
            ├─→ Success: Return
            └─→ Actual Error: Throw
```

---

## ✅ Verification Checklist

To verify self-adjustment is working:

1. **Check environment variables are loaded**:
   ```typescript
   const domain = Constants.expoConfig?.extra?.EXPO_PUBLIC_APP_DOMAIN;
   console.log('Domain:', domain); // Should log youreatsclone.com
   ```

2. **Verify Firebase initialization**:
   ```typescript
   console.log('Auth:', auth); // Should be initialized
   console.log('DB:', db); // Should be initialized
   ```

3. **Test user creation**:
   - Sign up with test email
   - Check Firestore for user document
   - Verify email link works

4. **Test error handling**:
   - Attempt signup with invalid email
   - Check formatted error message

5. **Test configuration change**:
   - Change `EXPO_PUBLIC_APP_DOMAIN` in `.env`
   - Restart app
   - Verify email links use new domain

---

## 🐛 Debugging Self-Adjustment

### Enable Firebase Logging:
```typescript
// In config.ts
import { enableLogging } from 'firebase/database';
enableLogging(true); // Enable Firebase debug logs
```

### Check Configuration Loading:
```typescript
// In any component
import Constants from 'expo-constants';

console.log('Loaded Config:', Constants.expoConfig?.extra);
```

### Verify Firestore Connection:
```typescript
// Test Firestore read
import { getDoc, doc } from 'firebase/firestore';

const testUser = await getDoc(doc(db, 'users', 'test-id'));
console.log('Firestore working:', testUser.exists());
```

---

## 🎯 Summary

The system is **self-adjusting** because:

1. ✅ **Configuration is centralized** - Single source of truth in `.env` and `app.json`
2. ✅ **Fallbacks are built-in** - Works even if configuration is incomplete
3. ✅ **No hardcoded values** - Uses environment variables throughout
4. ✅ **Error handling is graceful** - Attempts alternatives before failing
5. ✅ **Easy to extend** - Add new configuration options easily

You can **change Firebase projects, domains, and settings** without modifying any code - just update environment variables!
