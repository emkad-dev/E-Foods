import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { appEnv } from '../config/env';

const trimPath = (value: string) => value.replace(/^\/+|\/+$/g, '');

export const buildCustomerPaymentCallbackUrl = () => {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.origin) {
    return new URL('/payment/callback', window.location.origin).toString();
  }

  return Linking.createURL('/payment/callback');
};

export const normalizeCustomerPaymentCallbackPath = (url: string) => {
  try {
    const parsed = new URL(url);
    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    const pathname = trimPath(parsed.pathname);

    if (scheme === appEnv.appScheme.toLowerCase()) {
      return [trimPath(parsed.hostname), pathname].filter(Boolean).join('/');
    }

    return pathname;
  } catch {
    return '';
  }
};
