import { Linking } from 'react-native';

const toDialablePhoneNumber = (phoneNumber: string) => phoneNumber.replace(/[^\d+]/g, '');

export const openPhoneDialer = async (phoneNumber: string) => {
  const dialablePhoneNumber = toDialablePhoneNumber(phoneNumber);
  if (!dialablePhoneNumber) {
    throw new Error('Phone number is unavailable.');
  }

  await Linking.openURL(`tel:${dialablePhoneNumber}`);
};
