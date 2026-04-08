import { router } from 'expo-router';
import { Alert } from 'react-native';

type AuthPromptOptions = {
  title: string;
  message: string;
};

export const promptForAuth = ({ title, message }: AuthPromptOptions) => {
  Alert.alert(title, message, [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Sign up',
      onPress: () => router.push('/(auth)/register'),
    },
    {
      text: 'Sign in',
      onPress: () => router.push('/(auth)/login'),
    },
  ]);
};
