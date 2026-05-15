import { createUserProfile, getUserProfile, updateUserProfile } from '../../../../../packages/auth/src';
import type { UserDocument } from '../../domain/entities';
import { supabase } from './config';

export const getUserDocument = async (userId: string): Promise<UserDocument | null> => getUserProfile(supabase, userId);

export const createUserDocument = async (
  userId: string,
  userData: Partial<UserDocument>
): Promise<UserDocument> => createUserProfile(supabase, userId, userData);

export const updateUserDocument = async (userId: string, updates: Partial<UserDocument>): Promise<void> =>
  updateUserProfile(supabase, userId, updates);
